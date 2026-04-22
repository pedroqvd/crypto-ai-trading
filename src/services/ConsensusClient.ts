// ================================================
// CONSENSUS CLIENT — External prediction markets
// Fetches crowd wisdom from Metaculus & Manifold
// to use as an independent probability signal.
//
// Rate limits:
//   Metaculus: ~200 req/day free tier (no auth needed for reads)
//   Manifold:  unlimited reads (free API)
//
// Strategy: called only for top opportunities where
// initial edge > minEdge/2, max 10 lookups/cycle,
// 30-min cache per question.
// ================================================

import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/Logger';
import { extractKeywords } from '../utils/keywordExtractor';

export interface ConsensusEstimate {
  source: 'metaculus' | 'manifold';
  probability: number;    // 0-1
  nForecasters: number;   // number of forecasters/traders
  confidence: number;     // 0-1 derived from nForecasters + recency
  resolveTime?: string;   // ISO string if known
  url?: string;
}

interface CachedResult {
  estimates: ConsensusEstimate[];
  fetchedAt: number;
}

const CACHE_TTL_MS   = 30 * 60 * 1000; // 30-min cache
const MAX_PER_CYCLE  = 10;              // budget per scan cycle
const MIN_SIMILARITY = 0.35;           // minimum token overlap to accept a match

export class ConsensusClient {
  private metaculusClient: AxiosInstance;
  private manifoldClient: AxiosInstance;
  private cache = new Map<string, CachedResult>();
  private cycleCallCount = 0;

  constructor() {
    this.metaculusClient = axios.create({
      baseURL: 'https://www.metaculus.com/api2',
      timeout: 8_000,
      headers: { 'Accept': 'application/json' },
    });

    this.manifoldClient = axios.create({
      baseURL: 'https://api.manifold.markets/v0',
      timeout: 8_000,
      headers: { 'Accept': 'application/json' },
    });
  }

  resetCycleCounter(): void {
    this.cycleCallCount = 0;
  }

  // ========================================
  // MAIN ENTRY POINT
  // Returns combined estimates from both sources.
  // Returns [] if budget exhausted or question doesn't match.
  // ========================================
  async getConsensus(question: string): Promise<ConsensusEstimate[]> {
    if (this.cycleCallCount >= MAX_PER_CYCLE) return [];

    const cacheKey = question.toLowerCase();
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.estimates;
    }

    this.cycleCallCount++;

    const [metaculus, manifold] = await Promise.allSettled([
      this.fetchMetaculus(question),
      this.fetchManifold(question),
    ]);

    const estimates: ConsensusEstimate[] = [];
    if (metaculus.status === 'fulfilled') estimates.push(...metaculus.value);
    if (manifold.status === 'fulfilled')  estimates.push(...manifold.value);

    this.cache.set(cacheKey, { estimates, fetchedAt: Date.now() });
    return estimates;
  }

  // ========================================
  // METACULUS
  // ========================================
  private async fetchMetaculus(question: string): Promise<ConsensusEstimate[]> {
    try {
      const keywords = extractKeywords(question).slice(0, 4).map(w => w.toLowerCase()).join(' ');
      if (!keywords) return [];

      const resp = await this.metaculusClient.get('/questions/', {
        params: {
          search: keywords,
          status: 'open',
          type: 'forecast',
          limit: 5,
          order_by: '-activity',
        },
      });

      const results = resp.data?.results ?? [];
      const estimates: ConsensusEstimate[] = [];

      for (const q of results) {
        const sim = tokenSimilarity(question, q.title ?? '');
        if (sim < MIN_SIMILARITY) continue;

        // community_prediction is a nested object; .full.q2 is the median
        const prob = q.community_prediction?.full?.q2 ?? q.community_prediction?.q2;
        if (prob === undefined || prob === null) continue;

        const n = q.number_of_predictions ?? 0;
        const confidence = Math.min(0.9, 0.3 + Math.log10(Math.max(1, n)) * 0.15);

        estimates.push({
          source: 'metaculus',
          probability: Number(prob),
          nForecasters: n,
          confidence,
          resolveTime: q.resolve_time,
          url: `https://www.metaculus.com${q.page_url ?? ''}`,
        });

        // Keep only the best-matching Metaculus question
        break;
      }

      return estimates;
    } catch (err) {
      logger.debug('Consensus', `Metaculus fetch failed: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }

  // ========================================
  // MANIFOLD MARKETS
  // ========================================
  private async fetchManifold(question: string): Promise<ConsensusEstimate[]> {
    try {
      const keywords = extractKeywords(question).slice(0, 4).map(w => w.toLowerCase()).join(' ');
      if (!keywords) return [];

      const resp = await this.manifoldClient.get('/search-markets', {
        params: {
          term: keywords,
          filter: 'open',
          sort: 'score',
          contractType: 'BINARY',
          limit: 5,
        },
      });

      const markets: Array<Record<string, unknown>> = resp.data ?? [];
      const estimates: ConsensusEstimate[] = [];

      for (const m of markets) {
        const title = (m.question as string) ?? '';
        const sim = tokenSimilarity(question, title);
        if (sim < MIN_SIMILARITY) continue;

        const prob = typeof m.probability === 'number' ? m.probability : null;
        if (prob === null) continue;

        const n = typeof m.uniqueBettorCount === 'number' ? m.uniqueBettorCount : 0;
        const confidence = Math.min(0.9, 0.25 + Math.log10(Math.max(1, n)) * 0.15);

        estimates.push({
          source: 'manifold',
          probability: prob,
          nForecasters: n,
          confidence,
          url: (m.url as string) ?? undefined,
        });

        break;
      }

      return estimates;
    } catch (err) {
      logger.debug('Consensus', `Manifold fetch failed: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }
}

// ========================================
// HELPERS
// ========================================

// Jaccard token overlap similarity using the shared keyword extractor.
// Lowercases for case-insensitive matching.
function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(extractKeywords(a).map(w => w.toLowerCase()));
  const tb = new Set(extractKeywords(b).map(w => w.toLowerCase()));
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) { if (tb.has(t)) intersection++; }
  return intersection / (ta.size + tb.size - intersection);
}
