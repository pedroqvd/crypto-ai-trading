import 'dotenv/config';
import express from 'express';
import path from 'path';
import cors from 'cors';

import { TechnicalAnalysisService } from './services/analysis/TechnicalAnalysisService';
import { AnthropicService } from './services/ai/AnthropicService';
import { CCXTService } from './services/exchange/CCXTService';
import { AdvancedCacheService } from './services/cache/AdvancedCacheService';
import { CoinGeckoService } from './services/market/CoinGeckoService';
import { FearGreedService } from './services/sentiment/FearGreedService';
import { PolymarketService } from './services/sentiment/PolymarketService';
import { PolymarketTraderService } from './services/sentiment/PolymarketTraderService';
import { DeFiLlamaService } from './services/defi/DeFiLlamaService';
import { BlockchainService } from './services/onchain/BlockchainService';

const app = express();

const technicalAnalysis = new TechnicalAnalysisService();
const anthropicService = new AnthropicService();
const cacheService = new AdvancedCacheService();
const ccxtService = new CCXTService();
const coinGeckoService = new CoinGeckoService();
const fearGreedService = new FearGreedService();
const polymarketService = new PolymarketService();
const defiLlamaService = new DeFiLlamaService();
const blockchainService = new BlockchainService();
const polymarketTraderService = new PolymarketTraderService();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

interface OHLCVData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TickerData {
  symbol: string;
  exchange: string;
  price: number;
  volume: number;
  change24h: number;
  timestamp: number;
}

app.get('/api/health', async (req, res) => {
  try {
    const [ccxtHealth, coinGeckoHealth, fearGreedHealth, polymarketHealth, defiHealth, blockchainHealth] = await Promise.allSettled([
      ccxtService.healthCheck(),
      coinGeckoService.healthCheck(),
      fearGreedService.healthCheck(),
      polymarketService.healthCheck(),
      defiLlamaService.healthCheck(),
      blockchainService.healthCheck()
    ]);
    const cacheHealth = cacheService.healthCheck();

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        ccxt: ccxtHealth.status === 'fulfilled' ? ccxtHealth.value : { status: 'error' },
        cache: cacheHealth,
        coinGecko: coinGeckoHealth.status === 'fulfilled' ? coinGeckoHealth.value : { status: 'error' },
        fearGreed: fearGreedHealth.status === 'fulfilled' ? fearGreedHealth.value : { status: 'error' },
        polymarket: polymarketHealth.status === 'fulfilled' ? polymarketHealth.value : { status: 'error' },
        defiLlama: defiHealth.status === 'fulfilled' ? defiHealth.value : { status: 'error' },
        blockchain: blockchainHealth.status === 'fulfilled' ? blockchainHealth.value : { status: 'error' }
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.get('/api/market/tickers', async (req, res) => {
  try {
    const tickers = await ccxtService.getAllTickers();
    res.json({
      success: true,
      count: tickers.length,
      data: tickers,
      timestamp: Date.now()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch tickers'
    });
  }
});

app.post('/api/analysis/enhanced', async (req, res) => {
  try {
    const { symbol, exchange = 'binance', timeframe = '1h' } = req.body;

    if (!symbol || typeof symbol !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Symbol is required (e.g., BTC/USDT)'
      });
    }

    const ohlcv: OHLCVData[] = await ccxtService.getOHLCV(symbol, exchange, timeframe, 100);

    if (ohlcv.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No market data found'
      });
    }

    const prices: number[] = ohlcv.map((candle: OHLCVData) => candle.close);
    const volumes: number[] = ohlcv.map((candle: OHLCVData) => candle.volume);

    const fullAnalysis = technicalAnalysis.analyzeMarket(prices, volumes);

    const analysis = {
      symbol,
      exchange,
      timeframe,
      ...fullAnalysis,
    };

    cacheService.setAnalysis(symbol, analysis, 300000);

    res.json({ success: true, data: analysis });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Analysis failed'
    });
  }
});

app.get('/api/market/arbitrage/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol;
    const opportunities = await ccxtService.findArbitrageOpportunities(symbol);
    res.json({ success: true, data: opportunities, timestamp: Date.now() });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Arbitrage check failed'
    });
  }
});

app.get('/api/market/stats', async (req, res) => {
  try {
    const stats = await ccxtService.getMarketStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Stats failed'
    });
  }
});

app.get('/api/coingecko/global', async (req, res) => {
  try {
    const data = await coinGeckoService.getGlobalData();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch global data' });
  }
});

app.get('/api/coingecko/trending', async (req, res) => {
  try {
    const data = await coinGeckoService.getTrending();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch trending' });
  }
});

app.get('/api/coingecko/top', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const data = await coinGeckoService.getTopCoins(Math.min(limit, 250));
    res.json({ success: true, count: data.length, data });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch top coins' });
  }
});

app.get('/api/sentiment/fear-greed', async (req, res) => {
  try {
    const data = await fearGreedService.getHistoryWithTrend();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch Fear & Greed' });
  }
});

app.get('/api/sentiment/polymarket', async (req, res) => {
  try {
    const report = await polymarketService.getCryptoSentimentReport();
    res.json({ success: true, data: report });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch Polymarket sentiment' });
  }
});

app.get('/api/sentiment/polymarket/search', async (req, res) => {
  try {
    const query = req.query.q as string;
    if (!query) {
      return res.status(400).json({ success: false, error: 'Query parameter "q" is required' });
    }
    const markets = await polymarketService.searchMarkets(query);
    res.json({ success: true, count: markets.length, data: markets });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to search Polymarket' });
  }
});

app.get('/api/polymarket/top-traders', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const traders = await polymarketTraderService.getTopTraders(limit);
    res.json({ success: true, count: traders.length, data: traders });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch top traders' });
  }
});

app.get('/api/polymarket/trader/:address', async (req, res) => {
  try {
    const address = req.params.address;
    const name = req.query.name as string | undefined;
    if (!address || !address.startsWith('0x')) {
      return res.status(400).json({ success: false, error: 'Valid Ethereum address required (0x...)' });
    }
    const profile = await polymarketTraderService.buildTraderProfile(address, name);
    res.json({ success: true, data: profile });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch trader profile' });
  }
});

app.get('/api/sentiment/overview', async (req, res) => {
  try {
    const [fearGreed, polymarket] = await Promise.allSettled([
      fearGreedService.getHistoryWithTrend(),
      polymarketService.getCryptoSentimentReport()
    ]);

    res.json({
      success: true,
      data: {
        fearGreed: fearGreed.status === 'fulfilled' ? fearGreed.value : null,
        polymarket: polymarket.status === 'fulfilled' ? polymarket.value : null,
        timestamp: Date.now()
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch sentiment overview' });
  }
});

app.get('/api/defi/overview', async (req, res) => {
  try {
    const overview = await defiLlamaService.getDeFiOverview();
    res.json({ success: true, data: overview });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch DeFi overview' });
  }
});

app.get('/api/defi/protocols', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 30;
    const protocols = await defiLlamaService.getProtocols(limit);
    res.json({ success: true, count: protocols.length, data: protocols });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch protocols' });
  }
});

app.get('/api/defi/chains', async (req, res) => {
  try {
    const chains = await defiLlamaService.getChains();
    res.json({ success: true, count: chains.length, data: chains });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch chains' });
  }
});

app.get('/api/onchain/btc', async (req, res) => {
  try {
    const stats = await blockchainService.getStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch BTC on-chain' });
  }
});

app.get('/api/onchain/mempool', async (req, res) => {
  try {
    const mempool = await blockchainService.getMempoolCount();
    res.json({ success: true, data: mempool });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch mempool' });
  }
});

app.get('/api/wlfi/price', async (req, res) => {
  try {
    const coingeckoId = 'world-liberty-financial';

    const mockData = {
      price: 0.0482,
      change24h: 3.2,
      marketCap: 261000000,
      volume24h: 12400000,
      updatedAt: new Date().toISOString()
    };

    try {
      const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true`);
      const data = await response.json() as Record<string, any>;

      if (data && data[coingeckoId]) {
        const tokenData = data[coingeckoId] as Record<string, number>;
        return res.json({
          success: true,
          data: {
            price: tokenData.usd || mockData.price,
            change24h: tokenData.usd_24h_change || mockData.change24h,
            marketCap: tokenData.usd_market_cap || mockData.marketCap,
            volume24h: tokenData.usd_24h_vol || mockData.volume24h,
            updatedAt: new Date().toISOString()
          }
        });
      }
    } catch (e) {
      // Fall through to mock data
    }

    res.json({ success: true, data: mockData });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch WLFI price' });
  }
});

app.get('/api/wlfi/markets', async (req, res) => {
  try {
    const wlfiMarkets = await polymarketService.searchMarkets('WLFI', 10);
    const trumpCryptoMarkets = await polymarketService.searchMarkets('Trump crypto', 10);

    res.json({
      success: true,
      data: {
        wlfiMarkets: wlfiMarkets.slice(0, 5),
        trumpCryptoMarkets: trumpCryptoMarkets.slice(0, 5),
        timestamp: Date.now()
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch WLFI markets' });
  }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const [
      tickers,
      globalData,
      trending,
      fearGreed,
      polymarket,
      defiOverview,
      btcOnChain
    ] = await Promise.allSettled([
      ccxtService.getAllTickers(),
      coinGeckoService.getGlobalData(),
      coinGeckoService.getTrending(),
      fearGreedService.getHistoryWithTrend(),
      polymarketService.getCryptoSentimentReport(),
      defiLlamaService.getDeFiOverview(),
      blockchainService.getStats()
    ]);

    res.json({
      success: true,
      data: {
        prices: tickers.status === 'fulfilled' ? tickers.value : [],
        global: globalData.status === 'fulfilled' ? globalData.value : null,
        trending: trending.status === 'fulfilled' ? trending.value : [],
        fearGreed: fearGreed.status === 'fulfilled' ? fearGreed.value : null,
        polymarket: polymarket.status === 'fulfilled' ? polymarket.value : null,
        defi: defiOverview.status === 'fulfilled' ? defiOverview.value : null,
        btcOnChain: btcOnChain.status === 'fulfilled' ? btcOnChain.value : null,
        timestamp: Date.now()
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch dashboard data' });
  }
});

app.post('/api/claude/chat', async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Message is required'
      });
    }

    let enrichedMessage = message;

    if (req.body.includeContext !== false) {
      try {
        const [fearGreedSummary, defiSummary, onChainSummary, polymarketSummary] = await Promise.allSettled([
          fearGreedService.getSentimentSummary(),
          defiLlamaService.getDeFiSummary(),
          blockchainService.getOnChainSummary(),
          polymarketService.getCryptoSentimentReport()
        ]);

        let context = '\n\n--- Contexto de Mercado Atual ---\n';
        if (fearGreedSummary.status === 'fulfilled') context += fearGreedSummary.value + '\n';
        if (defiSummary.status === 'fulfilled') context += defiSummary.value + '\n';
        if (onChainSummary.status === 'fulfilled') context += onChainSummary.value + '\n';
        if (polymarketSummary.status === 'fulfilled' && polymarketSummary.value.summary) {
          context += polymarketSummary.value.summary + '\n';
        }

        enrichedMessage = message + context;
      } catch {
        // Continue without context if it fails
      }
    }

    const response = await anthropicService.chat(enrichedMessage);

    res.json({
      success: true,
      response,
      timestamp: Date.now()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      response: 'Sistema em modo demo.'
    });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

export default app;
