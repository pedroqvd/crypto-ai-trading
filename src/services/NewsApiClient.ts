// ================================================
// NEWS API CLIENT — newsapi.org integration
// Fetches recent news relevant to a market question
// to boost confidence when fresh events are detected.
//
// Rate limits (free tier): 100 requests/day
// Strategy: only called for top opportunities (≤3/cycle),
// with a 30-min per-market cache → well within limits.
//
// Docs: https://newsapi.org/docs/endpoints/everything
// ================================================

import axios, { AxiosInstance } from 'axios';
import { config } from '../engine/Config';
import { logger } from '../utils/Logger';
import { extractKeywords } from '../utils/keywordExtractor';

const NEWS_TRANSIENT_PATTERNS = ['timeout', 'ECONNRESET', 'ECONNREFUSED', '503', '502', '429'];

async function withNewsRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const delays = [3_000, 6_000];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient = NEWS_TRANSIENT_PATTERNS.some(p => msg.toLowerCase().includes(p.toLowerCase()));
      if (!isTransient || attempt === 3) throw err;
      const delay = delays[attempt - 1] ?? delays[delays.length - 1];
      logger.warn('NewsApi', `${label} failed (attempt ${attempt}/3), retrying in ${delay / 1000}s…`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error(`${label}: max retries exceeded`);
}

export interface NewsArticle {
  title: string;
  description: string;
  source: string;
  publishedAt: string;
  url: string;
}

export interface NewsResult {
  hasRecentNews: boolean;         // True if ≥1 article found within relevance window
  sentiment: 'bullish' | 'bearish' | null; // Directional signal, null if ambiguous
  articles: NewsArticle[];        // Up to 5 most relevant recent articles
  cachedAt: number;               // Timestamp for cache TTL tracking
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30-minute cache per market question
const NO_NEWS_RESULT: NewsResult = {
  hasRecentNews: false,
  sentiment: null,
  articles: [],
  cachedAt: 0,
};

// Words that suggest the YES outcome is more likely (bullish)
const BULLISH_KEYWORDS: Array<{ word: string; weight: number }> = [
  { word: 'confirms', weight: 2 }, { word: 'confirmed', weight: 2 },
  { word: 'wins', weight: 2 },     { word: 'won', weight: 2 },
  { word: 'victory', weight: 2 },  { word: 'elected', weight: 3 },
  { word: 'approved', weight: 2 }, { word: 'passes', weight: 2 },
  { word: 'passed', weight: 2 },   { word: 'signed', weight: 2 },
  { word: 'agreement', weight: 2 }, { word: 'deal', weight: 1 },
  { word: 'achieves', weight: 2 }, { word: 'launches', weight: 1 },
  { word: 'succeeds', weight: 2 }, { word: 'breakthrough', weight: 2 },
  { word: 'rises', weight: 1 },    { word: 'surges', weight: 2 },
  { word: 'increases', weight: 1 }, { word: 'gains', weight: 1 },
  { word: 'record high', weight: 2 }, { word: 'beats', weight: 1 },
  { word: 'exceeds', weight: 1 },  { word: 'likely', weight: 1 },
  { word: 'probable', weight: 1 }, { word: 'expected', weight: 1 },
];

// Words that suggest the YES outcome is less likely (bearish)
const BEARISH_KEYWORDS: Array<{ word: string; weight: number }> = [
  { word: 'fails', weight: 2 },    { word: 'failed', weight: 2 },
  { word: 'loses', weight: 2 },    { word: 'lost', weight: 2 },
  { word: 'defeat', weight: 2 },   { word: 'rejected', weight: 2 },
  { word: 'blocked', weight: 2 },  { word: 'vetoed', weight: 3 },
  { word: 'cancels', weight: 2 },  { word: 'cancelled', weight: 2 },
  { word: 'withdraws', weight: 2 }, { word: 'collapse', weight: 2 },
  { word: 'crisis', weight: 1 },   { word: 'delays', weight: 1 },
  { word: 'postponed', weight: 2 }, { word: 'falls', weight: 1 },
  { word: 'drops', weight: 1 },    { word: 'declines', weight: 1 },
  { word: 'misses', weight: 2 },   { word: 'unlikely', weight: 2 },
  { word: 'improbable', weight: 2 }, { word: 'doubt', weight: 1 },
  { word: 'suspended', weight: 2 }, { word: 'halted', weight: 2 },
];

// High-credibility source domains (3x weight multiplier)
const HIGH_CREDIBILITY_SOURCES = new Set([
  'reuters', 'associated press', 'ap news', 'bloomberg', 'financial times',
  'the economist', 'bbc', 'npr', 'new york times', 'washington post',
  'wall street journal', 'wsj', 'apnews',
]);

// Negation words that flip the sentiment of the following keyword
const NEGATION_WORDS = new Set([
  'not', "n't", 'never', 'no', 'fails to', 'failed to', 'unable to',
  'won\'t', 'doesn\'t', 'didn\'t', 'cannot', 'can\'t',
]);

export class NewsApiClient {
  private client: AxiosInstance | null = null;
  private cache: Map<string, NewsResult> = new Map();
  private enabled: boolean;

  constructor() {
    this.enabled = config.newsApiKey.length > 0;

    if (this.enabled) {
      this.client = axios.create({
        baseURL: 'https://newsapi.org/v2',
        timeout: 10_000,
        headers: {
          'Accept': 'application/json',
          'X-Api-Key': config.newsApiKey,
        },
      });
      logger.info('NewsApi', '✅ NewsAPI client initialized');
    }
  }

  async testConnection(): Promise<boolean> {
    if (!this.enabled || !this.client) return false;
    try {
      // Test the API key with a simple query
      await this.client.get('/everything', {
        params: { q: 'ping', pageSize: 1 },
      });
      return true;
    } catch {
      return false;
    }
  }

  // ========================================
  // SEARCH FOR NEWS RELEVANT TO A MARKET
  // ========================================
  async searchRelevantNews(question: string): Promise<NewsResult> {
    if (!this.enabled || !this.client) return { ...NO_NEWS_RESULT };

    // Check cache — use full question as key to avoid false hits from shared 80-char prefixes.
    const cacheKey = question.toLowerCase();
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      logger.debug('NewsApi', `Cache hit for: "${question.substring(0, 40)}..."`);
      return cached;
    }

    try {
      const keywords = extractKeywords(question);
      if (keywords.length === 0) return { ...NO_NEWS_RESULT };

      const query = keywords.slice(0, 4).join(' AND ');
      const from = new Date(Date.now() - config.newsRelevanceHours * 60 * 60 * 1000).toISOString();

      const response = await withNewsRetry(
        () => this.client!.get('/everything', { params: { q: query, from, sortBy: 'publishedAt', language: 'en', pageSize: 5 } }),
        `searchNews("${question.substring(0, 30)}")`
      );

      const rawArticles = response.data?.articles || [];

      const articles: NewsArticle[] = rawArticles.map((a: any) => ({
        title: a.title || '',
        description: a.description || '',
        source: a.source?.name || '',
        publishedAt: a.publishedAt || '',
        url: a.url || '',
      }));

      const hasRecentNews = articles.length > 0;
      const sentiment = hasRecentNews
        ? this.analyzeSentiment(articles, question)
        : null;

      const result: NewsResult = {
        hasRecentNews,
        sentiment,
        articles,
        cachedAt: Date.now(),
      };

      this.cache.set(cacheKey, result);

      logger.debug('NewsApi',
        `"${question.substring(0, 40)}..." → ${articles.length} artigos, ` +
        `sentiment: ${sentiment ?? 'null'}`
      );

      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Log as debug to avoid noise from rate limits or network issues
      logger.debug('NewsApi', `Failed to fetch news for "${question.substring(0, 40)}...": ${msg}`);
      return { ...NO_NEWS_RESULT };
    }
  }

  // ========================================
  // HELPERS
  // ========================================


  /**
   * Analyze the sentiment of articles relative to the YES outcome.
   *
   * Improvements over naive keyword counting:
   *   1. Negation detection: "not approved" → bearish, not bullish
   *   2. Source credibility: Reuters/Bloomberg articles count 3× more
   *   3. Recency weighting: articles in past 24h count 2×, past 72h count 1.5×
   *   4. Weighted keywords: strong signals (elected, vetoed) count more
   */
  private analyzeSentiment(articles: NewsArticle[], _question: string): 'bullish' | 'bearish' | null {
    let bullishScore = 0;
    let bearishScore = 0;
    const now = Date.now();

    for (const article of articles) {
      const credibilityMultiplier = this.sourceCredibility(article.source);

      // Recency multiplier: fresher = more relevant
      const publishedMs = article.publishedAt ? new Date(article.publishedAt).getTime() : 0;
      const ageHours = publishedMs > 0 ? (now - publishedMs) / 3_600_000 : 48;
      const recencyMultiplier = ageHours <= 24 ? 2.0 : ageHours <= 72 ? 1.5 : 1.0;

      const articleMultiplier = credibilityMultiplier * recencyMultiplier;
      const text = `${article.title} ${article.description}`.toLowerCase();
      const tokens = text.split(/\s+/);

      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        // Check for 2-gram (bigram) first
        const bigram = i + 1 < tokens.length ? `${token} ${tokens[i + 1]}` : '';

        for (const kw of BULLISH_KEYWORDS) {
          if (token === kw.word || bigram === kw.word) {
            const negated = this.isNegated(tokens, i);
            if (negated) bearishScore += kw.weight * articleMultiplier;
            else          bullishScore += kw.weight * articleMultiplier;
          }
        }

        for (const kw of BEARISH_KEYWORDS) {
          if (token === kw.word || bigram === kw.word) {
            const negated = this.isNegated(tokens, i);
            if (negated) bullishScore += kw.weight * articleMultiplier;
            else          bearishScore += kw.weight * articleMultiplier;
          }
        }
      }
    }

    if (bullishScore === 0 && bearishScore === 0) return null;

    const total = bullishScore + bearishScore;
    const bullishRatio = bullishScore / total;

    // Require stronger signal threshold to avoid noise
    if (bullishRatio > 0.68) return 'bullish';
    if (bullishRatio < 0.32) return 'bearish';

    return null;
  }

  private sourceCredibility(sourceName: string): number {
    const lower = sourceName.toLowerCase();
    for (const credible of HIGH_CREDIBILITY_SOURCES) {
      if (lower.includes(credible)) return 3.0;
    }
    return 1.0;
  }

  // Returns true when any of the 3 tokens before position i is a negation word
  private isNegated(tokens: string[], i: number): boolean {
    const lookback = 3;
    for (let j = Math.max(0, i - lookback); j < i; j++) {
      if (NEGATION_WORDS.has(tokens[j])) return true;
    }
    return false;
  }
}
