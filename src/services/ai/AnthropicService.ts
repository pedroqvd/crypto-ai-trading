import Anthropic from '@anthropic-ai/sdk';
import { TechnicalIndicators } from '../analysis/TechnicalAnalysisService';

export interface ClaudeAnalysisRequest {
  symbol: string;
  price: number;
  indicators: TechnicalIndicators;
  marketContext?: {
    trend: string;
    volume: number;
    volatility: number;
  };
}

export interface ClaudeAnalysisResponse {
  analysis: string;
  recommendation: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  confidence: number;
  reasoning: string;
  timeframe: string;
  riskLevel: 'low' | 'medium' | 'high';
  keyPoints: string[];
  timestamp: string;
  cost: {
    inputTokens: number;
    outputTokens: number;
    totalCost: number;
  };
}

export class AnthropicService {
  private client: Anthropic;
  private model: string;

  constructor() {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is required');
    }

    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      maxRetries: 3,
      timeout: 30000, // 30 segundos
    });

    this.model = process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022';
    console.log('🤖 AnthropicService initialized with model:', this.model);
  }

  // Helper function para extrair mensagem de erro
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }

  // Helper function para extrair texto de ContentBlock
  private extractTextFromContent(content: Anthropic.ContentBlock[]): string {
    for (const block of content) {
      if (block.type === 'text') {
        return block.text;
      }
    }
    return '';
  }

  /**
   * Analisa dados de mercado e indicadores técnicos
   */
  async analyzeTradingData(request: ClaudeAnalysisRequest): Promise<ClaudeAnalysisResponse> {
    try {
      const prompt = this.buildTradingPrompt(request);
      
      console.log(`🧠 Requesting Claude analysis for ${request.symbol} at $${request.price}`);
      
      const startTime = Date.now();
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1500,
        temperature: 0.1, // Baixa temperatura para respostas mais consistentes
        system: this.getSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      const duration = Date.now() - startTime;
      console.log(`✅ Claude response received in ${duration}ms`);

      // Parse da resposta
      const analysisResult = this.parseClaudeResponse(response, request);
      
      // Calcular custos
      const cost = this.calculateCost(response.usage);
      
      // Garantir que todas as propriedades obrigatórias estão definidas
      return {
        analysis: analysisResult.analysis || 'Análise não disponível',
        recommendation: analysisResult.recommendation || 'hold',
        confidence: analysisResult.confidence || 0.5,
        reasoning: analysisResult.reasoning || 'Análise baseada nos indicadores técnicos',
        timeframe: analysisResult.timeframe || 'médio prazo',
        riskLevel: analysisResult.riskLevel || 'medium',
        keyPoints: analysisResult.keyPoints || ['Análise em processamento'],
        timestamp: new Date().toISOString(),
        cost
      };

    } catch (error) {
      console.error('❌ Claude API Error:', error);
      
      // Retornar resposta padrão em caso de erro
      return this.getDefaultResponse(request, this.getErrorMessage(error));
    }
  }

  /**
   * Análise rápida para chat
   */
  async quickAnalysis(message: string, context?: any): Promise<string> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 800,
        temperature: 0.2,
        system: 'Você é um assistente especializado em trading de criptomoedas. Responda de forma clara e objetiva.',
        messages: [
          {
            role: 'user',
            content: `${message}\n\nContexto adicional: ${context ? JSON.stringify(context, null, 2) : 'Não fornecido'}`
          }
        ]
      });

      return this.extractTextFromContent(response.content) || 'Não foi possível gerar resposta.';
    } catch (error) {
      console.error('❌ Claude Quick Analysis Error:', error);
      return `Erro na análise: ${this.getErrorMessage(error)}. Tente novamente.`;
    }
  }

  /**
   * Constrói prompt especializado para trading
   */
  private buildTradingPrompt(request: ClaudeAnalysisRequest): string {
    const { symbol, price, indicators, marketContext } = request;

    return `
Analise os seguintes dados de mercado para ${symbol}:

PREÇO ATUAL: $${price}

INDICADORES TÉCNICOS:
• RSI (14): ${indicators.rsi.value} (${indicators.rsi.signal})
• Stochastic RSI: K=${indicators.stochRSI.k}, D=${indicators.stochRSI.d} (${indicators.stochRSI.signal})
• BMSB: ${indicators.bmsb.signal} (Suporte: $${indicators.bmsb.support})
• Sinal Geral: ${indicators.overall.signal} (Confiança: ${indicators.overall.confidence})

${marketContext ? `
CONTEXTO DE MERCADO:
• Tendência: ${marketContext.trend}
• Volume: ${marketContext.volume}
• Volatilidade: ${marketContext.volatility}
` : ''}

FORNEÇA SUA ANÁLISE NO SEGUINTE FORMATO JSON:
{
  "recommendation": "buy|sell|hold|strong_buy|strong_sell",
  "confidence": 0.75,
  "reasoning": "Explicação detalhada da recomendação",
  "timeframe": "curto|médio|longo prazo",
  "riskLevel": "low|medium|high",
  "keyPoints": [
    "Ponto principal 1",
    "Ponto principal 2",
    "Ponto principal 3"
  ],
  "priceTargets": {
    "support": 42000,
    "resistance": 45000,
    "stopLoss": 41000
  }
}

Seja objetivo e baseie-se nos indicadores técnicos fornecidos.
`;
  }

  /**
   * System prompt para trading de crypto
   */
  private getSystemPrompt(): string {
    return `Você é um analista técnico especializado em criptomoedas com 10+ anos de experiência em trading.

SUAS CARACTERÍSTICAS:
• Experiência em análise técnica avançada
• Conhecimento profundo de indicadores (RSI, MACD, Bollinger Bands, etc.)
• Especialização em mercados crypto 24/7
• Abordagem conservadora para gestão de risco

DIRETRIZES:
• Sempre forneça respostas em JSON válido
• Base suas análises nos indicadores técnicos fornecidos
• Seja honesto sobre limitações e incertezas
• Considere a alta volatilidade dos mercados crypto
• Inclua sempre gestão de risco nas recomendações

NUNCA:
• Dê garantias de lucro
• Ignore sinais de risco
• Faça recomendações sem base técnica
• Esqueça de mencionar stop-loss quando relevante`;
  }

  /**
   * Parse da resposta do Claude
   */
  private parseClaudeResponse(response: Anthropic.Message, request: ClaudeAnalysisRequest): Partial<ClaudeAnalysisResponse> {
    try {
      const content = this.extractTextFromContent(response.content);
      
      // Tentar extrair JSON da resposta
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsedData = JSON.parse(jsonMatch[0]);
        
        return {
          analysis: content,
          recommendation: parsedData.recommendation || 'hold',
          confidence: parsedData.confidence || 0.5,
          reasoning: parsedData.reasoning || 'Análise baseada nos indicadores técnicos.',
          timeframe: parsedData.timeframe || 'médio prazo',
          riskLevel: parsedData.riskLevel || 'medium',
          keyPoints: parsedData.keyPoints || ['Análise em andamento']
        };
      } else {
        // Fallback se não conseguir extrair JSON
        return {
          analysis: content,
          recommendation: this.inferRecommendation(request.indicators),
          confidence: 0.6,
          reasoning: content.substring(0, 200) + '...',
          timeframe: 'médio prazo',
          riskLevel: 'medium',
          keyPoints: ['Análise textual processada']
        };
      }
    } catch (error) {
      console.error('❌ Error parsing Claude response:', error);
      return this.getDefaultAnalysis(request);
    }
  }

  /**
   * Inferir recomendação baseada nos indicadores
   */
  private inferRecommendation(indicators: TechnicalIndicators): ClaudeAnalysisResponse['recommendation'] {
    const { overall } = indicators;
    
    switch (overall.recommendation) {
      case 'strong_buy': return 'strong_buy';
      case 'buy': return 'buy';
      case 'sell': return 'sell';
      case 'strong_sell': return 'strong_sell';
      default: return 'hold';
    }
  }

  /**
   * Calcular custos da API
   */
  private calculateCost(usage: Anthropic.Usage): ClaudeAnalysisResponse['cost'] {
    const inputCostPerToken = 0.000003; // $3 per 1M input tokens
    const outputCostPerToken = 0.000015; // $15 per 1M output tokens
    
    const inputTokens = usage.input_tokens || 0;
    const outputTokens = usage.output_tokens || 0;
    
    const inputCost = inputTokens * inputCostPerToken;
    const outputCost = outputTokens * outputCostPerToken;
    
    return {
      inputTokens,
      outputTokens,
      totalCost: inputCost + outputCost
    };
  }

  /**
   * Resposta padrão em caso de erro
   */
  private getDefaultResponse(request: ClaudeAnalysisRequest, errorMessage: string): ClaudeAnalysisResponse {
    return {
      analysis: `Erro na análise de ${request.symbol}: ${errorMessage}`,
      recommendation: 'hold',
      confidence: 0.1,
      reasoning: 'Análise indisponível devido a erro técnico. Aguarde e tente novamente.',
      timeframe: 'N/A',
      riskLevel: 'high',
      keyPoints: ['Sistema temporariamente indisponível'],
      timestamp: new Date().toISOString(),
      cost: {
        inputTokens: 0,
        outputTokens: 0,
        totalCost: 0
      }
    };
  }

  /**
   * Análise padrão baseada nos indicadores
   */
  private getDefaultAnalysis(request: ClaudeAnalysisRequest): Partial<ClaudeAnalysisResponse> {
    const { indicators } = request;
    
    return {
      analysis: `Análise técnica automática para ${request.symbol}`,
      recommendation: this.inferRecommendation(indicators),
      confidence: indicators.overall.confidence,
      reasoning: `Baseado em RSI ${indicators.rsi.value} e sinal geral ${indicators.overall.signal}`,
      timeframe: 'médio prazo',
      riskLevel: 'medium',
      keyPoints: [
        `RSI: ${indicators.rsi.value} (${indicators.rsi.signal})`,
        `BMSB: ${indicators.bmsb.signal}`,
        `Confiança: ${Math.round(indicators.overall.confidence * 100)}%`
      ]
    };
  }

  /**
   * Verificar se a API está funcionando
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 10,
        messages: [
          {
            role: 'user',
            content: 'Test'
          }
        ]
      });
      
      console.log('✅ Claude API health check passed');
      return true;
    } catch (error) {
      console.error('❌ Claude API health check failed:', error);
      return false;
    }
  }
}