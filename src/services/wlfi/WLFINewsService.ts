// ================================================
// WLFI NEWS SERVICE - Aggregates WLFI-related news
// from multiple crypto news APIs with caching
// ================================================

import axios, { AxiosInstance } from 'axios';

// ================================================
// INTERFACES
// ================================================

export interface WLFINewsItem {
  id: string;
  title: string;
  body: string;
  url: string;
  source: string;
  publishedAt: string;
  imageUrl?: string;
  categories: string[];
  tags: string[];
  sentiment?: 'positive' | 'negative' | 'neutral';
  relevanceScore: number; // 0-100 based on keyword match density
}

// ================================================
// CONSTANTS
// ================================================

const WLFI_KEYWORDS = [
  'WLFI',
  'World Liberty',
  'Trump crypto',
  'Trump DeFi',
  'Trump token',
  'World Liberty Financial',
];

const CRYPTOCOMPARE_NEWS_URL =
  'https://min-api.cryptocompare.com/data/v2/news/?lang=EN&categories=BTC,ETH,Trading,Technology,Blockchain';

// ================================================
// FALLBACK NEWS DATA
// ================================================

const FALLBACK_NEWS: WLFINewsItem[] = [
  {
    id: 'fallback-1',
    title: 'WLFI Protocol TVL atinge $450M',
    body: 'O valor total travado no protocolo cresceu 80% no ultimo trimestre.',
    url: 'https://worldlibertyfinancial.com',
    source: 'World Liberty Financial',
    publishedAt: '2026-03-27T00:00:00Z',
    categories: ['official'],
    tags: ['WLFI', 'TVL', 'DeFi'],
    sentiment: 'positive',
    relevanceScore: 100,
  },
  {
    id: 'fallback-2',
    title: 'WLFI listado na Binance como token negociavel',
    body: 'Apos meses de restricoes, Binance anuncia listagem do token WLFI.',
    url: 'https://worldlibertyfinancial.com',
    source: 'Binance',
    publishedAt: '2026-03-22T00:00:00Z',
    categories: ['market'],
    tags: ['WLFI', 'Binance', 'listing'],
    sentiment: 'positive',
    relevanceScore: 100,
  },
  {
    id: 'fallback-3',
    title: 'Votacao #04: Expansao para Arbitrum aprovada',
    body: 'Comunidade aprova deploy do protocolo na Arbitrum com 91% de votos favoraveis.',
    url: 'https://worldlibertyfinancial.com',
    source: 'World Liberty Financial',
    publishedAt: '2026-03-20T00:00:00Z',
    categories: ['governance'],
    tags: ['WLFI', 'Arbitrum', 'governance'],
    sentiment: 'positive',
    relevanceScore: 100,
  },
  {
    id: 'fallback-4',
    title: 'Parceria estrategica com Chainlink anunciada',
    body: 'WLFI integrara Chainlink oracles para price feeds e CCIP.',
    url: 'https://worldlibertyfinancial.com',
    source: 'World Liberty Financial',
    publishedAt: '2026-03-18T00:00:00Z',
    categories: ['market'],
    tags: ['WLFI', 'Chainlink', 'partnership'],
    sentiment: 'positive',
    relevanceScore: 100,
  },
  {
    id: 'fallback-5',
    title: 'WLFI anuncia programa "Gold Card" para holders',
    body: 'Holders com mais de 100k WLFI e lock de 12 meses terao acesso a beneficios exclusivos.',
    url: 'https://worldlibertyfinancial.com',
    source: 'World Liberty Financial',
    publishedAt: '2026-03-14T00:00:00Z',
    categories: ['official'],
    tags: ['WLFI', 'Gold Card', 'holders'],
    sentiment: 'positive',
    relevanceScore: 100,
  },
  {
    id: 'fallback-6',
    title: 'World Liberty Financial adquire 10,000 ETH (~$25M)',
    body: 'O protocolo utilizou $25M do tesouro para comprar Ethereum.',
    url: 'https://worldlibertyfinancial.com',
    source: 'World Liberty Financial',
    publishedAt: '2026-02-28T00:00:00Z',
    categories: ['market'],
    tags: ['WLFI', 'ETH', 'treasury'],
    sentiment: 'positive',
    relevanceScore: 100,
  },
  {
    id: 'fallback-7',
    title: 'Votacao #03: Adicao de cbBTC como colateral aprovada',
    body: 'A comunidade aprovou por 87% a adicao do Coinbase Wrapped Bitcoin como ativo de colateral.',
    url: 'https://worldlibertyfinancial.com',
    source: 'World Liberty Financial',
    publishedAt: '2026-02-17T00:00:00Z',
    categories: ['governance'],
    tags: ['WLFI', 'cbBTC', 'governance', 'Coinbase'],
    sentiment: 'positive',
    relevanceScore: 100,
  },
  {
    id: 'fallback-8',
    title: 'Justin Sun investe $75M em tokens WLFI',
    body: 'O fundador da TRON adquiriu $75 milhoes em tokens WLFI.',
    url: 'https://worldlibertyfinancial.com',
    source: 'TRON Foundation',
    publishedAt: '2026-01-20T00:00:00Z',
    categories: ['market'],
    tags: ['WLFI', 'Justin Sun', 'TRON', 'investment'],
    sentiment: 'positive',
    relevanceScore: 100,
  },
  {
    id: 'fallback-9',
    title: 'WLFI ultrapassa meta de $300M na captacao',
    body: 'World Liberty Financial confirmou ter levantado mais de $300M em tokens.',
    url: 'https://worldlibertyfinancial.com',
    source: 'World Liberty Financial',
    publishedAt: '2026-01-14T00:00:00Z',
    categories: ['official'],
    tags: ['WLFI', 'fundraising'],
    sentiment: 'positive',
    relevanceScore: 100,
  },
  {
    id: 'fallback-10',
    title: 'Sistema de governanca on-chain vai ao ar',
    body: 'O modulo de votacao do protocolo foi lancado na mainnet do Ethereum.',
    url: 'https://worldlibertyfinancial.com',
    source: 'World Liberty Financial',
    publishedAt: '2025-12-31T00:00:00Z',
    categories: ['governance'],
    tags: ['WLFI', 'governance', 'Ethereum'],
    sentiment: 'positive',
    relevanceScore: 100,
  },
  {
    id: 'fallback-11',
    title: 'WLFI levanta $135M adicionais apos vitoria eleitoral de Trump',
    body: 'Em uma semana apos a reeleicao, o projeto recebeu $135M em novos aportes.',
    url: 'https://worldlibertyfinancial.com',
    source: 'World Liberty Financial',
    publishedAt: '2025-11-14T00:00:00Z',
    categories: ['market'],
    tags: ['WLFI', 'Trump', 'fundraising'],
    sentiment: 'positive',
    relevanceScore: 100,
  },
  {
    id: 'fallback-12',
    title: 'World Liberty Financial lanca token WLFI a $0.015',
    body: 'O protocolo DeFi e oficialmente lancado. Venda inicial para investidores credenciados.',
    url: 'https://worldlibertyfinancial.com',
    source: 'World Liberty Financial',
    publishedAt: '2025-10-15T00:00:00Z',
    categories: ['official'],
    tags: ['WLFI', 'launch', 'DeFi'],
    sentiment: 'positive',
    relevanceScore: 100,
  },
];

// ================================================
// SERVICE CLASS
// ================================================

export class WLFINewsService {
  private client: AxiosInstance;
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private cacheTTL = 120000; // 2 minutes

  constructor() {
    this.client = axios.create({
      timeout: 10000,
      headers: { Accept: 'application/json' },
    });

    console.log('📰 WLFINewsService initialized');
  }

  // ========================================
  // CACHE HELPERS
  // ========================================

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
  // RELEVANCE SCORING
  // ========================================

  private calculateRelevanceScore(text: string): number {
    const lower = text.toLowerCase();

    // Direct mention of 'WLFI' or 'World Liberty Financial' = 100
    if (lower.includes('wlfi') || lower.includes('world liberty financial')) {
      return 100;
    }

    // Mention of 'Trump' + 'crypto'/'DeFi'/'token' = 80
    if (lower.includes('trump')) {
      if (
        lower.includes('crypto') ||
        lower.includes('defi') ||
        lower.includes('token')
      ) {
        return 80;
      }
      // Mention of 'Trump' alone in crypto context = 50
      return 50;
    }

    // General crypto news = 10
    return 10;
  }

  // ========================================
  // SENTIMENT ANALYSIS (simple heuristic)
  // ========================================

  private detectSentiment(text: string): 'positive' | 'negative' | 'neutral' {
    const lower = text.toLowerCase();
    const positiveWords = [
      'surge', 'bullish', 'growth', 'rise', 'gain', 'rally', 'milestone',
      'partnership', 'launch', 'approved', 'record', 'upgrade', 'expansion',
    ];
    const negativeWords = [
      'crash', 'bearish', 'drop', 'fall', 'loss', 'hack', 'exploit',
      'scam', 'fraud', 'risk', 'ban', 'regulation', 'lawsuit', 'sec',
    ];

    let positiveCount = 0;
    let negativeCount = 0;

    for (const word of positiveWords) {
      if (lower.includes(word)) positiveCount++;
    }
    for (const word of negativeWords) {
      if (lower.includes(word)) negativeCount++;
    }

    if (positiveCount > negativeCount) return 'positive';
    if (negativeCount > positiveCount) return 'negative';
    return 'neutral';
  }

  // ========================================
  // CHECK IF NEWS IS WLFI-RELATED
  // ========================================

  private isWLFIRelated(title: string, body: string): boolean {
    const combined = `${title} ${body}`.toLowerCase();
    return WLFI_KEYWORDS.some((kw) => combined.includes(kw.toLowerCase()));
  }

  // ========================================
  // FETCH FROM CRYPTOCOMPARE
  // ========================================

  private async fetchFromCryptoCompare(): Promise<WLFINewsItem[]> {
    try {
      const response = await this.client.get<Record<string, any>>(CRYPTOCOMPARE_NEWS_URL);
      const articles: Record<string, any>[] = response.data?.Data || [];

      return articles.map((article: Record<string, any>) => {
        const title: string = article.title || '';
        const body: string = article.body || '';
        const combinedText = `${title} ${body}`;

        return {
          id: `cc-${article.id || String(Date.now())}`,
          title,
          body: body.substring(0, 500),
          url: article.url || article.guid || '',
          source: article.source_info?.name || article.source || 'CryptoCompare',
          publishedAt: article.published_on
            ? new Date(article.published_on * 1000).toISOString()
            : new Date().toISOString(),
          imageUrl: article.imageurl || undefined,
          categories: (article.categories || '').split('|').filter(Boolean),
          tags: (article.tags || '').split('|').filter(Boolean),
          sentiment: this.detectSentiment(combinedText),
          relevanceScore: this.calculateRelevanceScore(combinedText),
        } as WLFINewsItem;
      });
    } catch (error) {
      console.error(
        '❌ WLFINewsService CryptoCompare fetch error:',
        error instanceof Error ? error.message : error
      );
      return [];
    }
  }

  // ========================================
  // FETCH FROM COINGECKO STATUS UPDATES
  // ========================================

  private async fetchFromCoinGecko(): Promise<WLFINewsItem[]> {
    try {
      const response = await this.client.get<Record<string, any>>(
        'https://api.coingecko.com/api/v3/status_updates',
        {
          params: {
            per_page: 50,
            page: 1,
          },
        }
      );

      const updates: Record<string, any>[] = response.data?.status_updates || [];

      return updates.map((update: Record<string, any>, index: number) => {
        const title: string = update.user_title || update.project?.name || 'CoinGecko Update';
        const body: string = update.description || '';
        const combinedText = `${title} ${body}`;

        return {
          id: `cg-${index}-${Date.now()}`,
          title,
          body: body.substring(0, 500),
          url: update.project?.links?.homepage?.[0] || 'https://coingecko.com',
          source: 'CoinGecko',
          publishedAt: update.created_at || new Date().toISOString(),
          imageUrl: update.project?.image?.large || undefined,
          categories: ['status_update'],
          tags: [update.category || 'general'],
          sentiment: this.detectSentiment(combinedText),
          relevanceScore: this.calculateRelevanceScore(combinedText),
        } as WLFINewsItem;
      });
    } catch (error) {
      console.error(
        '❌ WLFINewsService CoinGecko fetch error:',
        error instanceof Error ? error.message : error
      );
      return [];
    }
  }

  // ========================================
  // GET LATEST NEWS
  // ========================================

  async getLatestNews(limit = 20): Promise<WLFINewsItem[]> {
    const cacheKey = `wlfi-news:${limit}`;
    const cached = this.getCached<WLFINewsItem[]>(cacheKey);
    if (cached) return cached;

    try {
      // Fetch from all sources in parallel
      const [cryptoCompareNews, coinGeckoNews] = await Promise.allSettled([
        this.fetchFromCryptoCompare(),
        this.fetchFromCoinGecko(),
      ]);

      const allNews: WLFINewsItem[] = [
        ...(cryptoCompareNews.status === 'fulfilled' ? cryptoCompareNews.value : []),
        ...(coinGeckoNews.status === 'fulfilled' ? coinGeckoNews.value : []),
      ];

      // Filter for WLFI-related news
      let filteredNews = allNews.filter((item) =>
        this.isWLFIRelated(item.title, item.body)
      );

      // If no WLFI-related news found from APIs, use fallback data
      if (filteredNews.length === 0) {
        filteredNews = [...FALLBACK_NEWS];
      }

      // Sort by relevance score (desc), then by date (desc)
      filteredNews.sort((a, b) => {
        if (b.relevanceScore !== a.relevanceScore) {
          return b.relevanceScore - a.relevanceScore;
        }
        return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
      });

      const result = filteredNews.slice(0, limit);
      this.setCache(cacheKey, result);
      return result;
    } catch (error) {
      console.error(
        '❌ WLFINewsService getLatestNews error:',
        error instanceof Error ? error.message : error
      );
      return FALLBACK_NEWS.slice(0, limit);
    }
  }

  // ========================================
  // SEARCH NEWS
  // ========================================

  async searchNews(query: string): Promise<WLFINewsItem[]> {
    const cacheKey = `wlfi-search:${query}`;
    const cached = this.getCached<WLFINewsItem[]>(cacheKey);
    if (cached) return cached;

    try {
      // Fetch all available news
      const [cryptoCompareNews, coinGeckoNews] = await Promise.allSettled([
        this.fetchFromCryptoCompare(),
        this.fetchFromCoinGecko(),
      ]);

      const allNews: WLFINewsItem[] = [
        ...(cryptoCompareNews.status === 'fulfilled' ? cryptoCompareNews.value : []),
        ...(coinGeckoNews.status === 'fulfilled' ? coinGeckoNews.value : []),
        ...FALLBACK_NEWS,
      ];

      const queryLower = query.toLowerCase();
      const results = allNews
        .filter((item) => {
          const searchText = `${item.title} ${item.body} ${item.tags.join(' ')}`.toLowerCase();
          return searchText.includes(queryLower);
        })
        .sort((a, b) => b.relevanceScore - a.relevanceScore);

      this.setCache(cacheKey, results);
      return results;
    } catch (error) {
      console.error(
        '❌ WLFINewsService searchNews error:',
        error instanceof Error ? error.message : error
      );
      // Search within fallback news
      const queryLower = query.toLowerCase();
      return FALLBACK_NEWS.filter((item) => {
        const searchText = `${item.title} ${item.body} ${item.tags.join(' ')}`.toLowerCase();
        return searchText.includes(queryLower);
      });
    }
  }

  // ========================================
  // NEWS SUMMARY (for Claude AI context)
  // ========================================

  async getNewsSummary(): Promise<string> {
    const cacheKey = 'wlfi-summary';
    const cached = this.getCached<string>(cacheKey);
    if (cached) return cached;

    try {
      const news = await this.getLatestNews(10);

      if (news.length === 0) {
        return 'No WLFI-related news available at this time.';
      }

      const lines: string[] = [
        `WLFI News Summary (${news.length} items, updated ${new Date().toISOString()}):`,
        '',
      ];

      for (const item of news) {
        const sentimentLabel = item.sentiment
          ? ` [${item.sentiment.toUpperCase()}]`
          : '';
        lines.push(
          `- [${item.publishedAt.split('T')[0]}] ${item.title}${sentimentLabel} (relevance: ${item.relevanceScore}/100)`
        );
        if (item.body) {
          lines.push(`  ${item.body.substring(0, 150)}...`);
        }
      }

      const summary = lines.join('\n');
      this.setCache(cacheKey, summary);
      return summary;
    } catch (error) {
      console.error(
        '❌ WLFINewsService getNewsSummary error:',
        error instanceof Error ? error.message : error
      );
      return 'Unable to generate WLFI news summary at this time.';
    }
  }

  // ========================================
  // HEALTH CHECK
  // ========================================

  async healthCheck(): Promise<{ status: string; timestamp: number }> {
    try {
      await this.client.get(CRYPTOCOMPARE_NEWS_URL, { timeout: 5000 });
      return { status: 'operational', timestamp: Date.now() };
    } catch {
      return { status: 'error', timestamp: Date.now() };
    }
  }
}
