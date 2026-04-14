// ================================================
// GAMMA API CLIENT — Polymarket Market Discovery
// https://gamma-api.polymarket.com
// ================================================

import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/Logger';

export interface GammaMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  outcomePrices: string;       // JSON: "[0.65, 0.35]"
  volume: string;
  liquidity: string;
  active: boolean;
  closed: boolean;
  endDate: string;
  description: string;
  clobTokenIds?: string;       // JSON: "[\"tokenId1\", \"tokenId2\"]"
  acceptingOrders: boolean;
  negRisk: boolean;
  enableOrderBook: boolean;
}

export interface GammaEvent {
  id: string;
  title: string;
  slug: string;
  description: string;
  active: boolean;
  closed: boolean;
  liquidity: number;
  volume: number;
  markets: GammaMarket[];
}

export interface ParsedMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  yesPrice: number;
  noPrice: number;
  volume: number;
  liquidity: number;
  active: boolean;
  closed: boolean;
  endDate: string;
  description: string;
  yesTokenId: string;
  noTokenId: string;
  acceptingOrders: boolean;
  negRisk: boolean;
}

export class GammaApiClient {
  private client: AxiosInstance;
  private cache: Map<string, { data: unknown; expiry: number }> = new Map();
  private defaultTTL = 30_000; // 30 seconds

  constructor() {
    this.client = axios.create({
      baseURL: 'https://gamma-api.polymarket.com',
      timeout: 15_000,
      headers: { 'Accept': 'application/json' },
    });

    logger.info('GammaApi', 'Gamma API client initialized');
  }

  // ========================================
  // FETCH ACTIVE, TRADEABLE MARKETS
  // ========================================
  async getActiveMarkets(limit = 100): Promise<ParsedMarket[]> {
    const cacheKey = `active-markets-${limit}`;
    const cached = this.getFromCache<ParsedMarket[]>(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.client.get('/markets', {
        params: {
          active: true,
          closed: false,
          limit,
          order: 'volume',
          ascending: false,
        },
      });

      const rawMarkets: GammaMarket[] = response.data || [];

      const parsed = rawMarkets
        .filter(m => m.active && !m.closed && m.acceptingOrders)
        .map(m => this.parseMarket(m))
        .filter(m => m.yesTokenId && m.noTokenId); // Must have token IDs

      this.setCache(cacheKey, parsed);
      logger.debug('GammaApi', `Fetched ${parsed.length} active markets`);
      return parsed;
    } catch (err) {
      logger.error('GammaApi', 'Failed to fetch active markets', err instanceof Error ? err.message : err);
      return [];
    }
  }

  // ========================================
  // FETCH ALL PAGES OF MARKETS
  // ========================================
  async getAllActiveMarkets(maxPages = 5): Promise<ParsedMarket[]> {
    const cacheKey = 'all-active-markets';
    const cached = this.getFromCache<ParsedMarket[]>(cacheKey);
    if (cached) return cached;

    const allMarkets: ParsedMarket[] = [];

    try {
      for (let page = 0; page < maxPages; page++) {
        const response = await this.client.get('/markets', {
          params: {
            active: true,
            closed: false,
            limit: 100,
            offset: page * 100,
            order: 'volume',
            ascending: false,
          },
        });

        const rawMarkets: GammaMarket[] = response.data || [];
        if (rawMarkets.length === 0) break;

        const parsed = rawMarkets
          .filter(m => m.active && !m.closed && m.acceptingOrders)
          .map(m => this.parseMarket(m))
          .filter(m => m.yesTokenId && m.noTokenId);

        allMarkets.push(...parsed);

        if (rawMarkets.length < 100) break; // Last page
      }

      this.setCache(cacheKey, allMarkets, 60_000); // 1 min cache for full scan
      logger.info('GammaApi', `Full scan: ${allMarkets.length} tradeable markets found`);
      return allMarkets;
    } catch (err) {
      logger.error('GammaApi', 'Failed full market scan', err instanceof Error ? err.message : err);
      return allMarkets; // Return whatever we got
    }
  }

  // ========================================
  // FETCH SINGLE MARKET BY ID
  // ========================================
  async getMarketById(marketId: string): Promise<ParsedMarket | null> {
    try {
      const response = await this.client.get(`/markets/${marketId}`);
      if (!response.data) return null;
      return this.parseMarket(response.data);
    } catch (err) {
      logger.error('GammaApi', `Failed to fetch market ${marketId}`, err instanceof Error ? err.message : err);
      return null;
    }
  }

  // ========================================
  // HEALTH CHECK
  // ========================================
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.get('/markets', { params: { limit: 1 } });
      return true;
    } catch {
      return false;
    }
  }

  // ========================================
  // PARSER
  // ========================================
  private parseMarket(m: GammaMarket): ParsedMarket {
    let yesPrice = 0.5;
    let noPrice = 0.5;
    let yesTokenId = '';
    let noTokenId = '';

    try {
      if (m.outcomePrices) {
        const prices = JSON.parse(m.outcomePrices);
        yesPrice = parseFloat(prices[0]) || 0.5;
        noPrice = parseFloat(prices[1]) || 0.5;
      }
    } catch { /* fallback defaults */ }

    try {
      if (m.clobTokenIds) {
        const tokens = JSON.parse(m.clobTokenIds);
        yesTokenId = tokens[0] || '';
        noTokenId = tokens[1] || '';
      }
    } catch { /* fallback defaults */ }

    return {
      id: m.id,
      question: m.question || 'Unknown',
      conditionId: m.conditionId || '',
      slug: m.slug || '',
      yesPrice,
      noPrice,
      volume: parseFloat(m.volume) || 0,
      liquidity: parseFloat(m.liquidity) || 0,
      active: m.active,
      closed: m.closed,
      endDate: m.endDate || '',
      description: m.description || '',
      yesTokenId,
      noTokenId,
      acceptingOrders: m.acceptingOrders ?? false,
      negRisk: m.negRisk ?? false,
    };
  }

  // ========================================
  // CACHE
  // ========================================
  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (entry && Date.now() < entry.expiry) {
      return entry.data as T;
    }
    this.cache.delete(key);
    return null;
  }

  private setCache(key: string, data: unknown, ttl?: number): void {
    this.cache.set(key, {
      data,
      expiry: Date.now() + (ttl || this.defaultTTL),
    });
  }
}
