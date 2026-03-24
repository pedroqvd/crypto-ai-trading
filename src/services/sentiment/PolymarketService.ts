// ================================================
// POLYMARKET SERVICE - Prediction Markets Sentiment
// Gamma API (público, sem auth): https://gamma-api.polymarket.com
// CLOB API (público para leitura): https://clob.polymarket.com
// ================================================

import axios, { AxiosInstance } from 'axios';

interface PolymarketEvent {
  id: string;
  title: string;
  slug: string;
  description: string;
  startDate: string;
  endDate: string;
  active: boolean;
  closed: boolean;
  liquidity: number;
  volume: number;
  markets: PolymarketMarket[];
}

interface PolymarketMarket {
  id: string;
  question: string;
  outcomePrices: string; // JSON stringified array e.g. "[0.65, 0.35]"
  volume: string;
  liquidity: string;
  active: boolean;
  closed: boolean;
}

interface MarketSentiment {
  question: string;
  yesPrice: number;   // probabilidade de "Sim" (0-1)
  noPrice: number;     // probabilidade de "Não" (0-1)
  volume: number;
  liquidity: number;
  active: boolean;
}

interface CryptoSentimentReport {
  timestamp: number;
  cryptoMarkets: MarketSentiment[];
  overallSentiment: 'bullish' | 'bearish' | 'neutral';
  sentimentScore: number; // 0-100
  summary: string;
}

export class PolymarketService {
  private gammaClient: AxiosInstance;
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private cacheTTL = 120000; // 2 min

  // Termos para buscar mercados relacionados a crypto
  private readonly CRYPTO_KEYWORDS = [
    'bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'cryptocurrency',
    'solana', 'sol', 'defi', 'blockchain', 'web3', 'token',
    'binance', 'coinbase', 'sec', 'etf', 'stablecoin'
  ];

  constructor() {
    this.gammaClient = axios.create({
      baseURL: 'https://gamma-api.polymarket.com',
      timeout: 15000,
      headers: { 'Accept': 'application/json' }
    });

    console.log('🔮 PolymarketService inicializado');
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
  // BUSCAR EVENTOS CRYPTO NO POLYMARKET
  // ========================================
  async getCryptoEvents(limit = 20): Promise<PolymarketEvent[]> {
    const cacheKey = `crypto_events:${limit}`;
    const cached = this.getCached<PolymarketEvent[]>(cacheKey);
    if (cached) return cached;

    try {
      // Buscar eventos ativos relacionados a crypto
      const response = await this.gammaClient.get('/events', {
        params: {
          active: true,
          closed: false,
          limit,
          order: 'volume',
          ascending: false
        }
      });

      const allEvents: PolymarketEvent[] = response.data || [];

      // Filtrar por keywords crypto
      const cryptoEvents = allEvents.filter((event: PolymarketEvent) => {
        const text = `${event.title} ${event.description}`.toLowerCase();
        return this.CRYPTO_KEYWORDS.some(keyword => text.includes(keyword));
      });

      this.setCache(cacheKey, cryptoEvents);
      return cryptoEvents;
    } catch (error) {
      console.error('❌ Polymarket getCryptoEvents error:', error instanceof Error ? error.message : error);
      return [];
    }
  }

  // ========================================
  // BUSCAR MERCADOS POR KEYWORD
  // ========================================
  async searchMarkets(query: string, limit = 10): Promise<MarketSentiment[]> {
    const cacheKey = `search:${query}:${limit}`;
    const cached = this.getCached<MarketSentiment[]>(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.gammaClient.get('/markets', {
        params: {
          active: true,
          closed: false,
          limit,
          order: 'volume',
          ascending: false
        }
      });

      const markets: any[] = response.data || [];
      const queryLower = query.toLowerCase();

      const filtered = markets
        .filter((m: any) => m.question?.toLowerCase().includes(queryLower))
        .map((m: any) => this.parseMarket(m));

      this.setCache(cacheKey, filtered);
      return filtered;
    } catch (error) {
      console.error('❌ Polymarket searchMarkets error:', error instanceof Error ? error.message : error);
      return [];
    }
  }

  // ========================================
  // MERCADOS COM MAIS VOLUME (TOP MARKETS)
  // ========================================
  async getTopMarkets(limit = 20): Promise<MarketSentiment[]> {
    const cacheKey = `top_markets:${limit}`;
    const cached = this.getCached<MarketSentiment[]>(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.gammaClient.get('/markets', {
        params: {
          active: true,
          closed: false,
          limit,
          order: 'volume',
          ascending: false
        }
      });

      const markets = (response.data || []).map((m: any) => this.parseMarket(m));

      this.setCache(cacheKey, markets);
      return markets;
    } catch (error) {
      console.error('❌ Polymarket getTopMarkets error:', error instanceof Error ? error.message : error);
      return [];
    }
  }

  // ========================================
  // RELATÓRIO DE SENTIMENTO CRYPTO
  // ========================================
  async getCryptoSentimentReport(): Promise<CryptoSentimentReport> {
    const cacheKey = 'crypto_sentiment_report';
    const cached = this.getCached<CryptoSentimentReport>(cacheKey);
    if (cached) return cached;

    try {
      // Buscar mercados crypto-related
      const allMarkets = await this.getTopMarkets(100);

      const cryptoMarkets = allMarkets.filter(m => {
        const text = m.question.toLowerCase();
        return this.CRYPTO_KEYWORDS.some(k => text.includes(k));
      });

      // Calcular sentimento geral baseado nos mercados
      const sentimentScore = this.calculateSentimentScore(cryptoMarkets);
      const overallSentiment = sentimentScore >= 60 ? 'bullish' : sentimentScore <= 40 ? 'bearish' : 'neutral';

      const report: CryptoSentimentReport = {
        timestamp: Date.now(),
        cryptoMarkets: cryptoMarkets.slice(0, 15), // top 15
        overallSentiment,
        sentimentScore,
        summary: this.generateSummary(cryptoMarkets, sentimentScore, overallSentiment)
      };

      this.setCache(cacheKey, report);
      return report;
    } catch (error) {
      console.error('❌ Polymarket getCryptoSentimentReport error:', error instanceof Error ? error.message : error);
      return {
        timestamp: Date.now(),
        cryptoMarkets: [],
        overallSentiment: 'neutral',
        sentimentScore: 50,
        summary: 'Dados do Polymarket indisponíveis no momento.'
      };
    }
  }

  // ========================================
  // HELPERS
  // ========================================
  private parseMarket(m: any): MarketSentiment {
    let yesPrice = 0.5;
    let noPrice = 0.5;

    try {
      if (m.outcomePrices) {
        const prices = JSON.parse(m.outcomePrices);
        yesPrice = parseFloat(prices[0]) || 0.5;
        noPrice = parseFloat(prices[1]) || 0.5;
      }
    } catch {
      // fallback defaults
    }

    return {
      question: m.question || 'Unknown',
      yesPrice,
      noPrice,
      volume: parseFloat(m.volume) || 0,
      liquidity: parseFloat(m.liquidity) || 0,
      active: m.active ?? true
    };
  }

  private calculateSentimentScore(markets: MarketSentiment[]): number {
    if (markets.length === 0) return 50;

    // Ponderar pelo volume - mercados com mais volume têm mais peso
    let weightedSum = 0;
    let totalWeight = 0;

    for (const market of markets) {
      const question = market.question.toLowerCase();
      const weight = Math.log(market.volume + 1);

      // Interpretar: mercados bullish (preço alto, ATH, approval, etc)
      const isBullishQuestion = /price|above|ath|high|reach|hit|over|bull|approve|pass|accept/i.test(question);
      const isBearishQuestion = /crash|below|fall|drop|bear|reject|ban|decline/i.test(question);

      if (isBullishQuestion) {
        weightedSum += market.yesPrice * 100 * weight;
        totalWeight += weight;
      } else if (isBearishQuestion) {
        weightedSum += (1 - market.yesPrice) * 100 * weight;
        totalWeight += weight;
      }
    }

    if (totalWeight === 0) return 50;
    return Math.round(weightedSum / totalWeight);
  }

  private generateSummary(markets: MarketSentiment[], score: number, sentiment: string): string {
    const sentimentPt = sentiment === 'bullish' ? 'otimista' : sentiment === 'bearish' ? 'pessimista' : 'neutro';

    let summary = `Polymarket Crypto Sentiment: ${score}/100 (${sentimentPt}). `;
    summary += `${markets.length} mercados crypto ativos encontrados. `;

    // Top 3 mercados por volume
    const topByVolume = [...markets].sort((a, b) => b.volume - a.volume).slice(0, 3);
    if (topByVolume.length > 0) {
      summary += 'Top mercados: ';
      summary += topByVolume.map(m =>
        `"${m.question.substring(0, 60)}..." (Sim: ${(m.yesPrice * 100).toFixed(0)}%)`
      ).join('; ');
      summary += '.';
    }

    return summary;
  }

  // ========================================
  // HEALTH CHECK
  // ========================================
  async healthCheck(): Promise<{ status: string; timestamp: number }> {
    try {
      await this.gammaClient.get('/events', { params: { limit: 1 } });
      return { status: 'operational', timestamp: Date.now() };
    } catch {
      return { status: 'error', timestamp: Date.now() };
    }
  }
}
