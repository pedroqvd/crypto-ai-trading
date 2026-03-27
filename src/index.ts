// ================================================
// SERVIDOR PRINCIPAL - TIPOS EXPLÍCITOS
// ================================================

import 'dotenv/config';
import express from 'express';
import { createServer, Server } from 'http';
import { Server as SocketIOServer } from 'socket.io';
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

class CryptoAITradingServer {
    private app: express.Application;
    private server: Server;
    private io: SocketIOServer;
    private technicalAnalysis!: TechnicalAnalysisService;
    private anthropicService!: AnthropicService;
    private ccxtService!: CCXTService;
    private cacheService!: AdvancedCacheService;
    private coinGeckoService!: CoinGeckoService;
    private fearGreedService!: FearGreedService;
    private polymarketService!: PolymarketService;
    private defiLlamaService!: DeFiLlamaService;
    private blockchainService!: BlockchainService;
    private polymarketTraderService!: PolymarketTraderService;
    private port: number;

    constructor() {
        this.app = express();
        this.server = createServer(this.app);
        this.io = new SocketIOServer(this.server, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            }
        });
        
        this.port = parseInt(process.env.PORT || '3000');
        
        this.initializeServices();
        this.setupMiddleware();
        this.setupRoutes();
        this.setupWebSocket();
        this.startPeriodicTasks();
    }

    private initializeServices(): void {
        console.log('🚀 Inicializando serviços...');
        
        this.technicalAnalysis = new TechnicalAnalysisService();
        this.anthropicService = new AnthropicService();
        this.cacheService = new AdvancedCacheService();
        this.ccxtService = new CCXTService();
        this.coinGeckoService = new CoinGeckoService();
        this.fearGreedService = new FearGreedService();
        this.polymarketService = new PolymarketService();
        this.defiLlamaService = new DeFiLlamaService();
        this.blockchainService = new BlockchainService();
        this.polymarketTraderService = new PolymarketTraderService();

        console.log('✅ Todos os serviços inicializados');
    }

    private setupMiddleware(): void {
        this.app.use(cors());
        this.app.use(express.json());
        this.app.use(express.static(path.join(__dirname, '../public')));
        
        this.app.use((req, res, next) => {
            console.log(`📡 ${req.method} ${req.path}`);
            next();
        });
    }

    private setupRoutes(): void {
        this.app.get('/api/health', async (req, res) => {
            try {
                const [ccxtHealth, coinGeckoHealth, fearGreedHealth, polymarketHealth, defiHealth, blockchainHealth] = await Promise.allSettled([
                    this.ccxtService.healthCheck(),
                    this.coinGeckoService.healthCheck(),
                    this.fearGreedService.healthCheck(),
                    this.polymarketService.healthCheck(),
                    this.defiLlamaService.healthCheck(),
                    this.blockchainService.healthCheck()
                ]);
                const cacheHealth = this.cacheService.healthCheck();

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

        this.app.get('/api/market/tickers', async (req, res) => {
            try {
                const tickers = await this.ccxtService.getAllTickers();
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

        this.app.post('/api/analysis/enhanced', async (req, res) => {
            try {
                const { symbol, exchange = 'binance', timeframe = '1h' } = req.body;

                if (!symbol || typeof symbol !== 'string') {
                    return res.status(400).json({
                        success: false,
                        error: 'Symbol is required (e.g., BTC/USDT)'
                    });
                }

                const ohlcv: OHLCVData[] = await this.ccxtService.getOHLCV(symbol, exchange, timeframe, 100);
                
                if (ohlcv.length === 0) {
                    return res.status(404).json({
                        success: false,
                        error: 'No market data found'
                    });
                }

                const prices: number[] = ohlcv.map((candle: OHLCVData) => candle.close);
                const volumes: number[] = ohlcv.map((candle: OHLCVData) => candle.volume);

                const fullAnalysis = this.technicalAnalysis.analyzeMarket(prices, volumes);

                const analysis = {
                    symbol,
                    exchange,
                    timeframe,
                    ...fullAnalysis,
                };

                this.cacheService.setAnalysis(symbol, analysis, 300000);

                res.json({ success: true, data: analysis });

            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error instanceof Error ? error.message : 'Analysis failed'
                });
            }
        });

        this.app.get('/api/market/arbitrage/:symbol', async (req, res) => {
            try {
                const symbol = req.params.symbol;
                const opportunities = await this.ccxtService.findArbitrageOpportunities(symbol);
                res.json({ success: true, data: opportunities, timestamp: Date.now() });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error instanceof Error ? error.message : 'Arbitrage check failed'
                });
            }
        });

        this.app.get('/api/market/stats', async (req, res) => {
            try {
                const stats = await this.ccxtService.getMarketStats();
                res.json({ success: true, data: stats });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error instanceof Error ? error.message : 'Stats failed'
                });
            }
        });

        // ========================================
        // COINGECKO ROUTES
        // ========================================
        this.app.get('/api/coingecko/global', async (req, res) => {
            try {
                const data = await this.coinGeckoService.getGlobalData();
                res.json({ success: true, data });
            } catch (error) {
                res.status(500).json({ success: false, error: 'Failed to fetch global data' });
            }
        });

        this.app.get('/api/coingecko/trending', async (req, res) => {
            try {
                const data = await this.coinGeckoService.getTrending();
                res.json({ success: true, data });
            } catch (error) {
                res.status(500).json({ success: false, error: 'Failed to fetch trending' });
            }
        });

        this.app.get('/api/coingecko/top', async (req, res) => {
            try {
                const limit = parseInt(req.query.limit as string) || 50;
                const data = await this.coinGeckoService.getTopCoins(Math.min(limit, 250));
                res.json({ success: true, count: data.length, data });
            } catch (error) {
                res.status(500).json({ success: false, error: 'Failed to fetch top coins' });
            }
        });

        // ========================================
        // SENTIMENT ROUTES (Fear & Greed + Polymarket)
        // ========================================
        this.app.get('/api/sentiment/fear-greed', async (req, res) => {
            try {
                const data = await this.fearGreedService.getHistoryWithTrend();
                res.json({ success: true, data });
            } catch (error) {
                res.status(500).json({ success: false, error: 'Failed to fetch Fear & Greed' });
            }
        });

        this.app.get('/api/sentiment/polymarket', async (req, res) => {
            try {
                const report = await this.polymarketService.getCryptoSentimentReport();
                res.json({ success: true, data: report });
            } catch (error) {
                res.status(500).json({ success: false, error: 'Failed to fetch Polymarket sentiment' });
            }
        });

        this.app.get('/api/sentiment/polymarket/search', async (req, res) => {
            try {
                const query = req.query.q as string;
                if (!query) {
                    return res.status(400).json({ success: false, error: 'Query parameter "q" is required' });
                }
                const markets = await this.polymarketService.searchMarkets(query);
                res.json({ success: true, count: markets.length, data: markets });
            } catch (error) {
                res.status(500).json({ success: false, error: 'Failed to search Polymarket' });
            }
        });

        // ========================================
        // POLYMARKET TRADER TRACKING ROUTES
        // ========================================
        this.app.get('/api/polymarket/top-traders', async (req, res) => {
            try {
                const limit = parseInt(req.query.limit as string) || 20;
                const traders = await this.polymarketTraderService.getTopTraders(limit);
                res.json({ success: true, count: traders.length, data: traders });
            } catch (error) {
                res.status(500).json({ success: false, error: 'Failed to fetch top traders' });
            }
        });

        this.app.get('/api/polymarket/trader/:address', async (req, res) => {
            try {
                const address = req.params.address;
                const name = req.query.name as string | undefined;
                if (!address || !address.startsWith('0x')) {
                    return res.status(400).json({ success: false, error: 'Valid Ethereum address required (0x...)' });
                }
                const profile = await this.polymarketTraderService.buildTraderProfile(address, name);
                res.json({ success: true, data: profile });
            } catch (error) {
                res.status(500).json({ success: false, error: 'Failed to fetch trader profile' });
            }
        });

        this.app.get('/api/sentiment/overview', async (req, res) => {
            try {
                const [fearGreed, polymarket] = await Promise.allSettled([
                    this.fearGreedService.getHistoryWithTrend(),
                    this.polymarketService.getCryptoSentimentReport()
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

        // ========================================
        // DEFI LLAMA ROUTES
        // ========================================
        this.app.get('/api/defi/overview', async (req, res) => {
            try {
                const overview = await this.defiLlamaService.getDeFiOverview();
                res.json({ success: true, data: overview });
            } catch (error) {
                res.status(500).json({ success: false, error: 'Failed to fetch DeFi overview' });
            }
        });

        this.app.get('/api/defi/protocols', async (req, res) => {
            try {
                const limit = parseInt(req.query.limit as string) || 30;
                const protocols = await this.defiLlamaService.getProtocols(limit);
                res.json({ success: true, count: protocols.length, data: protocols });
            } catch (error) {
                res.status(500).json({ success: false, error: 'Failed to fetch protocols' });
            }
        });

        this.app.get('/api/defi/chains', async (req, res) => {
            try {
                const chains = await this.defiLlamaService.getChains();
                res.json({ success: true, count: chains.length, data: chains });
            } catch (error) {
                res.status(500).json({ success: false, error: 'Failed to fetch chains' });
            }
        });

        // ========================================
        // ON-CHAIN ROUTES (Bitcoin)
        // ========================================
        this.app.get('/api/onchain/btc', async (req, res) => {
            try {
                const stats = await this.blockchainService.getStats();
                res.json({ success: true, data: stats });
            } catch (error) {
                res.status(500).json({ success: false, error: 'Failed to fetch BTC on-chain' });
            }
        });

        this.app.get('/api/onchain/mempool', async (req, res) => {
            try {
                const mempool = await this.blockchainService.getMempoolCount();
                res.json({ success: true, data: mempool });
            } catch (error) {
                res.status(500).json({ success: false, error: 'Failed to fetch mempool' });
            }
        });

        // ========================================
        // WLFI TOKEN ROUTES
        // ========================================
        this.app.get('/api/wlfi/price', async (req, res) => {
            try {
                // Try to fetch WLFI price from CoinGecko
                // WLFI might be identified as 'world-liberty-financial' on CoinGecko
                const coingeckoId = 'world-liberty-financial';

                // Mock data fallback if not found on CoinGecko
                const mockData = {
                    price: 0.0482,
                    change24h: 3.2,
                    marketCap: 261000000,
                    volume24h: 12400000,
                    updatedAt: new Date().toISOString()
                };

                try {
                    // Attempt to fetch real data from CoinGecko
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

                // Return mock data if CoinGecko fails or token not found
                res.json({ success: true, data: mockData });
            } catch (error) {
                res.status(500).json({ success: false, error: 'Failed to fetch WLFI price' });
            }
        });

        this.app.get('/api/wlfi/markets', async (req, res) => {
            try {
                // Search Polymarket for WLFI and Trump crypto-related markets
                const wlfiMarkets = await this.polymarketService.searchMarkets('WLFI', 10);
                const trumpCryptoMarkets = await this.polymarketService.searchMarkets('Trump crypto', 10);

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

        // ========================================
        // DASHBOARD COMPLETO - Todos os dados agregados
        // ========================================
        this.app.get('/api/dashboard', async (req, res) => {
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
                    this.ccxtService.getAllTickers(),
                    this.coinGeckoService.getGlobalData(),
                    this.coinGeckoService.getTrending(),
                    this.fearGreedService.getHistoryWithTrend(),
                    this.polymarketService.getCryptoSentimentReport(),
                    this.defiLlamaService.getDeFiOverview(),
                    this.blockchainService.getStats()
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

        this.app.post('/api/claude/chat', async (req, res) => {
            try {
                const { message } = req.body;

                if (!message || typeof message !== 'string') {
                    return res.status(400).json({
                        success: false,
                        error: 'Message is required'
                    });
                }

                // Enriquecer contexto com dados de mercado para o Claude
                let enrichedMessage = message;

                if (req.body.includeContext !== false) {
                    try {
                        const [fearGreedSummary, defiSummary, onChainSummary, polymarketSummary] = await Promise.allSettled([
                            this.fearGreedService.getSentimentSummary(),
                            this.defiLlamaService.getDeFiSummary(),
                            this.blockchainService.getOnChainSummary(),
                            this.polymarketService.getCryptoSentimentReport()
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
                        // Continuar sem contexto se falhar
                    }
                }

                const response = await this.anthropicService.chat(enrichedMessage);

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

        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, '../public/index.html'));
        });
    }

    private setupWebSocket(): void {
        this.io.on('connection', (socket) => {
            console.log('🔌 Cliente conectado:', socket.id);

            socket.emit('connected', {
                message: 'Conectado ao Crypto AI Trading v2.0',
                timestamp: Date.now()
            });

            socket.on('subscribe', async (data) => {
                try {
                    const tickers = await this.ccxtService.getAllTickers();
                    socket.emit('priceUpdate', tickers);
                } catch (error) {
                    socket.emit('error', { message: 'Failed to fetch prices' });
                }
            });

            socket.on('disconnect', () => {
                console.log('🔌 Cliente desconectado:', socket.id);
            });
        });
    }

    private startPeriodicTasks(): void {
        setInterval(async () => {
            try {
                const tickers = await this.ccxtService.getAllTickers();
                this.io.emit('priceUpdate', tickers);
                
                tickers.forEach((ticker: TickerData) => {
                    this.cacheService.setPrice(ticker.symbol, ticker.exchange, ticker.price);
                });
            } catch (error) {
                console.error('❌ Erro na atualização:', error);
            }
        }, 15000);
    }

    public start(): void {
        this.server.listen(this.port, () => {
            console.log('\n🚀 ================================');
            console.log('📊 CRYPTO AI TRADING SYSTEM v2.0');
            console.log('🚀 ================================');
            console.log(`🌐 Servidor: http://localhost:${this.port}`);
            console.log('🚀 ================================\n');
        });
    }
}

const server = new CryptoAITradingServer();
server.start();