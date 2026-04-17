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
const BULLISH_KEYWORDS = [
  'confirms', 'confirmed', 'wins', 'won', 'victory', 'elected', 'approved',
  'passes', 'passed', 'signed', 'agrees', 'agreement', 'deal', 'achieves',
  'launches', 'succeeds', 'announces', 'breakthrough', 'rises', 'surges',
  'increases', 'gains', 'record', 'high', 'beats', 'exceeds', 'positive',
  'yes', 'will', 'likely', 'probable',
];

// Words that suggest the YES outcome is less likely (bearish)
const BEARISH_KEYWORDS = [
  'fails', 'failed', 'loses', 'lost', 'defeat', 'rejected', 'blocked',
  'vetoed', 'cancels', 'cancelled', 'withdraws', 'collapse', 'crisis',
  'delays', 'postponed', 'falls', 'drops', 'declines', 'decreases',
  'misses', 'below', 'no', 'unlikely', 'improbable', 'doubt',
];

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
    } else {
      logger.info('NewsApi', 'NEWS_API_KEY not set — news boost disabled');
    }
  }

  // ========================================
  // SEARCH FOR NEWS RELEVANT TO A MARKET
  // ========================================
  async searchRelevantNews(question: string): Promise<NewsResult> {
    if (!this.enabled || !this.client) return { ...NO_NEWS_RESULT };

    // Check cache
    const cacheKey = question.substring(0, 80).toLowerCase();
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      logger.debug('NewsApi', `Cache hit for: "${question.substring(0, 40)}..."`);
      return cached;
    }

    try {
      const keywords = this.extractKeywords(question);
      if (keywords.length === 0) return { ...NO_NEWS_RESULT };

      const query = keywords.slice(0, 4).join(' AND ');
      const from = new Date(Date.now() - config.newsRelevanceHours * 60 * 60 * 1000).toISOString();

      const response = await this.client.get('/everything', {
        params: {
          q: query,
          from,
          sortBy: 'publishedAt',
          language: 'en',
          pageSize: 5,
        },
      });

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
   * Extract the most meaningful search keywords from a prediction market question.
   * Strips common question words and focuses on proper nouns and key verbs.
   */
  private extractKeywords(question: string): string[] {
    const stopWords = new Set([
      'will', 'the', 'a', 'an', 'be', 'is', 'are', 'was', 'were',
      'in', 'on', 'at', 'by', 'for', 'of', 'to', 'and', 'or', 'but',
      'if', 'that', 'this', 'which', 'who', 'what', 'when', 'where',
      'how', 'than', 'with', 'from', 'has', 'have', 'had', 'do', 'does',
      'did', 'not', 'no', 'more', 'than', 'its', 'their', 'any',
    ]);

    const words = question
      .replace(/[?.,!()]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()))
      .map(w => w.replace(/['"]/g, ''));

    // Prioritize capitalized words (proper nouns) and longer words
    const scored = words.map(w => ({
      word: w,
      score: (w[0] === w[0].toUpperCase() ? 2 : 0) + (w.length > 6 ? 1 : 0),
    }));

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, 6).map(s => s.word);
  }

  /**
   * Analyze the sentiment of articles relative to the YES outcome.
   * Returns 'bullish' if articles suggest YES is more likely,
   * 'bearish' if they suggest NO, null if ambiguous.
   */
  private analyzeSentiment(articles: NewsArticle[], question: string): 'bullish' | 'bearish' | null {
    let bullishScore = 0;
    let bearishScore = 0;

    for (const article of articles) {
      const text = `${article.title} ${article.description}`.toLowerCase();

      for (const kw of BULLISH_KEYWORDS) {
        if (text.includes(kw)) bullishScore++;
      }
      for (const kw of BEARISH_KEYWORDS) {
        if (text.includes(kw)) bearishScore++;
      }
    }

    if (bullishScore === 0 && bearishScore === 0) return null;

    const total = bullishScore + bearishScore;
    const bullishRatio = bullishScore / total;

    // Only signal strong sentiment — avoid noise
    if (bullishRatio > 0.65) return 'bullish';
    if (bullishRatio < 0.35) return 'bearish';

    return null; // Too ambiguous
  }
}
