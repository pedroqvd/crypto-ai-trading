// ================================================
// SERVIDOR PRINCIPAL - TIPOS EXPLÍCITOS
// ================================================

import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import cors from 'cors';

import { TechnicalAnalysisService } from './services/analysis/TechnicalAnalysisService';
import { AnthropicService } from './services/ai/AnthropicService';
import { CCXTService } from './services/exchange/CCXTService';
import { AdvancedCacheService } from './services/cache/AdvancedCacheService';

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
    private server: any;
    private io: SocketIOServer;
    private technicalAnalysis!: TechnicalAnalysisService;
    private anthropicService!: AnthropicService;
    private ccxtService!: CCXTService;
    private cacheService!: AdvancedCacheService;
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
                const ccxtHealth = await this.ccxtService.healthCheck();
                const cacheHealth = this.cacheService.healthCheck();
                
                res.json({
                    status: 'healthy',
                    timestamp: new Date().toISOString(),
                    services: { ccxt: ccxtHealth, cache: cacheHealth }
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
                
                const ohlcv: OHLCVData[] = await this.ccxtService.getOHLCV(symbol, exchange, timeframe, 100);
                
                if (ohlcv.length === 0) {
                    return res.status(404).json({
                        success: false,
                        error: 'No market data found'
                    });
                }

                const prices: number[] = ohlcv.map((candle: OHLCVData) => candle.close);
                const volumes: number[] = ohlcv.map((candle: OHLCVData) => candle.volume);

                const rsiValues = this.technicalAnalysis.calculateRSIPublic(prices);
                const currentRSI = rsiValues[rsiValues.length - 1] || 50;

                const analysis = {
                    symbol,
                    exchange,
                    timeframe,
                    indicators: { rsi: currentRSI },
                    signal: this.generateTradingSignal(currentRSI),
                    timestamp: Date.now()
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

        this.app.post('/api/claude/chat', async (req, res) => {
            try {
                const { message } = req.body;
                const response = await this.anthropicService.chat(message);

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

    private generateTradingSignal(rsi: number): string {
        if (rsi < 30) return 'STRONG_BUY';
        if (rsi < 40) return 'BUY';
        if (rsi > 70) return 'STRONG_SELL';
        if (rsi > 60) return 'SELL';
        return 'HOLD';
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