// ================================================
// GAMMA API CLIENT — Polymarket Market Discovery
// https://gamma-api.polymarket.com
// ================================================

import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/Logger';

const GAMMA_TRANSIENT_PATTERNS = ['timeout', 'ECONNRESET', 'ECONNREFUSED', '503', '502', '429', 'network'];

async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts = 3,
  delays = [3_000, 6_000]
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient = GAMMA_TRANSIENT_PATTERNS.some(p => msg.toLowerCase().includes(p.toLowerCase()));
      if (!isTransient || attempt === maxAttempts) throw err;
      const delay = delays[attempt - 1] ?? delays[delays.length - 1];
      logger.warn('GammaApi', `${label} failed (attempt ${attempt}/${maxAttempts}), retrying in ${delay / 1000}s…`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error(`${label}: max retries exceeded`);
}

export interface GammaMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  outcomePrices: string;
  volume: string;
  liquidity: string;
  active: boolean;
  closed: boolean;
  endDate: string;
  startDate?: string;
  createdAt?: string;
  description: string;
  clobTokenIds?: string;
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
  createdAt: string;
  description: string;
  yesTokenId: string;
  noTokenId: string;
  acceptingOrders: boolean;
  negRisk: boolean;
  eventId?: string;
  eventTitle?: string;
}

export interface ParsedEvent {
  id: string;
  title: string;
  slug: string;
  markets: ParsedMarket[];
}

export class GammaApiClient {
  private client: AxiosInstance;
  private cache: Map<string, { data: unknown; expiry: number }> = new Map();
  private defaultTTL = 30_000;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://gamma-api.polymarket.com',
      timeout: 15_000,
      headers: { 'Accept': 'application/json' },
    });
    logger.info('GammaApi', 'Gamma API client initialized');
  }

  async getActiveMarkets(limit = 100): Promise<ParsedMarket[]> {
    const cacheKey = `active-markets-${limit}`;
    const cached = this.getFromCache<ParsedMarket[]>(cacheKey);
    if (cached) return cached;

    try {
      const response = await fetchWithRetry(
        () => this.client.get('/markets', { params: { active: true, closed: false, limit, order: 'volume', ascending: false } }),
        'getActiveMarkets'
      );
      const rawMarkets: GammaMarket[] = response.data || [];
      const parsed = rawMarkets
        .filter(m => m.active && !m.closed && m.acceptingOrders)
        .map(m => this.parseMarket(m))
        .filter(m => m.yesTokenId && m.noTokenId);
      this.setCache(cacheKey, parsed);
      logger.debug('GammaApi', `Fetched ${parsed.length} active markets`);
      return parsed;
    } catch (err) {
      logger.error('GammaApi', 'Failed to fetch active markets', err instanceof Error ? err.message : err);
      return [];
    }
  }

  async getAllActiveMarkets(maxPages = 5): Promise<ParsedMarket[]> {
    const cacheKey = 'all-active-markets';
    const cached = this.getFromCache<ParsedMarket[]>(cacheKey);
    if (cached) return cached;

    const allMarkets: ParsedMarket[] = [];
    try {
      for (let page = 0; page < maxPages; page++) {
        const response = await fetchWithRetry(
          () => this.client.get('/markets', { params: { active: true, closed: false, limit: 100, offset: page * 100, order: 'volume', ascending: false } }),
          `getAllActiveMarkets(page=${page})`
        );
        const rawMarkets: GammaMarket[] = response.data || [];
        if (rawMarkets.length === 0) break;
        const parsed = rawMarkets
          .filter(m => m.active && !m.closed && m.acceptingOrders)
          .map(m => this.parseMarket(m))
          .filter(m => m.yesTokenId && m.noTokenId);
        allMarkets.push(...parsed);
        if (rawMarkets.length < 100) break;
      }
      this.setCache(cacheKey, allMarkets, 60_000);
      logger.info('GammaApi', `Full scan: ${allMarkets.length} tradeable markets found`);
      return allMarkets;
    } catch (err) {
      logger.error('GammaApi', 'Failed full market scan', err instanceof Error ? err.message : err);
      return allMarkets;
    }
  }

  async getActiveEventsWithMarkets(maxPages = 3): Promise<ParsedEvent[]> {
    const cacheKey = 'active-events';
    const cached = this.getFromCache<ParsedEvent[]>(cacheKey);
    if (cached) return cached;

    const allEvents: ParsedEvent[] = [];

    try {
      for (let page = 0; page < maxPages; page++) {
        const response = await fetchWithRetry(
          () => this.client.get('/events', { params: { active: true, closed: false, limit: 50, offset: page * 50, order: 'volume', ascending: false } }),
          `getActiveEventsWithMarkets(page=${page})`
        );
        const rawEvents: GammaEvent[] = response.data || [];
        if (rawEvents.length === 0) break;

        for (const event of rawEvents) {
          if (!event.markets || event.markets.length < 2) continue;
          const parsedMarkets = event.markets
            .map(m => this.parseMarket(m, event.id, event.title))
            .filter(m => m.yesTokenId && m.noTokenId && m.active && !m.closed);
          if (parsedMarkets.length >= 2) {
            allEvents.push({ id: event.id, title: event.title, slug: event.slug, markets: parsedMarkets });
          }
        }
        if (rawEvents.length < 50) break;
      }

      this.setCache(cacheKey, allEvents, 120_000);
      logger.debug('GammaApi', `Fetched ${allEvents.length} active events with markets`);
      return allEvents;
    } catch (err) {
      logger.error('GammaApi', 'Failed to fetch events', err instanceof Error ? err.message : err);
      return allEvents;
    }
  }

  async getMarketById(marketId: string): Promise<ParsedMarket | null> {
    const cacheKey = `market-${marketId}`;
    const cached = this.getFromCache<ParsedMarket>(cacheKey);
    if (cached) return cached;

    try {
      const response = await fetchWithRetry(
        () => this.client.get(`/markets/${marketId}`),
        `getMarketById(${marketId.slice(0, 12)})`
      );
      if (!response.data) return null;
      const market = this.parseMarket(response.data);
      // Closed markets don't change — cache them longer
      const ttl = market.closed ? 600_000 : 30_000;
      this.setCache(cacheKey, market, ttl);
      return market;
    } catch (err) {
      logger.error('GammaApi', `Failed to fetch market ${marketId}`, err instanceof Error ? err.message : err);
      return null;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.client.get('/markets', { params: { limit: 1 } });
      return true;
    } catch {
      return false;
    }
  }

  private parseMarket(m: GammaMarket, eventId?: string, eventTitle?: string): ParsedMarket {
    let yesPrice = 0.5, noPrice = 0.5, yesTokenId = '', noTokenId = '';
    try {
      if (m.outcomePrices) {
        const prices = JSON.parse(m.outcomePrices);
        yesPrice = parseFloat(prices[0]) || 0.5;
        noPrice = parseFloat(prices[1]) || 0.5;
      }
    } catch { /* fallback */ }
    try {
      if (m.clobTokenIds) {
        const tokens = JSON.parse(m.clobTokenIds);
        yesTokenId = tokens[0] || '';
        noTokenId = tokens[1] || '';
      }
    } catch { /* fallback */ }
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
      createdAt: m.createdAt || m.startDate || '',
      description: m.description || '',
      yesTokenId,
      noTokenId,
      acceptingOrders: m.acceptingOrders ?? false,
      negRisk: m.negRisk ?? false,
      eventId,
      eventTitle,
    };
  }

  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (entry && Date.now() < entry.expiry) return entry.data as T;
    this.cache.delete(key);
    return null;
  }

  private setCache(key: string, data: unknown, ttl?: number): void {
    this.cache.set(key, { data, expiry: Date.now() + (ttl || this.defaultTTL) });
  }
}
