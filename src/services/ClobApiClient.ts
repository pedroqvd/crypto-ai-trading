// ================================================
// CLOB API CLIENT — Polymarket Trading Execution
// Wraps @polymarket/clob-client SDK
// ================================================

import { config } from '../engine/Config';
import { logger } from '../utils/Logger';

// Types for when the SDK is available
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
  private client: unknown = null; // Will be ClobClient when SDK is loaded

  constructor() {
    logger.info('ClobApi', config.dryRun
      ? '🏜️ CLOB client initialized in DRY-RUN mode (no real trades)'
      : '⚡ CLOB client initialized in LIVE mode'
    );
  }

  // ========================================
  // INITIALIZE — Connect wallet & derive API credentials
  // ========================================
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
      // Dynamic import to avoid crash if SDK not installed
      const { ClobClient } = await import('@polymarket/clob-client');
      const { Wallet } = await import('ethers');

      const HOST = 'https://clob.polymarket.com';
      const CHAIN_ID = 137; // Polygon mainnet

      const signer = new Wallet(config.privateKey);

      // Derive API credentials
      const tempClient = new ClobClient(HOST, CHAIN_ID, signer);
      const apiCreds = await (tempClient as any).createOrDeriveApiKey();

      // Initialize full trading client
      this.client = new ClobClient(
        HOST,
        CHAIN_ID,
        signer,
        apiCreds,
        0, // EOA signature type
        signer.address,
      );

      this.initialized = true;
      logger.info('ClobApi', `✅ CLOB client connected. Wallet: ${signer.address.slice(0, 8)}...`);
      return true;
    } catch (err) {
      logger.error('ClobApi', 'Failed to initialize CLOB client', err instanceof Error ? err.message : err);
      return false;
    }
  }

  // ========================================
  // GET ORDER BOOK
  // ========================================
  async getOrderBook(tokenId: string): Promise<OrderBook | null> {
    if (config.dryRun || !this.client) {
      // In dry-run, return a simulated order book
      return {
        bids: [{ price: 0.49, size: 100 }, { price: 0.48, size: 200 }],
        asks: [{ price: 0.51, size: 100 }, { price: 0.52, size: 150 }],
        midpoint: 0.50,
        spread: 0.02,
      };
    }

    try {
      const book = await (this.client as any).getOrderBook(tokenId);
      const bids = (book.bids || []).map((b: any) => ({ price: parseFloat(b.price), size: parseFloat(b.size) }));
      const asks = (book.asks || []).map((a: any) => ({ price: parseFloat(a.price), size: parseFloat(a.size) }));

      const bestBid = bids.length > 0 ? bids[0].price : 0;
      const bestAsk = asks.length > 0 ? asks[0].price : 1;

      return {
        bids,
        asks,
        midpoint: (bestBid + bestAsk) / 2,
        spread: bestAsk - bestBid,
      };
    } catch (err) {
      logger.error('ClobApi', `Failed to get order book for ${tokenId}`, err instanceof Error ? err.message : err);
      return null;
    }
  }

  // ========================================
  // PLACE LIMIT ORDER
  // ========================================
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
      return {
        success: true,
        orderId,
        status: 'DRY_RUN',
        transactedSize: size,
      };
    }

    if (!this.initialized || !this.client) {
      return { success: false, error: 'CLOB client not initialized' };
    }

    try {
      const { Side, OrderType } = await import('@polymarket/clob-client');
      const orderSide = side === 'BUY' ? Side.BUY : Side.SELL;

      const response = await (this.client as any).createAndPostOrder(
        {
          tokenID: tokenId,
          price,
          size,
          side: orderSide,
        },
        {
          tickSize: '0.01',
          negRisk,
        },
        OrderType.GTC
      );

      logger.info('ClobApi', `✅ Order placed: ${side} ${size} @ $${price}. ID: ${response.orderID}`);

      return {
        success: true,
        orderId: response.orderID,
        status: response.status,
        transactedSize: size,
      };
    } catch (err) {
      logger.error('ClobApi', `Failed to place order`, err instanceof Error ? err.message : err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  // ========================================
  // CANCEL ORDER
  // ========================================
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

  // ========================================
  // GET OPEN ORDERS
  // ========================================
  async getOpenOrders(): Promise<unknown[]> {
    if (config.dryRun || !this.client) return [];

    try {
      return await (this.client as any).getOpenOrders();
    } catch (err) {
      logger.error('ClobApi', 'Failed to get open orders', err instanceof Error ? err.message : err);
      return [];
    }
  }

  // ========================================
  // GET BALANCE
  // ========================================
  async getBalance(): Promise<number> {
    if (config.dryRun) return config.bankroll;

    // In live mode, query actual USDC.e balance
    // This would need ethers provider setup
    return config.bankroll;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}
