import * as HL from '@nktkas/hyperliquid';
import { EventEmitter } from 'events';
import { MarketData, OrderBookData, TradeData, HyperliquidConfig } from './types';
import { MarketDataModel } from '../../models/MarketData';

export class HyperliquidService extends EventEmitter {
  private config: HyperliquidConfig;
  private infoClient!: HL.InfoClient;
  private exchangeClient: HL.ExchangeClient | null = null;
  private subscriptionClient: HL.SubscriptionClient | null = null;
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 5000;
  private subscriptions: Set<string> = new Set();
  private marketDataCache: Map<string, MarketDataModel> = new Map();

  // Principais assets para monitorar
  private readonly MAIN_ASSETS = ['BTC', 'ETH', 'SOL', 'AVAX', 'MATIC', 'LINK', 'UNI'];

  constructor(config?: Partial<HyperliquidConfig>) {
    super();
    
    this.config = {
      testnet: process.env.HYPERLIQUID_TESTNET === 'true',
      privateKey: process.env.HYPERLIQUID_PRIVATE_KEY,
      wsUrl: process.env.HYPERLIQUID_WS_URL || 'wss://api.hyperliquid.xyz/ws',
      apiUrl: process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz',
      ...config
    };

    this.initializeClients();
  }

  private initializeClients(): void {
    try {
      // HTTP Transport para REST API
      const httpTransport = new HL.HttpTransport();

      // Info Client para dados de mercado (público)
      this.infoClient = new HL.InfoClient({ 
        transport: httpTransport 
      });

      // Exchange Client (se private key disponível)
      if (this.config.privateKey) {
        // Criar wallet account usando viem
        const { privateKeyToAccount } = require('viem/accounts');
        const wallet = privateKeyToAccount(this.config.privateKey as `0x${string}`);
        
        this.exchangeClient = new HL.ExchangeClient({
          transport: httpTransport,
          wallet: wallet
        });
      }

      console.log('🔧 Hyperliquid clients initialized');
    } catch (error) {
      console.error('❌ Error initializing Hyperliquid clients:', error);
      throw error;
    }
  }

  // Conectar ao WebSocket e iniciar subscriptions
  public async connect(): Promise<void> {
    try {
      console.log('🔗 Connecting to Hyperliquid WebSocket...');

      // WebSocket Transport
      const wsTransport = new HL.WebSocketTransport();
      
      // Subscription Client para WebSocket
      this.subscriptionClient = new HL.SubscriptionClient({ 
        transport: wsTransport 
      });

      this.isConnected = true;
      this.reconnectAttempts = 0;
      
      console.log('✅ Connected to Hyperliquid WebSocket');
      
      // Subscribe aos principais feeds
      await this.subscribeToMainFeeds();
      
      this.emit('connected');
    } catch (error) {
      console.error('❌ Error connecting to Hyperliquid:', error);
      this.handleReconnect();
    }
  }

  private async subscribeToMainFeeds(): Promise<void> {
    if (!this.subscriptionClient) {
      console.error('❌ Subscription client not initialized');
      return;
    }

    try {
      // Subscribe to all mid prices
      await this.subscriptionClient.allMids((data: any) => {
        this.handleAllMidsUpdate(data);
      });
      console.log('📊 Subscribed to all mid prices');

      // Subscribe to trades for main assets
      for (const asset of this.MAIN_ASSETS) {
        try {
          await this.subscriptionClient.trades({
            coin: asset
          }, (data: any) => {
            this.handleTradesUpdate(data);
          });

          await this.subscriptionClient.l2Book({
            coin: asset
          }, (data: any) => {
            this.handleOrderBookUpdate(data);
          });
          
          this.subscriptions.add(asset);
        } catch (assetError) {
          console.warn(`⚠️ Could not subscribe to ${asset}:`, assetError);
        }
      }

      console.log(`📈 Subscribed to feeds for: ${Array.from(this.subscriptions).join(', ')}`);
    } catch (error) {
      console.error('❌ Error subscribing to feeds:', error);
    }
  }

  private handleAllMidsUpdate(data: any): void {
    try {
      if (data && data.mids && typeof data.mids === 'object') {
        Object.entries(data.mids).forEach(([symbol, priceStr]) => {
          const price = parseFloat(priceStr as string);
          
          if (!isNaN(price) && price > 0) {
            const marketData = new MarketDataModel({
              symbol,
              price,
              volume24h: 0,
              change24h: 0
            });

            this.marketDataCache.set(symbol, marketData);
            this.emit('priceUpdate', { symbol, price, timestamp: Date.now() });
          }
        });
      }
    } catch (error) {
      console.error('❌ Error handling allMids update:', error);
    }
  }

  private handleTradesUpdate(data: any): void {
    try {
      if (data && Array.isArray(data)) {
        data.forEach((trade: any) => {
          const tradeData: TradeData = {
            symbol: trade.coin || 'UNKNOWN',
            price: parseFloat(trade.px) || 0,
            size: parseFloat(trade.sz) || 0,
            side: trade.side === 'B' ? 'buy' : 'sell',
            timestamp: parseInt(trade.time) || Date.now()
          };

          this.emit('trade', tradeData);
          
          // Update market data cache
          if (this.marketDataCache.has(tradeData.symbol)) {
            const existing = this.marketDataCache.get(tradeData.symbol)!;
            existing.price = tradeData.price;
            existing.timestamp = tradeData.timestamp;
          }
        });
      }
    } catch (error) {
      console.error('❌ Error handling trades update:', error);
    }
  }

  private handleOrderBookUpdate(data: any): void {
    try {
      if (data && data.coin) {
        const orderBook: OrderBookData = {
          symbol: data.coin,
          bids: data.levels?.[0] || [],
          asks: data.levels?.[1] || [],
          timestamp: Date.now()
        };

        this.emit('orderBook', orderBook);
      }
    } catch (error) {
      console.error('❌ Error handling order book update:', error);
    }
  }

  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ Max reconnection attempts reached');
      this.emit('maxReconnectAttemptsReached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(`🔄 Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);

    setTimeout(() => {
      this.connect().catch(console.error);
    }, delay);
  }

  public async getMarketData(symbol: string): Promise<MarketDataModel | null> {
    try {
      if (this.marketDataCache.has(symbol)) {
        return this.marketDataCache.get(symbol)!;
      }

      try {
        const allMids = await this.infoClient.allMids();
        
        if (allMids && allMids.mids && typeof allMids.mids === 'object') {
          const midsObj = allMids.mids as { [key: string]: string };
          
          if (midsObj[symbol]) {
            const price = parseFloat(midsObj[symbol]);
            
            if (!isNaN(price) && price > 0) {
              const marketData = new MarketDataModel({
                symbol,
                price,
                volume24h: 0,
                change24h: 0
              });
              
              this.marketDataCache.set(symbol, marketData);
              return marketData;
            }
          }
        }
      } catch (apiError) {
        console.error(`❌ Error fetching market data from API for ${symbol}:`, apiError);
      }
      
      return null;
    } catch (error) {
      console.error(`❌ Error getting market data for ${symbol}:`, error);
      return null;
    }
  }

  public getActiveAssets(): string[] {
    return Array.from(this.subscriptions);
  }

  public getCachedMarketData(): Map<string, MarketDataModel> {
    return new Map(this.marketDataCache);
  }

  public isHealthy(): boolean {
    return this.isConnected && this.reconnectAttempts < this.maxReconnectAttempts;
  }

  public async disconnect(): Promise<void> {
    try {
      console.log('🔌 Disconnecting from Hyperliquid...');
      
      if (this.subscriptionClient) {
        this.subscriptionClient = null;
      }
      
      this.isConnected = false;
      this.subscriptions.clear();
      this.marketDataCache.clear();
      
      console.log('✅ Disconnected from Hyperliquid');
      this.emit('disconnected');
    } catch (error) {
      console.error('❌ Error disconnecting:', error);
    }
  }

  public destroy(): void {
    this.disconnect();
    this.removeAllListeners();
  }
}