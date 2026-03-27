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
    getHistoryWithTrend: jest.fn().mockResolvedValue({}),
    getSentimentSummary: jest.fn().mockResolvedValue(''),
    healthCheck: jest.fn().mockResolvedValue({ status: 'healthy' }),
  })),
}));

jest.mock('../src/services/sentiment/PolymarketService', () => ({
  PolymarketService: jest.fn().mockImplementation(() => ({
    getCryptoSentimentReport: jest.fn().mockResolvedValue({ summary: '', markets: [] }),
    searchMarkets: jest.fn().mockImplementation((query: string) => {
      if (query === 'WLFI') {
        return Promise.resolve([
          { id: 'wlfi-1', question: 'Will WLFI reach $1?', volume: '500000' }
        ]);
      }
      if (query === 'Trump crypto') {
        return Promise.resolve([
          { id: 'trump-1', question: 'Will Trump launch a crypto?', volume: '2000000' }
        ]);
      }
      return Promise.resolve([]);
    }),
    healthCheck: jest.fn().mockResolvedValue({ status: 'healthy' }),
  })),
}));

jest.mock('../src/services/sentiment/PolymarketTraderService', () => ({
  PolymarketTraderService: jest.fn().mockImplementation(() => ({
    getTopTraders: jest.fn().mockResolvedValue([]),
    buildTraderProfile: jest.fn().mockResolvedValue({}),
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

// Mock global fetch to avoid real network calls in wlfi/price
global.fetch = jest.fn().mockRejectedValue(new Error('Network disabled in tests')) as jest.Mock;

import app from '../src/app';

describe('WLFI Routes', () => {
  describe('GET /api/wlfi/price', () => {
    it('should return 200 with success: true', async () => {
      const res = await request(app).get('/api/wlfi/price');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body).toHaveProperty('data');
    });

    it('should return price data with expected fields', async () => {
      const res = await request(app).get('/api/wlfi/price');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('price');
      expect(res.body.data).toHaveProperty('change24h');
      expect(res.body.data).toHaveProperty('marketCap');
      expect(res.body.data).toHaveProperty('volume24h');
      expect(res.body.data).toHaveProperty('updatedAt');
    });
  });

  describe('GET /api/wlfi/markets', () => {
    it('should return 200 with success: true', async () => {
      const res = await request(app).get('/api/wlfi/markets');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body).toHaveProperty('data');
    });

    it('should return wlfiMarkets and trumpCryptoMarkets in data', async () => {
      const res = await request(app).get('/api/wlfi/markets');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('wlfiMarkets');
      expect(res.body.data).toHaveProperty('trumpCryptoMarkets');
      expect(res.body.data).toHaveProperty('timestamp');
    });
  });
});
