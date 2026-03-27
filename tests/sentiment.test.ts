import request from 'supertest';

jest.setTimeout(30000);

// Mock all services before importing app
jest.mock('../src/services/exchange/CCXTService', () => ({
  CCXTService: jest.fn().mockImplementation(() => ({
    getAllTickers: jest.fn().mockResolvedValue([]),
    findArbitrageOpportunities: jest.fn().mockResolvedValue([]),
    getMarketStats: jest.fn().mockResolvedValue({}),
    getOHLCV: jest.fn().mockResolvedValue([]),
    healthCheck: jest.fn().mockResolvedValue({ status: 'healthy' }),
  })),
}));

jest.mock('../src/services/market/CoinGeckoService', () => ({
  CoinGeckoService: jest.fn().mockImplementation(() => ({
    getGlobalData: jest.fn().mockResolvedValue({}),
    getTrending: jest.fn().mockResolvedValue([]),
    getTopCoins: jest.fn().mockResolvedValue([]),
    healthCheck: jest.fn().mockResolvedValue({ status: 'healthy' }),
  })),
}));

jest.mock('../src/services/sentiment/FearGreedService', () => ({
  FearGreedService: jest.fn().mockImplementation(() => ({
    getHistoryWithTrend: jest.fn().mockResolvedValue({
      current: { value: 72, classification: 'Greed', timestamp: Date.now() },
      yesterday: null,
      lastWeek: null,
      lastMonth: null,
      trend: 'improving',
    }),
    getSentimentSummary: jest.fn().mockResolvedValue('Fear & Greed Index: 72 (Greed)'),
    healthCheck: jest.fn().mockResolvedValue({ status: 'healthy' }),
  })),
}));

jest.mock('../src/services/sentiment/PolymarketService', () => ({
  PolymarketService: jest.fn().mockImplementation(() => ({
    getCryptoSentimentReport: jest.fn().mockResolvedValue({
      summary: 'Crypto markets are bullish',
      markets: [],
      timestamp: Date.now(),
    }),
    searchMarkets: jest.fn().mockResolvedValue([
      { id: 'market-1', question: 'Will BTC hit 100k?', volume: '1000000' }
    ]),
    healthCheck: jest.fn().mockResolvedValue({ status: 'healthy' }),
  })),
}));

jest.mock('../src/services/sentiment/PolymarketTraderService', () => ({
  PolymarketTraderService: jest.fn().mockImplementation(() => ({
    getTopTraders: jest.fn().mockResolvedValue([
      { address: '0xabc', pnl: 50000 }
    ]),
    buildTraderProfile: jest.fn().mockResolvedValue({
      address: '0xabc123',
      pnl: 50000,
      trades: [],
    }),
  })),
}));

jest.mock('../src/services/defi/DeFiLlamaService', () => ({
  DeFiLlamaService: jest.fn().mockImplementation(() => ({
    getDeFiOverview: jest.fn().mockResolvedValue({}),
    getProtocols: jest.fn().mockResolvedValue([]),
    getChains: jest.fn().mockResolvedValue([]),
    getDeFiSummary: jest.fn().mockResolvedValue(''),
    healthCheck: jest.fn().mockResolvedValue({ status: 'healthy' }),
  })),
}));

jest.mock('../src/services/onchain/BlockchainService', () => ({
  BlockchainService: jest.fn().mockImplementation(() => ({
    getStats: jest.fn().mockResolvedValue({}),
    getMempoolCount: jest.fn().mockResolvedValue({}),
    getOnChainSummary: jest.fn().mockResolvedValue(''),
    healthCheck: jest.fn().mockResolvedValue({ status: 'healthy' }),
  })),
}));

jest.mock('../src/services/cache/AdvancedCacheService', () => ({
  AdvancedCacheService: jest.fn().mockImplementation(() => ({
    setAnalysis: jest.fn(),
    setPrice: jest.fn(),
    healthCheck: jest.fn().mockReturnValue({ status: 'healthy' }),
  })),
}));

jest.mock('../src/services/analysis/TechnicalAnalysisService', () => ({
  TechnicalAnalysisService: jest.fn().mockImplementation(() => ({
    analyzeMarket: jest.fn().mockReturnValue({}),
  })),
}));

jest.mock('../src/services/ai/AnthropicService', () => ({
  AnthropicService: jest.fn().mockImplementation(() => ({
    chat: jest.fn().mockResolvedValue('Mock AI response'),
  })),
}));

import app from '../src/app';

describe('Sentiment Routes', () => {
  describe('GET /api/sentiment/fear-greed', () => {
    it('should return 200 with success: true', async () => {
      const res = await request(app).get('/api/sentiment/fear-greed');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body).toHaveProperty('data');
    });
  });

  describe('GET /api/sentiment/polymarket', () => {
    it('should return 200 with success: true', async () => {
      const res = await request(app).get('/api/sentiment/polymarket');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body).toHaveProperty('data');
    });
  });

  describe('GET /api/sentiment/polymarket/search', () => {
    it('should return 200 with success: true when query is provided', async () => {
      const res = await request(app).get('/api/sentiment/polymarket/search?q=bitcoin');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 400 when query param is missing', async () => {
      const res = await request(app).get('/api/sentiment/polymarket/search');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/sentiment/overview', () => {
    it('should return 200 with success: true', async () => {
      const res = await request(app).get('/api/sentiment/overview');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});

describe('Polymarket Routes', () => {
  describe('GET /api/polymarket/top-traders', () => {
    it('should return 200 with success: true', async () => {
      const res = await request(app).get('/api/polymarket/top-traders');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body).toHaveProperty('data');
    });
  });

  describe('GET /api/polymarket/trader/:address', () => {
    it('should return 400 for invalid address', async () => {
      const res = await request(app).get('/api/polymarket/trader/invalidaddress');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should return 200 for valid ethereum address', async () => {
      const res = await request(app).get('/api/polymarket/trader/0xabc1234567890abc1234567890abc1234567890ab');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
