import express from 'express';
import { Server } from 'socket.io';
import { createServer } from 'http';
import path from 'path';
import cors from 'cors';
import dotenv from 'dotenv';
import { TechnicalAnalysisService } from './services/analysis/TechnicalAnalysisService';
import { AnthropicService } from './services/ai/AnthropicService';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Criar servidor HTTP + Socket.IO
const server = createServer(app);
const io = new Server(server, { 
  cors: { 
    origin: "*",
    methods: ["GET", "POST"]
  } 
});

// Inicializar serviços
const analysisService = new TechnicalAnalysisService();
const anthropicService = new AnthropicService();

// Helper function para extrair mensagem de erro
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// Middleware
app.use(express.json());
app.use(cors());
app.use(express.static('public')); // Servir dashboard HTML

// Rota principal
app.get('/', (req, res) => {
  res.json({ 
    message: '🚀 Crypto AI Trading API',
    version: '0.1.0',
    status: 'operational',
    services: {
      technicalAnalysis: 'active',
      claudeAI: 'active'
    }
  });
});

// Rota para Claude AI (melhorada)
app.post('/api/claude/chat', async (req, res) => {
  try {
    const { message, context } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    console.log('📝 Claude chat request:', message);
    
    const response = await anthropicService.quickAnalysis(message, context);
    
    res.json({ 
      response,
      timestamp: new Date().toISOString(),
      status: 'success'
    });
  } catch (error) {
    console.error('Claude API error:', error);
    res.status(500).json({ 
      error: 'Claude API error',
      message: getErrorMessage(error),
      timestamp: new Date().toISOString()
    });
  }
});

// Nova rota para análise técnica completa
app.post('/api/analyze', async (req, res) => {
  try {
    const { symbol, price, marketContext } = req.body;
    
    if (!symbol || !price) {
      return res.status(400).json({ error: 'Symbol and price are required' });
    }
    
    // Calcular indicadores técnicos
    const indicators = await analysisService.calculateIndicators({
      symbol,
      price: parseFloat(price),
      timestamp: new Date().toISOString()
    });
    
    // Obter análise do Claude
    const claudeAnalysis = await anthropicService.analyzeTradingData({
      symbol,
      price: parseFloat(price),
      indicators,
      marketContext
    });
    
    res.json({
      symbol,
      price,
      indicators,
      claudeAnalysis,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ 
      error: 'Analysis error',
      message: getErrorMessage(error)
    });
  }
});

// Rota para health check
app.get('/api/health', async (req, res) => {
  try {
    const claudeHealth = await anthropicService.healthCheck();
    
    res.json({
      status: 'healthy',
      services: {
        technicalAnalysis: 'operational',
        claudeAPI: claudeHealth ? 'operational' : 'degraded',
        database: 'operational'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: getErrorMessage(error),
      timestamp: new Date().toISOString()
    });
  }
});

// Rota para dados de mercado
app.get('/api/market/prices', async (req, res) => {
  try {
    const btcPrice = 43000 + (Math.random() - 0.5) * 2000;
    const ethPrice = 2300 + (Math.random() - 0.5) * 400;
    const solPrice = 95 + (Math.random() - 0.5) * 20;
    
    const mockData = {
      BTC: Math.round(btcPrice * 100) / 100,
      ETH: Math.round(ethPrice * 100) / 100,
      SOL: Math.round(solPrice * 100) / 100,
      timestamp: new Date().toISOString()
    };
    
    res.json(mockData);
  } catch (error) {
    console.error('Market data error:', error);
    res.status(500).json({ error: 'Market data error' });
  }
});

// Socket.IO - Conexões em tempo real
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);
  
  // Enviar dados iniciais
  socket.emit('connection_status', { 
    status: 'connected',
    server_time: new Date().toISOString(),
    services: {
      technicalAnalysis: 'active',
      claudeAI: 'active'
    }
  });
  
  // Função para enviar dados de mercado com indicadores técnicos
  const sendMarketData = async () => {
    try {
      // Dados simulados de mercado
      const btcPrice = 43000 + (Math.random() - 0.5) * 2000;
      const ethPrice = 2300 + (Math.random() - 0.5) * 400;
      const solPrice = 95 + (Math.random() - 0.5) * 20;
      
      const marketData = {
        BTC: Math.round(btcPrice * 100) / 100,
        ETH: Math.round(ethPrice * 100) / 100,
        SOL: Math.round(solPrice * 100) / 100,
        timestamp: new Date().toISOString()
      };
      
      // Calcular indicadores técnicos para BTC
      const btcIndicators = await analysisService.calculateIndicators({
        symbol: 'BTC',
        price: btcPrice,
        timestamp: new Date().toISOString()
      });
      
      // Calcular indicadores técnicos para ETH
      const ethIndicators = await analysisService.calculateIndicators({
        symbol: 'ETH',
        price: ethPrice,
        timestamp: new Date().toISOString()
      });
      
      // Calcular indicadores técnicos para SOL
      const solIndicators = await analysisService.calculateIndicators({
        symbol: 'SOL',
        price: solPrice,
        timestamp: new Date().toISOString()
      });
      
      // Enviar dados de preços
      socket.emit('priceUpdate', marketData);
      
      // Enviar indicadores técnicos
      socket.emit('technicalIndicators', {
        BTC: btcIndicators,
        ETH: ethIndicators,
        SOL: solIndicators,
        timestamp: new Date().toISOString()
      });
      
      console.log(`📊 Data sent - BTC: $${marketData.BTC}, RSI: ${btcIndicators.rsi.value}`);
      
    } catch (error) {
      console.error('❌ Error sending market data:', error);
    }
  };
  
  // Enviar dados imediatamente na conexão
  sendMarketData();
  
  // Continuar enviando dados a cada 5 segundos
  const marketDataInterval = setInterval(sendMarketData, 5000);
  
  // Escutar mensagens do Claude (REAL INTEGRATION)
  socket.on('claudeMessage', async (data) => {
    console.log('📝 Claude message received:', data.message);
    
    try {
      // Obter contexto atual do mercado
      const btcPrice = 43000 + (Math.random() - 0.5) * 2000;
      const context = {
        currentPrices: {
          BTC: btcPrice,
          ETH: 2300 + (Math.random() - 0.5) * 400,
          SOL: 95 + (Math.random() - 0.5) * 20
        },
        timestamp: new Date().toISOString()
      };
      
      // Análise REAL do Claude
      const claudeResponse = await anthropicService.quickAnalysis(data.message, context);
      
      // Tentar análise técnica se a mensagem contém símbolo
      let technicalAnalysis = null;
      const symbolMatch = data.message.match(/\b(BTC|ETH|SOL|BITCOIN|ETHEREUM|SOLANA)\b/i);
      
      if (symbolMatch) {
        const symbol = symbolMatch[1].toUpperCase().replace('BITCOIN', 'BTC').replace('ETHEREUM', 'ETH').replace('SOLANA', 'SOL');
        
        // Type-safe price lookup
        const validSymbols = ['BTC', 'ETH', 'SOL'] as const;
        type ValidSymbol = typeof validSymbols[number];
        
        const price = validSymbols.includes(symbol as ValidSymbol) 
          ? context.currentPrices[symbol as ValidSymbol] 
          : btcPrice;
        
        const indicators = await analysisService.calculateIndicators({
          symbol,
          price,
          timestamp: new Date().toISOString()
        });
        
        technicalAnalysis = await anthropicService.analyzeTradingData({
          symbol,
          price,
          indicators,
          marketContext: {
            trend: indicators.overall.signal,
            volume: Math.random() * 1000000,
            volatility: Math.random() * 0.1
          }
        });
      }
      
      socket.emit('claudeResponse', {
        message: data.message,
        response: claudeResponse,
        technicalAnalysis,
        context,
        timestamp: new Date().toISOString(),
        isReal: true // Flag para indicar que é resposta real do Claude
      });
      
      console.log('✅ Real Claude response sent');
      
    } catch (error) {
      console.error('❌ Claude response error:', error);
      socket.emit('claudeResponse', {
        message: data.message,
        response: `❌ Erro na análise: ${getErrorMessage(error)}. Verifique se a API key está configurada corretamente.`,
        error: true,
        timestamp: new Date().toISOString()
      });
    }
  });
  
  // Auto Analysis - análise automática a cada 30 segundos
  socket.on('requestAutoAnalysis', async () => {
    try {
      const btcPrice = 43000 + (Math.random() - 0.5) * 2000;
      
      const indicators = await analysisService.calculateIndicators({
        symbol: 'BTC',
        price: btcPrice,
        timestamp: new Date().toISOString()
      });
      
      const analysis = await anthropicService.analyzeTradingData({
        symbol: 'BTC',
        price: btcPrice,
        indicators,
        marketContext: {
          trend: indicators.overall.signal,
          volume: Math.random() * 1000000,
          volatility: Math.random() * 0.1
        }
      });
      
      socket.emit('autoAnalysis', {
        symbol: 'BTC',
        price: btcPrice,
        analysis,
        timestamp: new Date().toISOString()
      });
      
      console.log('🤖 Auto analysis sent for BTC');
      
    } catch (error) {
      console.error('❌ Auto analysis error:', error);
    }
  });
  
  // Limpeza na desconexão
  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
    clearInterval(marketDataInterval);
  });
});

// Iniciar servidor
server.listen(PORT, async () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📊 Crypto AI Trading System v0.1.0`);
  console.log(`🔌 WebSocket server ready for real-time data`);
  console.log(`🤖 Claude AI endpoints configured`);
  console.log(`📈 Technical Analysis Service initialized`);
  
  // Health check inicial do Claude
  try {
    const claudeHealthy = await anthropicService.healthCheck();
    console.log(`🧠 Claude API: ${claudeHealthy ? '✅ Connected' : '❌ Failed'}`);
  } catch (error) {
    console.log(`🧠 Claude API: ❌ Error - ${getErrorMessage(error)}`);
  }
});