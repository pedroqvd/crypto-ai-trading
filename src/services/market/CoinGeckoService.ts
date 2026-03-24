// ================================================
// COINGECKO SERVICE - Market Data & Trending
// API gratuita: 30 req/min sem key
// ================================================

import axios, { AxiosInstance } from 'axios';

interface CoinPrice {
  id: string;
  symbol: string;
  current_price: number;
  market_cap: number;
  total_volume: number;
  price_change_percentage_24h: number;
  market_cap_rank: number;
}

interface GlobalData {
  total_market_cap: Record<string, number>;
  total_volume: Record<string, number>;
  market_cap_percentage: Record<string, number>;
  market_cap_change_percentage_24h_usd: number;
  active_cryptocurrencies: number;
}

interface TrendingCoin {
  id: string;
  name: string;
  symbol: string;
  market_cap_rank: number;
  price_btc: number;
  score: number;
}

export class CoinGeckoService {
  private client: AxiosInstance;
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private cacheTTL = 60000; // 1 min para respeitar rate limit

  constructor() {
    this.client = axios.create({
      baseURL: 'https://api.coingecko.com/api/v3',
      timeout: 10000,
      headers: { 'Accept': 'application/json' }
    });

    console.log('🦎 CoinGeckoService inicializado');
  }

  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.timestamp < this.cacheTTL) {
      return entry.data as T;
    }
    return null;
  }

  private setCache(key: string, data: any): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  // ========================================
  // PREÇOS SIMPLES
  // ========================================
  async getPrices(coinIds: string[]): Promise<Record<string, any>> {
    const cacheKey = `prices:${coinIds.join(',')}`;
    const cached = this.getCached<Record<string, any>>(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.client.get('/simple/price', {
        params: {
          ids: coinIds.join(','),
          vs_currencies: 'usd',
          include_market_cap: true,
          include_24hr_vol: true,
          include_24hr_change: true,
          include_last_updated_at: true
        }
      });

      this.setCache(cacheKey, response.data);
      return response.data;
    } catch (error) {
      console.error('❌ CoinGecko getPrices error:', error instanceof Error ? error.message : error);
      return {};
    }
  }

  // ========================================
  // TOP COINS POR MARKET CAP
  // ========================================
  async getTopCoins(limit = 50): Promise<CoinPrice[]> {
    const cacheKey = `topcoins:${limit}`;
    const cached = this.getCached<CoinPrice[]>(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.client.get('/coins/markets', {
        params: {
          vs_currency: 'usd',
          order: 'market_cap_desc',
          per_page: limit,
          page: 1,
          sparkline: false,
          price_change_percentage: '24h,7d'
        }
      });

      const coins: CoinPrice[] = response.data.map((coin: any) => ({
        id: coin.id,
        symbol: coin.symbol,
        current_price: coin.current_price,
        market_cap: coin.market_cap,
        total_volume: coin.total_volume,
        price_change_percentage_24h: coin.price_change_percentage_24h,
        market_cap_rank: coin.market_cap_rank
      }));

      this.setCache(cacheKey, coins);
      return coins;
    } catch (error) {
      console.error('❌ CoinGecko getTopCoins error:', error instanceof Error ? error.message : error);
      return [];
    }
  }

  // ========================================
  // DADOS GLOBAIS DO MERCADO
  // ========================================
  async getGlobalData(): Promise<GlobalData | null> {
    const cacheKey = 'global';
    const cached = this.getCached<GlobalData>(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.client.get('/global');
      const data = response.data.data;

      const globalData: GlobalData = {
        total_market_cap: data.total_market_cap,
        total_volume: data.total_volume,
        market_cap_percentage: data.market_cap_percentage,
        market_cap_change_percentage_24h_usd: data.market_cap_change_percentage_24h_usd,
        active_cryptocurrencies: data.active_cryptocurrencies
      };

      this.setCache(cacheKey, globalData);
      return globalData;
    } catch (error) {
      console.error('❌ CoinGecko getGlobalData error:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  // ========================================
  // TRENDING COINS
  // ========================================
  async getTrending(): Promise<TrendingCoin[]> {
    const cacheKey = 'trending';
    const cached = this.getCached<TrendingCoin[]>(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.client.get('/search/trending');

      const trending: TrendingCoin[] = response.data.coins.map((item: any) => ({
        id: item.item.id,
        name: item.item.name,
        symbol: item.item.symbol,
        market_cap_rank: item.item.market_cap_rank,
        price_btc: item.item.price_btc,
        score: item.item.score
      }));

      this.setCache(cacheKey, trending);
      return trending;
    } catch (error) {
      console.error('❌ CoinGecko getTrending error:', error instanceof Error ? error.message : error);
      return [];
    }
  }

  // ========================================
  // HEALTH CHECK
  // ========================================
  async healthCheck(): Promise<{ status: string; timestamp: number }> {
    try {
      await this.client.get('/ping');
      return { status: 'operational', timestamp: Date.now() };
    } catch {
      return { status: 'error', timestamp: Date.now() };
    }
  }
}
