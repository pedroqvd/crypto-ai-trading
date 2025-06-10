export interface TechnicalIndicators {
  rsi: {
    value: number;
    signal: 'bullish' | 'bearish' | 'neutral';
    timeframe: string;
  };
  stochRSI: {
    k: number;
    d: number;
    signal: 'bullish' | 'bearish' | 'neutral';
    timeframe: string;
  };
  bmsb: {
    support: number;
    current: number;
    signal: 'bullish' | 'bearish' | 'neutral';
    strength: number;
  };
  overall: {
    signal: 'bullish' | 'bearish' | 'neutral';
    confidence: number;
    recommendation: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  };
  timestamp: string;
}

export interface PriceData {
  symbol: string;
  price: number;
  volume?: number;
  timestamp: string;
  high24h?: number;
  low24h?: number;
  change24h?: number;
}

export class TechnicalAnalysisService {
  private rsiPeriod: number = 14;
  private stochRSIPeriod: number = 14;
  private priceHistory: Map<string, number[]> = new Map();

  constructor() {
    console.log('📊 TechnicalAnalysisService initialized');
  }

  /**
   * Calcula todos os indicadores técnicos para um ativo
   */
  async calculateIndicators(priceData: PriceData): Promise<TechnicalIndicators> {
    try {
      // Armazenar histórico de preços
      this.updatePriceHistory(priceData.symbol, priceData.price);
      
      const prices = this.priceHistory.get(priceData.symbol) || [];
      
      // Calcular indicadores individuais
      const rsi = this.calculateRSI(prices);
      const stochRSI = this.calculateStochRSI(prices);
      const bmsb = this.calculateBMSB(prices, priceData.price);
      
      // Gerar sinal geral
      const overall = this.generateOverallSignal(rsi, stochRSI, bmsb);
      
      return {
        rsi,
        stochRSI,
        bmsb,
        overall,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ Error calculating indicators:', error);
      return this.getDefaultIndicators();
    }
  }

  /**
   * Calcula RSI (Relative Strength Index)
   */
  private calculateRSI(prices: number[]): TechnicalIndicators['rsi'] {
    if (prices.length < this.rsiPeriod + 1) {
      return {
        value: 50,
        signal: 'neutral',
        timeframe: `${this.rsiPeriod}p`
      };
    }

    // Calcular mudanças de preço
    const changes = [];
    for (let i = 1; i < prices.length; i++) {
      changes.push(prices[i] - prices[i - 1]);
    }

    // Separar ganhos e perdas
    const gains = changes.map(change => change > 0 ? change : 0);
    const losses = changes.map(change => change < 0 ? Math.abs(change) : 0);

    // Médias móveis dos ganhos e perdas
    const avgGain = gains.slice(-this.rsiPeriod).reduce((a, b) => a + b, 0) / this.rsiPeriod;
    const avgLoss = losses.slice(-this.rsiPeriod).reduce((a, b) => a + b, 0) / this.rsiPeriod;

    // Calcular RSI
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    // Determinar sinal
    let signal: 'bullish' | 'bearish' | 'neutral';
    if (rsi > 70) signal = 'bearish'; // Sobrecomprado
    else if (rsi < 30) signal = 'bullish'; // Sobrevendido
    else signal = 'neutral';

    return {
      value: Math.round(rsi * 100) / 100,
      signal,
      timeframe: `${this.rsiPeriod}p`
    };
  }

  /**
   * Calcula Stochastic RSI
   */
  private calculateStochRSI(prices: number[]): TechnicalIndicators['stochRSI'] {
    if (prices.length < this.stochRSIPeriod * 2) {
      return {
        k: 50,
        d: 50,
        signal: 'neutral',
        timeframe: `${this.stochRSIPeriod}p`
      };
    }

    // Calcular RSI para cada período
    const rsiValues = [];
    for (let i = this.rsiPeriod; i < prices.length; i++) {
      const periodPrices = prices.slice(i - this.rsiPeriod, i + 1);
      const rsi = this.calculateRSI(periodPrices);
      rsiValues.push(rsi.value);
    }

    if (rsiValues.length < this.stochRSIPeriod) {
      return {
        k: 50,
        d: 50,
        signal: 'neutral',
        timeframe: `${this.stochRSIPeriod}p`
      };
    }

    // Calcular Stochastic do RSI
    const recentRSI = rsiValues.slice(-this.stochRSIPeriod);
    const highestRSI = Math.max(...recentRSI);
    const lowestRSI = Math.min(...recentRSI);
    const currentRSI = recentRSI[recentRSI.length - 1];

    const k = ((currentRSI - lowestRSI) / (highestRSI - lowestRSI)) * 100;
    
    // Simular %D como média móvel de 3 períodos do %K
    const d = k; // Simplificado para este exemplo

    // Determinar sinal
    let signal: 'bullish' | 'bearish' | 'neutral';
    if (k > 80 && d > 80) signal = 'bearish';
    else if (k < 20 && d < 20) signal = 'bullish';
    else signal = 'neutral';

    return {
      k: Math.round(k * 100) / 100,
      d: Math.round(d * 100) / 100,
      signal,
      timeframe: `${this.stochRSIPeriod}p`
    };
  }

  /**
   * Calcula Bull Market Support Band (BMSB)
   */
  private calculateBMSB(prices: number[], currentPrice: number): TechnicalIndicators['bmsb'] {
    if (prices.length < 50) {
      return {
        support: currentPrice * 0.85,
        current: currentPrice,
        signal: 'neutral',
        strength: 0.5
      };
    }

    // BMSB = Média móvel de 20 períodos da SMA de 21 
    const sma21 = prices.slice(-21).reduce((a, b) => a + b, 0) / 21;
    const ema20 = this.calculateEMA(prices, 20);
    
    // Banda de suporte (simplificada)
    const support = Math.min(sma21, ema20);
    
    // Determinar força do sinal
    const distanceFromSupport = (currentPrice - support) / support;
    const strength = Math.max(0, Math.min(1, distanceFromSupport + 0.5));
    
    // Determinar sinal
    let signal: 'bullish' | 'bearish' | 'neutral';
    if (currentPrice > support * 1.05) signal = 'bullish';
    else if (currentPrice < support * 0.95) signal = 'bearish';
    else signal = 'neutral';

    return {
      support: Math.round(support * 100) / 100,
      current: currentPrice,
      signal,
      strength: Math.round(strength * 100) / 100
    };
  }

  /**
   * Calcula EMA (Exponential Moving Average)
   */
  private calculateEMA(prices: number[], period: number): number {
    if (prices.length < period) {
      return prices.reduce((a, b) => a + b, 0) / prices.length;
    }

    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;

    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] * multiplier) + (ema * (1 - multiplier));
    }

    return ema;
  }

  /**
   * Gera sinal geral baseado em todos os indicadores
   */
  private generateOverallSignal(
    rsi: TechnicalIndicators['rsi'],
    stochRSI: TechnicalIndicators['stochRSI'],
    bmsb: TechnicalIndicators['bmsb']
  ): TechnicalIndicators['overall'] {
    
    // Sistema de pontuação
    let bullishScore = 0;
    let bearishScore = 0;

    // RSI (peso: 35%)
    if (rsi.signal === 'bullish') bullishScore += 0.35;
    else if (rsi.signal === 'bearish') bearishScore += 0.35;

    // Stochastic RSI (peso: 30%)
    if (stochRSI.signal === 'bullish') bullishScore += 0.30;
    else if (stochRSI.signal === 'bearish') bearishScore += 0.30;

    // BMSB (peso: 35%)
    if (bmsb.signal === 'bullish') bullishScore += 0.35;
    else if (bmsb.signal === 'bearish') bearishScore += 0.35;

    // Determinar sinal final
    const netScore = bullishScore - bearishScore;
    const confidence = Math.abs(netScore);

    let signal: 'bullish' | 'bearish' | 'neutral';
    let recommendation: TechnicalIndicators['overall']['recommendation'];

    if (netScore > 0.5) {
      signal = 'bullish';
      recommendation = confidence > 0.7 ? 'strong_buy' : 'buy';
    } else if (netScore < -0.5) {
      signal = 'bearish';
      recommendation = confidence > 0.7 ? 'strong_sell' : 'sell';
    } else {
      signal = 'neutral';
      recommendation = 'hold';
    }

    return {
      signal,
      confidence: Math.round(confidence * 100) / 100,
      recommendation
    };
  }

  /**
   * Atualiza histórico de preços
   */
  private updatePriceHistory(symbol: string, price: number): void {
    if (!this.priceHistory.has(symbol)) {
      this.priceHistory.set(symbol, []);
    }

    const prices = this.priceHistory.get(symbol)!;
    prices.push(price);

    // Manter apenas os últimos 200 preços
    if (prices.length > 200) {
      prices.shift();
    }
  }

  /**
   * Retorna indicadores padrão em caso de erro
   */
  private getDefaultIndicators(): TechnicalIndicators {
    return {
      rsi: {
        value: 50,
        signal: 'neutral',
        timeframe: '14p'
      },
      stochRSI: {
        k: 50,
        d: 50,
        signal: 'neutral',
        timeframe: '14p'
      },
      bmsb: {
        support: 0,
        current: 0,
        signal: 'neutral',
        strength: 0.5
      },
      overall: {
        signal: 'neutral',
        confidence: 0,
        recommendation: 'hold'
      },
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Método público para obter análise rápida
   */
  async getQuickAnalysis(symbol: string, price: number): Promise<string> {
    const indicators = await this.calculateIndicators({
      symbol,
      price,
      timestamp: new Date().toISOString()
    });

    const { overall, rsi, stochRSI, bmsb } = indicators;

    return `📊 ${symbol} Analysis:
• Overall: ${overall.recommendation.toUpperCase()} (${overall.confidence * 100}% confidence)
• RSI: ${rsi.value} (${rsi.signal})
• Stoch RSI: ${stochRSI.k}/${stochRSI.d} (${stochRSI.signal})
• BMSB: ${bmsb.signal} (support: $${bmsb.support})`;
  }
}
