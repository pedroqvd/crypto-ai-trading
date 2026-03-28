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
import { WLFINewsService } from './services/wlfi/WLFINewsService';
import { WLFIInfluencerService } from './services/wlfi/WLFIInfluencerService';
import { WLFIAgentOrchestrator } from './services/wlfi/WLFIAgentOrchestrator';

import { marketRoutes } from './routes/market';
import { sentimentRoutes } from './routes/sentiment';
import { defiRoutes } from './routes/defi';
import { wlfiRoutes } from './routes/wlfi';
import { claudeRoutes } from './routes/claude';

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
    private wlfiNewsService!: WLFINewsService;
    private wlfiInfluencerService!: WLFIInfluencerService;
    private wlfiOrchestrator!: WLFIAgentOrchestrator;
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
        this.wlfiNewsService = new WLFINewsService();
        this.wlfiInfluencerService = new WLFIInfluencerService();
        this.wlfiOrchestrator = new WLFIAgentOrchestrator(
            this.coinGeckoService,
            this.wlfiNewsService,
            this.wlfiInfluencerService,
            this.polymarketService
        );
        this.wlfiOrchestrator.startAllAgents();

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

        marketRoutes(this.app, {
            ccxtService: this.ccxtService,
            coinGeckoService: this.coinGeckoService
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

        sentimentRoutes(this.app, {
            fearGreedService: this.fearGreedService,
            polymarketService: this.polymarketService,
            polymarketTraderService: this.polymarketTraderService
        });

        defiRoutes(this.app, {
            defiLlamaService: this.defiLlamaService,
            blockchainService: this.blockchainService
        });

        wlfiRoutes(this.app, {
            polymarketService: this.polymarketService,
            newsService: this.wlfiNewsService,
            influencerService: this.wlfiInfluencerService,
            orchestrator: this.wlfiOrchestrator
        });

        claudeRoutes(this.app, {
            anthropicService: this.anthropicService,
            fearGreedService: this.fearGreedService,
            defiLlamaService: this.defiLlamaService,
            blockchainService: this.blockchainService,
            polymarketService: this.polymarketService
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

            socket.on('subscribeWLFI', async () => {
                try {
                    const overview = await this.wlfiOrchestrator.getOverview();
                    socket.emit('wlfiUpdate', overview);
                } catch (error) {
                    socket.emit('error', { message: 'Failed to fetch WLFI data' });
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

        // WLFI updates every 30 seconds
        setInterval(async () => {
            try {
                const overview = await this.wlfiOrchestrator.getOverview();
                this.io.emit('wlfiUpdate', overview);
            } catch (error) {
                // silent
            }
        }, 30000);
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