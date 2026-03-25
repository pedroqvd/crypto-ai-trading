// ================================================
// POLYMARKET TRADER SERVICE
// Data API: https://data-api.polymarket.com
// ================================================

import axios, { AxiosInstance } from 'axios';

interface TraderActivity {
  proxyWallet: string;
  timestamp: number;
  side: string; // "BUY" | "SELL"
  asset: string;
  conditionId: string;
  size: number;
  price: number;
  outcome: string; // "YES" | "NO" | team name
  title?: string;
  question?: string;
}

interface TraderPosition {
  conditionId: string;
  asset: string;
  size: number;
  avgPrice: number;
  currentPrice: number;
  outcome: string;
  title?: string;
  question?: string;
  endDate?: string;
  resolved: boolean;
  pnl?: number;
}

export interface TraderBet {
  date: string;
  event: string;
  bet: string;
  betType: 'yes' | 'no' | 'team';
  confidence: 1 | 2 | 3;
  odds: number;
  invested: number;
  roi: number | null;
  profit: number | null;
}

export interface MonthlyProfit {
  month: string;
  value: number;
}

export interface TraderProfile {
  id: string;
  address: string;
  name: string;
  roi: number;
  profit: number;
  totalBet: number;
  betsCount: number;
  monthly: MonthlyProfit[];
  openBets: TraderBet[];
  closedBets: TraderBet[];
}

interface CacheEntry<T> {
  data: T;
  expires: number;
}

export class PolymarketTraderService {
  private dataApi: AxiosInstance;
  private gammaApi: AxiosInstance;
  private cache: Map<string, CacheEntry<unknown>>;
  private readonly TTL = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.dataApi = axios.create({
      baseURL: 'https://data-api.polymarket.com',
      timeout: 10000,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    this.gammaApi = axios.create({
      baseURL: 'https://gamma-api.polymarket.com',
      timeout: 10000,
      headers: {
        'Accept': 'application/json'
      }
    });

    this.cache = new Map();
  }

  // ================================================
  // PUBLIC METHODS
  // ================================================

  /**
   * Get top traders by profit on Polymarket
   */
  async getTopTraders(limit = 20): Promise<TraderProfile[]> {
    const cacheKey = `top-traders-${limit}`;
    const cached = this.getFromCache<TraderProfile[]>(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.dataApi.get('/leaderboard', {
        params: { limit, sortBy: 'profit', order: 'desc' }
      });

      const traders = response.data?.data || response.data || [];
      const profiles = await Promise.all(
        traders.slice(0, limit).map(async (t: { address?: string; proxy?: string; name?: string }) => {
          const address = t.address || t.proxy || '';
          if (!address) return null;
          try {
            return await this.buildTraderProfile(address, t.name);
          } catch {
            return null;
          }
        })
      );

      const result = profiles.filter(Boolean) as TraderProfile[];
      this.setInCache(cacheKey, result);
      return result;
    } catch (err) {
      console.error('[PolymarketTraderService] getTopTraders failed:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  /**
   * Get raw activity for a trader address
   */
  async getTraderActivity(address: string): Promise<TraderActivity[]> {
    const cacheKey = `activity-${address}`;
    const cached = this.getFromCache<TraderActivity[]>(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.dataApi.get('/activity', {
        params: {
          user: address.toLowerCase(),
          limit: 100,
          offset: 0
        }
      });

      const activities: TraderActivity[] = (response.data?.data || response.data || []).map(
        (item: Record<string, unknown>) => this.normalizeActivity(item)
      );

      this.setInCache(cacheKey, activities);
      return activities;
    } catch (err) {
      console.error('[PolymarketTraderService] getTraderActivity failed:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  /**
   * Get open positions for a trader address
   */
  async getTraderPositions(address: string): Promise<TraderPosition[]> {
    const cacheKey = `positions-${address}`;
    const cached = this.getFromCache<TraderPosition[]>(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.dataApi.get('/positions', {
        params: { user: address.toLowerCase() }
      });

      const positions: TraderPosition[] = (response.data?.data || response.data || []).map(
        (item: Record<string, unknown>) => this.normalizePosition(item)
      );

      this.setInCache(cacheKey, positions);
      return positions;
    } catch (err) {
      console.error('[PolymarketTraderService] getTraderPositions failed:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  /**
   * Build a full TraderProfile from address + optional display name
   */
  async buildTraderProfile(address: string, name?: string): Promise<TraderProfile> {
    const cacheKey = `profile-${address}`;
    const cached = this.getFromCache<TraderProfile>(cacheKey);
    if (cached) return cached;

    const [activities, positions] = await Promise.allSettled([
      this.getTraderActivity(address),
      this.getTraderPositions(address)
    ]);

    const activityList = activities.status === 'fulfilled' ? activities.value : [];
    const positionList = positions.status === 'fulfilled' ? positions.value : [];

    const profile = this.processTraderData(
      address,
      name || this.formatShortAddress(address),
      activityList,
      positionList
    );

    this.setInCache(cacheKey, profile);
    return profile;
  }

  // ================================================
  // DATA PROCESSING
  // ================================================

  private processTraderData(
    address: string,
    name: string,
    activities: TraderActivity[],
    positions: TraderPosition[]
  ): TraderProfile {
    // Build closed bets from resolved activities
    const closedBets: TraderBet[] = this.buildClosedBets(activities);

    // Build open bets from current positions
    const openBets: TraderBet[] = this.buildOpenBets(positions);

    // Calculate aggregates
    let totalInvested = 0;
    let totalProfit = 0;

    closedBets.forEach(b => {
      totalInvested += b.invested;
      if (b.profit !== null) totalProfit += b.profit;
    });

    openBets.forEach(b => {
      totalInvested += b.invested;
    });

    const roi = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;

    // Monthly profit grouping
    const monthly = this.buildMonthlyData(activities);

    const betsCount = closedBets.length + openBets.length;

    return {
      id: address.toLowerCase().slice(2, 14),
      address,
      name,
      roi: Math.round(roi * 10) / 10,
      profit: Math.round(totalProfit),
      totalBet: Math.round(totalInvested),
      betsCount,
      monthly,
      openBets,
      closedBets
    };
  }

  private buildClosedBets(activities: TraderActivity[]): TraderBet[] {
    // Group by conditionId to match buys with outcomes
    const groups: Record<string, TraderActivity[]> = {};
    activities.forEach(a => {
      if (!groups[a.conditionId]) groups[a.conditionId] = [];
      groups[a.conditionId].push(a);
    });

    const bets: TraderBet[] = [];

    Object.values(groups).forEach(group => {
      const buys = group.filter(a => a.side === 'BUY');
      const sells = group.filter(a => a.side === 'SELL');
      if (buys.length === 0) return;

      const latestBuy = buys.sort((a, b) => b.timestamp - a.timestamp)[0];
      const totalInvested = buys.reduce((s, a) => s + a.size * a.price, 0);
      const totalReceived = sells.reduce((s, a) => s + a.size * a.price, 0);
      const profit = totalReceived - totalInvested;
      const roi = totalInvested > 0 ? (profit / totalInvested) * 100 : 0;

      const outcome = latestBuy.outcome || 'YES';
      const betType = this.classifyBetType(outcome);

      bets.push({
        date: this.formatDate(latestBuy.timestamp),
        event: latestBuy.title || latestBuy.question || 'Mercado Polymarket',
        bet: outcome,
        betType,
        confidence: this.inferConfidence(totalInvested),
        odds: Math.round(latestBuy.price * 100 * 10) / 10,
        invested: Math.round(totalInvested),
        roi: Math.round(roi * 10) / 10,
        profit: Math.round(profit)
      });
    });

    return bets.sort((a, b) => this.parseDateStr(b.date) - this.parseDateStr(a.date));
  }

  private buildOpenBets(positions: TraderPosition[]): TraderBet[] {
    return positions
      .filter(p => !p.resolved && p.size > 0)
      .map(p => {
        const outcome = p.outcome || 'YES';
        const betType = this.classifyBetType(outcome);
        const invested = p.size * p.avgPrice;

        return {
          date: new Date().toLocaleDateString('pt-BR'),
          event: p.title || p.question || 'Mercado Polymarket',
          bet: outcome,
          betType,
          confidence: this.inferConfidence(invested),
          odds: Math.round(p.currentPrice * 100 * 10) / 10,
          invested: Math.round(invested),
          roi: null,
          profit: null
        };
      });
  }

  private buildMonthlyData(activities: TraderActivity[]): MonthlyProfit[] {
    const monthlyMap: Record<string, number> = {};

    activities.forEach(a => {
      const d = new Date(a.timestamp * 1000);
      const key = this.formatMonthKey(d);
      if (!monthlyMap[key]) monthlyMap[key] = 0;

      if (a.side === 'SELL') {
        monthlyMap[key] += a.size * a.price;
      } else if (a.side === 'BUY') {
        monthlyMap[key] -= a.size * a.price;
      }
    });

    return Object.entries(monthlyMap)
      .map(([month, value]) => ({ month, value: Math.round(value) }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }

  // ================================================
  // NORMALIZERS
  // ================================================

  private normalizeActivity(item: Record<string, unknown>): TraderActivity {
    return {
      proxyWallet: String(item.proxyWallet || item.user || item.maker || ''),
      timestamp: Number(item.timestamp || item.createdAt || Date.now() / 1000),
      side: String(item.side || item.type || 'BUY').toUpperCase(),
      asset: String(item.asset || item.tokenId || ''),
      conditionId: String(item.conditionId || item.marketId || item.asset || ''),
      size: Number(item.size || item.amount || 0),
      price: Number(item.price || item.avgPrice || 0),
      outcome: String(item.outcome || item.outcomeName || 'YES'),
      title: String(item.title || item.marketTitle || item.name || ''),
      question: String(item.question || item.marketQuestion || '')
    };
  }

  private normalizePosition(item: Record<string, unknown>): TraderPosition {
    return {
      conditionId: String(item.conditionId || item.marketId || ''),
      asset: String(item.asset || item.tokenId || ''),
      size: Number(item.size || item.amount || 0),
      avgPrice: Number(item.avgPrice || item.price || 0),
      currentPrice: Number(item.currentPrice || item.price || 0),
      outcome: String(item.outcome || item.outcomeName || 'YES'),
      title: String(item.title || item.marketTitle || ''),
      question: String(item.question || item.marketQuestion || ''),
      endDate: String(item.endDate || item.endTime || ''),
      resolved: Boolean(item.resolved || item.closed || false),
      pnl: item.pnl !== undefined ? Number(item.pnl) : undefined
    };
  }

  // ================================================
  // HELPERS
  // ================================================

  private classifyBetType(outcome: string): 'yes' | 'no' | 'team' {
    const upper = outcome.toUpperCase();
    if (upper === 'YES') return 'yes';
    if (upper === 'NO') return 'no';
    return 'team';
  }

  private inferConfidence(invested: number): 1 | 2 | 3 {
    if (invested >= 500000) return 3;
    if (invested >= 50000) return 2;
    return 1;
  }

  private formatDate(timestamp: number): string {
    const d = new Date(timestamp * 1000);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }

  private parseDateStr(dateStr: string): number {
    const parts = dateStr.split('/');
    if (parts.length !== 3) return 0;
    return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).getTime();
  }

  private formatMonthKey(d: Date): string {
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
                    'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const shortYear = String(d.getFullYear()).slice(2);
    return `${months[d.getMonth()]}/${shortYear}`;
  }

  private formatShortAddress(address: string): string {
    if (address.length < 12) return address;
    return address.slice(0, 6) + '...' + address.slice(-4);
  }

  // ================================================
  // CACHE
  // ================================================

  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  private setInCache<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      expires: Date.now() + this.TTL
    });
  }

  clearCache(): void {
    this.cache.clear();
  }
}
