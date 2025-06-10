// ================================================
// ANTHROPIC SERVICE - CLAUDE AI INTEGRATION (FIXED)
// ================================================

import { Anthropic } from '@anthropic-ai/sdk';

// Interface simplificada para análise
interface MarketAnalysis {
  rsi: number;
  signal: string;
  recommendation: string;
}

export class AnthropicService {
  private client: Anthropic | null = null;
  private isInitialized = false;
  private model = 'claude-3-5-sonnet-20241022';

  constructor() {
    this.initializeClient();
  }

  private initializeClient(): void {
    try {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      
      if (!apiKey || apiKey === 'sk-ant-demo-mode') {
        console.log('🤖 AnthropicService initialized in DEMO mode');
        this.isInitialized = false;
        return;
      }

      this.client = new Anthropic({
        apiKey: apiKey,
      });

      this.isInitialized = true;
      console.log(`🤖 AnthropicService initialized with model: ${this.model}`);
    } catch (error) {
      console.error('❌ Error initializing Anthropic client:', error);
      this.isInitialized = false;
    }
  }

  // ========================================
  // CHAT METHODS
  // ========================================
  
  async chat(message: string): Promise<string> {
    if (!this.isInitialized || !this.client) {
      return this.getDemoResponse(message);
    }

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: message
        }]
      });

      const content = response.content[0];
      if (content.type === 'text') {
        return content.text;
      }
      
      return 'Resposta recebida mas não foi possível processar o conteúdo.';
    } catch (error) {
      console.error('❌ Error in Claude chat:', error);
      return this.getDemoResponse(message);
    }
  }

  async analyzeMarket(analysis: MarketAnalysis): Promise<string> {
    const prompt = `
    Analise os seguintes dados de mercado de criptomoedas:
    
    RSI: ${analysis.rsi}
    Sinal Técnico: ${analysis.signal}
    Recomendação: ${analysis.recommendation}
    
    Forneça uma análise detalhada e sugestões de trading baseadas nesses indicadores.
    Mantenha a resposta concisa mas informativa.
    `;

    return await this.chat(prompt);
  }

  async getTradingAdvice(symbol: string, price: number, change24h: number): Promise<string> {
    const prompt = `
    Análise de Trading para ${symbol}:
    
    Preço atual: $${price}
    Variação 24h: ${change24h.toFixed(2)}%
    
    Com base nestes dados, forneça:
    1. Análise da tendência atual
    2. Pontos de entrada/saída potenciais
    3. Gerenciamento de risco recomendado
    
    Mantenha a resposta prática e acionável.
    `;

    return await this.chat(prompt);
  }

  // ========================================
  // DEMO RESPONSES
  // ========================================
  
  private getDemoResponse(message: string): string {
    const demoResponses = [
      'Baseado na análise técnica atual, o mercado apresenta sinais mistos. Recomendo cautela.',
      'Os indicadores RSI sugerem uma possível reversão. Monitore os volumes para confirmação.',
      'Tendência de alta confirmada pelos indicadores. Considere posições long com stop-loss.',
      'Mercado em consolidação. Aguarde breakout para definir direção.',
      'Sinais de sobrevenda detectados. Oportunidade de compra em suportes.',
      'Alta volatilidade observada. Ajuste o tamanho das posições adequadamente.',
      'Momentum positivo confirmado. Mantenha as posições winners.',
      'Divergência bearish nos indicadores. Considere proteção de lucros.'
    ];

    // Selecionar resposta baseada no conteúdo da mensagem
    if (message.toLowerCase().includes('rsi')) {
      return 'RSI indica ' + (Math.random() > 0.5 ? 'sobrevenda' : 'sobrecompra') + '. Ajuste sua estratégia conforme os níveis de suporte e resistência.';
    }
    
    if (message.toLowerCase().includes('btc') || message.toLowerCase().includes('bitcoin')) {
      return 'Bitcoin está mostrando ' + (Math.random() > 0.5 ? 'força' : 'fraqueza') + ' relativa. Monitore os $' + (40000 + Math.floor(Math.random() * 20000)) + ' como nível chave.';
    }

    // Resposta aleatória
    const randomIndex = Math.floor(Math.random() * demoResponses.length);
    return demoResponses[randomIndex];
  }

  // ========================================
  // HEALTH CHECK
  // ========================================
  
  async healthCheck(): Promise<any> {
    if (!this.isInitialized || !this.client) {
      return {
        status: 'demo',
        model: this.model,
        message: 'Running in demo mode',
        timestamp: Date.now()
      };
    }

    try {
      // Teste simples
      const testResponse = await this.client.messages.create({
        model: this.model,
        max_tokens: 50,
        messages: [{
          role: 'user',
          content: 'Health check test'
        }]
      });

      return {
        status: 'operational',
        model: this.model,
        message: 'Claude API is responding',
        timestamp: Date.now()
      };
    } catch (error) {
      return {
        status: 'error',
        model: this.model,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      };
    }
  }

  // ========================================
  // UTILITY METHODS
  // ========================================
  
  isReady(): boolean {
    return this.isInitialized && this.client !== null;
  }

  getModel(): string {
    return this.model;
  }

  setModel(model: string): void {
    this.model = model;
    console.log(`🤖 Model changed to: ${model}`);
  }
}