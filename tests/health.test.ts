import request from 'supertest';

jest.setTimeout(30000);

// Mock all services before importing app
jest.mock('../src/services/exchange/CCXTService', () => ({
  CCXTService: jest.fn().mockImplementation(() => ({
    getAllTickers: jest.fn().mockResolvedValue([]),
    findArbitrageOpportunities: jest.fn().mockResolvedValue([]),
    getMarketStats: jest.fn().mockResolvedValue({}),
    getOHLCV: jest.fn().mockResolvedValue([]),
    healthCheck: jest.fn().mockResolvedValue({ status: 'healthy', exchange: 'binance' }),
  })),
}));

jest.mock('../src/services/market/CoinGeckoService', () => ({
  CoinGeckoService: jest.fn().mockImplementation(() => ({
    getGlobalData: jest.fn().mockResolvedValue({}),
    getTrending: jest.fn().mockResolvedValue([]),
    getTopCoins: jest.fn().mockResolvedValue([]),
    healthCheck: jest.fn().mockResolvedValue({ status: 'healthy', service: 'coingecko' }),
  })),
}));

jest.mock('../src/services/sentiment/FearGreedService', () => ({
  FearGreedService: jest.fn().mockImplementation(() => ({
    getHistoryWithTrend: jest.fn().mockResolvedValue({}),
    getSentimentSummary: jest.fn().mockResolvedValue(''),
    healthCheck: jest.fn().mockResolvedValue({ status: 'healthy', service: 'fear-greed' }),
  })),
}));

jest.mock('../src/services/sentiment/PolymarketService', () => ({
  PolymarketService: jest.fn().mockImplementation(() => ({
    getCryptoSentimentReport: jest.fn().mockResolvedValue({ summary: '', markets: [] }),
    searchMarkets: jest.fn().mockResolvedValue([]),
    healthCheck: jest.fn().mockResolvedValue({ status: 'healthy', service: 'polymarket' }),
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
    healthCheck: jest.fn().mockResolvedValue({ status: 'healthy', service: 'defillama' }),
  })),
}));

jest.mock('../src/services/onchain/BlockchainService', () => ({
  BlockchainService: jest.fn().mockImplementation(() => ({
    getStats: jest.fn().mockResolvedValue({}),
    getMempoolCount: jest.fn().mockResolvedValue({}),
    getOnChainSummary: jest.fn().mockResolvedValue(''),
    healthCheck: jest.fn().mockResolvedValue({ status: 'healthy', service: 'blockchain' }),
  })),
}));

jest.mock('../src/services/cache/AdvancedCacheService', () => ({
  AdvancedCacheService: jest.fn().mockImplementation(() => ({
    setAnalysis: jest.fn(),
    setPrice: jest.fn(),
    healthCheck: jest.fn().mockReturnValue({ status: 'healthy', service: 'cache' }),
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

describe('Health Route', () => {
  describe('GET /api/health', () => {
    it('should return 200 with status healthy', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'healthy');
    });

    it('should include timestamp in the response', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('timestamp');
    });

    it('should include services in the response', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('services');
      expect(res.body.services).toHaveProperty('ccxt');
      expect(res.body.services).toHaveProperty('cache');
      expect(res.body.services).toHaveProperty('coinGecko');
      expect(res.body.services).toHaveProperty('fearGreed');
      expect(res.body.services).toHaveProperty('polymarket');
      expect(res.body.services).toHaveProperty('defiLlama');
      expect(res.body.services).toHaveProperty('blockchain');
    });

    it('should report healthy status for all mocked services', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      const { services } = res.body;
      expect(services.ccxt.status).toBe('healthy');
      expect(services.cache.status).toBe('healthy');
    });
  });
});
