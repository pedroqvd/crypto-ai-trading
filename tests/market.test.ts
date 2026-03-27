import request from 'supertest';

jest.setTimeout(30000);

// Mock all services before importing app
jest.mock('../src/services/exchange/CCXTService', () => ({
  CCXTService: jest.fn().mockImplementation(() => ({
    getAllTickers: jest.fn().mockResolvedValue([
      { symbol: 'BTC/USDT', exchange: 'binance', price: 50000, volume: 100, change24h: 2.5, timestamp: Date.now() }
    ]),
    findArbitrageOpportunities: jest.fn().mockResolvedValue([]),
    getMarketStats: jest.fn().mockResolvedValue({ totalVolume: 1000000 }),
    getOHLCV: jest.fn().mockResolvedValue([]),
    healthCheck: jest.fn().mockResolvedValue({ status: 'healthy' }),
  })),
}));

jest.mock('../src/services/market/CoinGeckoService', () => ({
  CoinGeckoService: jest.fn().mockImplementation(() => ({
    getGlobalData: jest.fn().mockResolvedValue({ total_market_cap: { usd: 2000000000 } }),
    getTrending: jest.fn().mockResolvedValue([{ id: 'bitcoin', name: 'Bitcoin', symbol: 'btc' }]),
    getTopCoins: jest.fn().mockResolvedValue([{ id: 'bitcoin', current_price: 50000 }]),
    healthCheck: jest.fn().mockResolvedValue({ status: 'healthy' }),
  })),
}));

jest.mock('../src/services/sentiment/FearGreedService', () => ({
  FearGreedService: jest.fn().mockImplementation(() => ({
    getHistoryWithTrend: jest.fn().mockResolvedValue({ current: { value: 65, classification: 'Greed' }, trend: 'stable' }),
    getSentimentSummary: jest.fn().mockResolvedValue('Fear & Greed: 65 (Greed)'),
    healthCheck: jest.fn().mockResolvedValue({ status: 'healthy' }),
  })),
}));

jest.mock('../src/services/sentiment/PolymarketService', () => ({
  PolymarketService: jest.fn().mockImplementation(() => ({
    getCryptoSentimentReport: jest.fn().mockResolvedValue({ summary: 'Bullish', markets: [] }),
    searchMarkets: jest.fn().mockResolvedValue([]),
    healthCheck: jest.fn().mockResolvedValue({ status: 'healthy' }),
  })),
}));

jest.mock('../src/services/sentiment/PolymarketTraderService', () => ({
  PolymarketTraderService: jest.fn().mockImplementation(() => ({
    getTopTraders: jest.fn().mockResolvedValue([]),
    buildTraderProfile: jest.fn().mockResolvedValue({ address: '0x123', trades: [] }),
  })),
}));

jest.mock('../src/services/defi/DeFiLlamaService', () => ({
  DeFiLlamaService: jest.fn().mockImplementation(() => ({
    getDeFiOverview: jest.fn().mockResolvedValue({ totalTVL: 50000000000 }),
    getProtocols: jest.fn().mockResolvedValue([]),
    getChains: jest.fn().mockResolvedValue([]),
    getDeFiSummary: jest.fn().mockResolvedValue('DeFi TVL: $50B'),
    healthCheck: jest.fn().mockResolvedValue({ status: 'healthy' }),
  })),
}));

jest.mock('../src/services/onchain/BlockchainService', () => ({
  BlockchainService: jest.fn().mockImplementation(() => ({
    getStats: jest.fn().mockResolvedValue({ blockHeight: 800000 }),
    getMempoolCount: jest.fn().mockResolvedValue({ count: 12000 }),
    getOnChainSummary: jest.fn().mockResolvedValue('BTC block height: 800000'),
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
    analyzeMarket: jest.fn().mockReturnValue({ rsi: 55, trend: 'bullish' }),
  })),
}));

jest.mock('../src/services/ai/AnthropicService', () => ({
  AnthropicService: jest.fn().mockImplementation(() => ({
    chat: jest.fn().mockResolvedValue('Mock AI response'),
  })),
}));

import app from '../src/app';

describe('Market Routes', () => {
  describe('GET /api/market/tickers', () => {
    it('should return 200 with success: true', async () => {
      const res = await request(app).get('/api/market/tickers');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body).toHaveProperty('data');
    });
  });

  describe('GET /api/market/stats', () => {
    it('should return 200 with success: true', async () => {
      const res = await request(app).get('/api/market/stats');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /api/market/arbitrage/:symbol', () => {
    it('should return 200 with success: true for a valid symbol', async () => {
      const res = await request(app).get('/api/market/arbitrage/BTC%2FUSDT');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});

describe('CoinGecko Routes', () => {
  describe('GET /api/coingecko/global', () => {
    it('should return 200 with success: true', async () => {
      const res = await request(app).get('/api/coingecko/global');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body).toHaveProperty('data');
    });
  });

  describe('GET /api/coingecko/trending', () => {
    it('should return 200 with success: true', async () => {
      const res = await request(app).get('/api/coingecko/trending');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /api/coingecko/top', () => {
    it('should return 200 with success: true', async () => {
      const res = await request(app).get('/api/coingecko/top');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
