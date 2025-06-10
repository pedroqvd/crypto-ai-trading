// ================================================
// CCXT SERVICE - MULTI-EXCHANGE INTEGRATION (FIXED)
// ================================================

import * as ccxt from 'ccxt';

interface TickerData {
  symbol: string;
  exchange: string;
  price: number;
  volume: number;
  change24h: number;
  timestamp: number;
}

interface OrderBookData {
  symbol: string;
  exchange: string;
  bids: number[][];
  asks: number[][];
  timestamp: number;
}

interface TradeData {
  symbol: string;
  exchange: string;
  price: number;
  amount: number;
  side: 'buy' | 'sell';
  timestamp: number;
}

interface OHLCVData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export class CCXTService {
  private exchanges: Map<string, ccxt.Exchange> = new Map();
  private watchlists: Map<string, string[]> = new Map();
  private cache: Map<string, any> = new Map();
  private cacheTimeout = 5000; // 5 segundos

  constructor() {
    this.initializeExchanges();
  }

  // ========================================
  // INICIALIZAÇÃO DE EXCHANGES
  // ========================================
  private initializeExchanges(): void {
    const exchangeConfigs = {
      binance: {
        enableRateLimit: true,
        options: {
          defaultType: 'spot'
        }
      },
      coinbase: {
        enableRateLimit: true,
        sandbox: false
      },
      kraken: {
        enableRateLimit: true
      }
    };

    Object.entries(exchangeConfigs).forEach(([name, config]) => {
      try {
        const ExchangeClass = (ccxt as any)[name];
        if (ExchangeClass) {
          const exchange = new ExchangeClass(config);
          this.exchanges.set(name, exchange);
          console.log(`✅ ${name} exchange inicializada`);
        }
      } catch (error) {
        console.error(`❌ Erro ao inicializar ${name}:`, error);
      }
    });

    this.setupDefaultWatchlists();
  }

  private setupDefaultWatchlists(): void {
    const cryptoSymbols = [
      'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'ADA/USDT',
      'DOGE/USDT', 'MATIC/USDT', 'AVAX/USDT', 'DOT/USDT'
    ];

    this.exchanges.forEach((exchange, name) => {
      this.watchlists.set(name, cryptoSymbols);
    });
  }

  // ========================================
  // TICKER DATA (Preços em Tempo Real)
  // ========================================
  async getAllTickers(): Promise<TickerData[]> {
    const allTickers: TickerData[] = [];
    
    await Promise.allSettled(
      Array.from(this.exchanges.entries()).map(async ([name, exchange]) => {
        try {
          const symbols = this.watchlists.get(name) || [];
          
          for (const symbol of symbols.slice(0, 5)) { // Limitar para evitar rate limit
            const cacheKey = `ticker_${name}_${symbol}`;
            const cached = this.getFromCache(cacheKey);
            
            if (cached) {
              allTickers.push(cached);
              continue;
            }

            try {
              const ticker = await exchange.fetchTicker(symbol);
              const tickerData: TickerData = {
                symbol,
                exchange: name,
                price: Number(ticker.last) || 0,
                volume: Number(ticker.baseVolume) || 0,
                change24h: Number(ticker.percentage) || 0,
                timestamp: Date.now()
              };
              
              this.setCache(cacheKey, tickerData);
              allTickers.push(tickerData);
              
              // Rate limiting
              await this.sleep(200);
              
            } catch (symbolError) {
              console.warn(`⚠️ Erro no símbolo ${symbol} em ${name}`);
            }
          }
        } catch (exchangeError) {
          console.error(`❌ Erro na exchange ${name}:`, exchangeError);
        }
      })
    );

    return allTickers;
  }

  async getTickerBySymbol(symbol: string, exchangeName?: string): Promise<TickerData[]> {
    const tickers: TickerData[] = [];
    const exchanges = exchangeName 
      ? [this.exchanges.get(exchangeName)].filter(Boolean) 
      : Array.from(this.exchanges.values());

    await Promise.allSettled(
      exchanges.map(async (exchange) => {
        try {
          if (!exchange) return;
          
          const ticker = await exchange.fetchTicker(symbol);
          tickers.push({
            symbol,
            exchange: exchange.id,
            price: Number(ticker.last) || 0,
            volume: Number(ticker.baseVolume) || 0,
            change24h: Number(ticker.percentage) || 0,
            timestamp: Date.now()
          });
        } catch (error) {
          console.warn(`⚠️ Erro ${symbol} em ${exchange?.id}`);
        }
      })
    );

    return tickers;
  }

  // ========================================
  // ORDER BOOK DATA
  // ========================================
  async getOrderBook(symbol: string, exchangeName: string, limit = 20): Promise<OrderBookData | null> {
    const exchange = this.exchanges.get(exchangeName);
    if (!exchange) return null;

    try {
      const orderBook = await exchange.fetchOrderBook(symbol, limit);
      
      // Converter CCXT types para numbers
      const bids = orderBook.bids.map(bid => [Number(bid[0]), Number(bid[1])]);
      const asks = orderBook.asks.map(ask => [Number(ask[0]), Number(ask[1])]);
      
      return {
        symbol,
        exchange: exchangeName,
        bids: bids.slice(0, limit),
        asks: asks.slice(0, limit),
        timestamp: Date.now()
      };
    } catch (error) {
      console.error(`❌ Erro order book ${symbol} em ${exchangeName}:`, error);
      return null;
    }
  }

  // ========================================
  // TRADE HISTORY
  // ========================================
  async getRecentTrades(symbol: string, exchangeName: string, limit = 50): Promise<TradeData[]> {
    const exchange = this.exchanges.get(exchangeName);
    if (!exchange) return [];

    try {
      const trades = await exchange.fetchTrades(symbol, undefined, limit);
      
      return trades.map(trade => ({
        symbol,
        exchange: exchangeName,
        price: Number(trade.price),
        amount: Number(trade.amount),
        side: trade.side as 'buy' | 'sell',
        timestamp: Number(trade.timestamp) || Date.now()
      }));
    } catch (error) {
      console.error(`❌ Erro trades ${symbol} em ${exchangeName}:`, error);
      return [];
    }
  }

  // ========================================
  // OHLCV DATA (Para gráficos)
  // ========================================
  async getOHLCV(
    symbol: string, 
    exchangeName: string, 
    timeframe = '1h', 
    limit = 100
  ): Promise<OHLCVData[]> {
    const exchange = this.exchanges.get(exchangeName);
    if (!exchange) return [];

    try {
      const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
      
      return ohlcv.map(candle => ({
        timestamp: Number(candle[0]),
        open: Number(candle[1]),
        high: Number(candle[2]),
        low: Number(candle[3]),
        close: Number(candle[4]),
        volume: Number(candle[5])
      }));
    } catch (error) {
      console.error(`❌ Erro OHLCV ${symbol} em ${exchangeName}:`, error);
      return [];
    }
  }

  // ========================================
  // ARBITRAGE OPPORTUNITIES
  // ========================================
  async findArbitrageOpportunities(symbol: string): Promise<any[]> {
    const tickers = await this.getTickerBySymbol(symbol);
    
    if (tickers.length < 2) return [];

    const opportunities = [];
    
    for (let i = 0; i < tickers.length; i++) {
      for (let j = i + 1; j < tickers.length; j++) {
        const ticker1 = tickers[i];
        const ticker2 = tickers[j];
        
        const priceDiff = Math.abs(ticker1.price - ticker2.price);
        const avgPrice = (ticker1.price + ticker2.price) / 2;
        const diffPercentage = (priceDiff / avgPrice) * 100;
        
        if (diffPercentage > 0.1) {
          opportunities.push({
            symbol,
            exchange1: ticker1.exchange,
            price1: ticker1.price,
            exchange2: ticker2.exchange,
            price2: ticker2.price,
            priceDifference: priceDiff,
            percentageDifference: diffPercentage,
            buyFrom: ticker1.price < ticker2.price ? ticker1.exchange : ticker2.exchange,
            sellTo: ticker1.price > ticker2.price ? ticker1.exchange : ticker2.exchange,
            timestamp: Date.now()
          });
        }
      }
    }
    
    return opportunities.sort((a, b) => b.percentageDifference - a.percentageDifference);
  }

  // ========================================
  // MARKET STATISTICS
  // ========================================
  async getMarketStats(): Promise<any> {
    const allTickers = await this.getAllTickers();
    
    const stats = {
      totalPairs: allTickers.length,
      exchanges: Array.from(this.exchanges.keys()),
      topGainers: allTickers
        .filter(t => t.change24h > 0)
        .sort((a, b) => b.change24h - a.change24h)
        .slice(0, 10),
      topLosers: allTickers
        .filter(t => t.change24h < 0)
        .sort((a, b) => a.change24h - b.change24h)
        .slice(0, 10),
      avgChange24h: allTickers.reduce((sum, t) => sum + t.change24h, 0) / allTickers.length,
      totalVolume: allTickers.reduce((sum, t) => sum + t.volume, 0),
      timestamp: Date.now()
    };

    return stats;
  }

  // ========================================
  // EXCHANGE STATUS
  // ========================================
  async getExchangeStatus(): Promise<Array<{
    exchange: string;
    status: string;
    updated: number;
    online: boolean;
    error?: string;
  }>> {
    const statuses: Array<{
      exchange: string;
      status: string;
      updated: number;
      online: boolean;
      error?: string;
    }> = [];
    
    await Promise.allSettled(
      Array.from(this.exchanges.entries()).map(async ([name, exchange]) => {
        try {
          const status = await exchange.fetchStatus();
          statuses.push({
            exchange: name,
            status: status.status || 'unknown',
            updated: Number(status.updated) || Date.now(),
            online: (status.status || 'unknown') === 'ok'
          });
        } catch (error) {
          statuses.push({
            exchange: name,
            status: 'error',
            updated: Date.now(),
            online: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      })
    );

    return statuses;
  }

  // ========================================
  // UTILITY METHODS
  // ========================================
  private getFromCache(key: string): any {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    return null;
  }

  private setCache(key: string, data: any): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ========================================
  // PUBLIC API METHODS
  // ========================================
  getAvailableExchanges(): string[] {
    return Array.from(this.exchanges.keys());
  }

  getWatchlist(exchangeName: string): string[] {
    return this.watchlists.get(exchangeName) || [];
  }

  addToWatchlist(exchangeName: string, symbol: string): void {
    const watchlist = this.watchlists.get(exchangeName) || [];
    if (!watchlist.includes(symbol)) {
      watchlist.push(symbol);
      this.watchlists.set(exchangeName, watchlist);
    }
  }

  removeFromWatchlist(exchangeName: string, symbol: string): void {
    const watchlist = this.watchlists.get(exchangeName) || [];
    const filtered = watchlist.filter(s => s !== symbol);
    this.watchlists.set(exchangeName, filtered);
  }

  // ========================================
  // HEALTH CHECK
  // ========================================
  async healthCheck(): Promise<any> {
    const exchanges = await this.getExchangeStatus();
    const onlineCount = exchanges.filter(e => e.online).length;
    
    return {
      totalExchanges: this.exchanges.size,
      onlineExchanges: onlineCount,
      offlineExchanges: this.exchanges.size - onlineCount,
      healthPercentage: (onlineCount / this.exchanges.size) * 100,
      cacheSize: this.cache.size,
      exchanges,
      timestamp: Date.now()
    };
  }
}