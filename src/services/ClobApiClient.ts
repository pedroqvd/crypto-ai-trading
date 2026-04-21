// ================================================
// CLOB API CLIENT — Polymarket Trading Execution
// Wraps @polymarket/clob-client SDK
// ================================================

import { config } from '../engine/Config';
import { logger } from '../utils/Logger';

export interface OrderResult {
  success: boolean;
  orderId?: string;
  status?: string;
  error?: string;
  transactedSize?: number;
}

export interface OrderBookEntry {
  price: number;
  size: number;
}

export interface OrderBook {
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  midpoint: number;
  spread: number;
}

export interface PositionInfo {
  tokenId: string;
  size: number;
  avgPrice: number;
  currentPrice: number;
  pnl: number;
}

export class ClobApiClient {
  private initialized = false;
  private client: unknown = null;
  // Cached to avoid recreating on every getBalance() call (prevents memory leak)
  private cachedProvider: unknown = null;
  private cachedWalletAddress = '';

  constructor() {
    logger.info('ClobApi', config.dryRun
      ? '🏜️ CLOB client initialized in DRY-RUN mode (no real trades)'
      : '⚡ CLOB client initialized in LIVE mode'
    );
  }

  async initialize(): Promise<boolean> {
    if (config.dryRun) {
      logger.info('ClobApi', 'DRY-RUN mode — skipping wallet initialization');
      this.initialized = true;
      return true;
    }

    if (!config.privateKey) {
      logger.error('ClobApi', 'PRIVATE_KEY not configured. Cannot initialize CLOB client.');
      return false;
    }

    try {
      const { ClobClient } = await import('@polymarket/clob-client');
      const { Wallet, providers } = await import('ethers');

      const HOST = 'https://clob.polymarket.com';
      const CHAIN_ID = 137;

      const signer = new Wallet(config.privateKey);
      this.cachedWalletAddress = signer.address;
      this.cachedProvider = new providers.JsonRpcProvider('https://polygon-rpc.com');

      const tempClient = new ClobClient(HOST, CHAIN_ID, signer);
      const apiCreds = await (tempClient as any).createOrDeriveApiKey();

      this.client = new ClobClient(HOST, CHAIN_ID, signer, apiCreds, 0, signer.address);
      this.initialized = true;
      logger.info('ClobApi', `✅ CLOB client connected. Wallet: ${signer.address.slice(0, 8)}...`);
      return true;
    } catch (err) {
      logger.error('ClobApi', 'Failed to initialize CLOB client', err instanceof Error ? err.message : err);
      return false;
    }
  }

  async getOrderBook(
    tokenId: string,
    marketPrice = 0.50,
    marketLiquidity = 10_000
  ): Promise<OrderBook | null> {
    if (config.dryRun || !this.client) {
      // Synthetic order book that reflects actual market characteristics.
      // Spread shrinks with liquidity; depth scales with available capital.
      const mid = Math.max(0.02, Math.min(0.98, marketPrice));
      const spread = Math.max(0.01, Math.min(0.08, 3_000 / marketLiquidity));
      const half   = spread / 2;
      const depth  = Math.min(2_000, marketLiquidity / 10);
      return {
        bids: [
          { price: +(mid - half).toFixed(4),       size: +(depth).toFixed(0) },
          { price: +(mid - half * 2.5).toFixed(4), size: +(depth * 1.6).toFixed(0) },
          { price: +(mid - half * 4).toFixed(4),   size: +(depth * 2.4).toFixed(0) },
        ],
        asks: [
          { price: +(mid + half).toFixed(4),       size: +(depth).toFixed(0) },
          { price: +(mid + half * 2.5).toFixed(4), size: +(depth * 1.6).toFixed(0) },
          { price: +(mid + half * 4).toFixed(4),   size: +(depth * 2.4).toFixed(0) },
        ],
        midpoint: mid,
        spread,
      };
    }
    try {
      const book = await (this.client as any).getOrderBook(tokenId);
      const bids = (book.bids || []).map((b: any) => ({ price: parseFloat(b.price), size: parseFloat(b.size) }));
      const asks = (book.asks || []).map((a: any) => ({ price: parseFloat(a.price), size: parseFloat(a.size) }));
      const bestBid = bids.length > 0 ? bids[0].price : 0;
      const bestAsk = asks.length > 0 ? asks[0].price : 1;
      return { bids, asks, midpoint: (bestBid + bestAsk) / 2, spread: bestAsk - bestBid };
    } catch (err) {
      logger.error('ClobApi', `Failed to get order book for ${tokenId}`, err instanceof Error ? err.message : err);
      return null;
    }
  }

  async placeLimitOrder(
    tokenId: string,
    side: 'BUY' | 'SELL',
    price: number,
    size: number,
    negRisk: boolean = false
  ): Promise<OrderResult> {
    if (config.dryRun) {
      const orderId = `dry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      logger.info('ClobApi', `🏜️ [DRY-RUN] Would place ${side} order: ${size} shares @ $${price.toFixed(4)} (token: ${tokenId.slice(0, 12)}...)`);
      return { success: true, orderId, status: 'DRY_RUN', transactedSize: size };
    }

    if (!this.initialized || !this.client) {
      return { success: false, error: 'CLOB client not initialized' };
    }

    const MAX_ATTEMPTS = 3;
    const RETRY_DELAYS_MS = [2_000, 4_000];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const { Side, OrderType } = await import('@polymarket/clob-client');
        const orderSide = side === 'BUY' ? Side.BUY : Side.SELL;
        const response = await (this.client as any).createAndPostOrder(
          { tokenID: tokenId, price, size, side: orderSide },
          { tickSize: '0.01', negRisk },
          OrderType.GTC
        );
        logger.info('ClobApi', `✅ Order placed: ${side} ${size} @ $${price}. ID: ${response.orderID}`);
        return { success: true, orderId: response.orderID, status: response.status, transactedSize: size };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        const isTransient = errMsg.includes('timeout') || errMsg.includes('network') ||
          errMsg.includes('ECONNRESET') || errMsg.includes('503') ||
          errMsg.includes('502') || errMsg.includes('429');
        if (!isTransient || attempt === MAX_ATTEMPTS) {
          logger.error('ClobApi', `Failed to place order (attempt ${attempt}/${MAX_ATTEMPTS})`, errMsg);
          return { success: false, error: errMsg };
        }
        const delay = RETRY_DELAYS_MS[attempt - 1];
        logger.warn('ClobApi', `Order placement failed (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${delay / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    return { success: false, error: 'Max retries exceeded' };
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    if (config.dryRun) {
      logger.info('ClobApi', `🏜️ [DRY-RUN] Would cancel order ${orderId}`);
      return true;
    }
    try {
      await (this.client as any).cancelOrder(orderId);
      logger.info('ClobApi', `Order cancelled: ${orderId}`);
      return true;
    } catch (err) {
      logger.error('ClobApi', `Failed to cancel order ${orderId}`, err instanceof Error ? err.message : err);
      return false;
    }
  }

  async getOpenOrders(): Promise<unknown[]> {
    if (config.dryRun || !this.client) return [];
    try {
      return await (this.client as any).getOpenOrders();
    } catch (err) {
      logger.error('ClobApi', 'Failed to get open orders', err instanceof Error ? err.message : err);
      return [];
    }
  }

  async getBalance(): Promise<number> {
    if (config.dryRun) return config.bankroll;

    if (!this.initialized || !this.client) {
      logger.warn('ClobApi', 'getBalance() chamado antes da inicialização — retornando bankroll inicial');
      return config.bankroll;
    }

    try {
      const { ethers } = await import('ethers');

      // All stablecoins Polymarket accepts on Polygon (query all, sum total)
      const STABLECOINS = [
        { symbol: 'USDC.e',          address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' }, // Bridged USDC (legacy)
        { symbol: 'USDC',            address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' }, // Native USDC (Circle)
        { symbol: 'Polymarket USD',  address: '0x4Fabb145d64652a948d72533023f6E7A623C7C53' }, // BUSD — placeholder; update if Polymarket publishes address
      ];

      const erc20Abi = [
        'function balanceOf(address) view returns (uint256)',
        'function decimals() view returns (uint8)',
      ];

      let totalBalance = 0;

      await Promise.all(
        STABLECOINS.map(async ({ symbol, address }) => {
          try {
            const token = new ethers.Contract(address, erc20Abi, this.cachedProvider as any);
            const [rawBalance, decimals] = await Promise.all([
              token.balanceOf(this.cachedWalletAddress) as Promise<any>,
              token.decimals() as Promise<number>,
            ]);
            const bal = parseFloat(ethers.utils.formatUnits(rawBalance, decimals));
            if (bal > 0) {
              logger.info('ClobApi', `💰 Saldo ${symbol}: $${bal.toFixed(2)}`);
              totalBalance += bal;
            }
          } catch (_) {
            // Token may not exist or wallet has no interaction — silently skip
          }
        })
      );

      logger.info('ClobApi', `💰 Saldo total (todos stablecoins): $${totalBalance.toFixed(2)}`);
      return totalBalance > 0 ? totalBalance : config.bankroll;
    } catch (err) {
      logger.error('ClobApi', 'Falha ao consultar saldo on-chain — retornando bankroll inicial', err instanceof Error ? err.message : err);
      return config.bankroll;
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}
