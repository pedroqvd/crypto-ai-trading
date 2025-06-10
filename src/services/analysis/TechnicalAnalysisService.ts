// ================================================
// TECHNICAL ANALYSIS SERVICE - VERSÃO CORRIGIDA
// Métodos públicos para integração CCXT
// ================================================

interface RSIResult {
  value: number;
  signal: 'bullish' | 'bearish' | 'neutral';
  timeframe: string;
}

interface StochasticRSIResult {
  k: number;
  d: number;
  signal: 'bullish' | 'bearish' | 'neutral';
  timeframe: string;
}

interface BMSBResult {
  support: number;
  current: number;
  signal: 'bullish' | 'bearish' | 'neutral';
  strength: number;
}

export class TechnicalAnalysisService {
  constructor() {
    console.log('📊 TechnicalAnalysisService initialized');
  }

  // ========================================
  // MÉTODOS PÚBLICOS PARA CCXT
  // ========================================

  /**
   * Calcular RSI - Método público
   */
  public calculateRSIPublic(prices: number[], period = 14): number[] {
    if (prices.length < period + 1) return [];

    const gains: number[] = [];
    const losses: number[] = [];

    // Calcular gains e losses
    for (let i = 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? Math.abs(change) : 0);
    }

    const rsiValues: number[] = [];

    // Primeira média simples
    let avgGain = gains.slice(0, period).reduce((sum, gain) => sum + gain, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((sum, loss) => sum + loss, 0) / period;

    let rs = avgGain / (avgLoss || 0.0001);
    let rsi = 100 - (100 / (1 + rs));
    rsiValues.push(rsi);

    // Médias móveis exponenciais subsequentes
    for (let i = period; i < gains.length; i++) {
      avgGain = ((avgGain * (period - 1)) + gains[i]) / period;
      avgLoss = ((avgLoss * (period - 1)) + losses[i]) / period;

      rs = avgGain / (avgLoss || 0.0001);
      rsi = 100 - (100 / (1 + rs));
      rsiValues.push(rsi);
    }

    return rsiValues;
  }

  /**
   * Calcular Stochastic RSI - Método público
   */
  public calculateStochasticRSIPublic(prices: number[], rsiPeriod = 14, stochPeriod = 14): number[] {
    const rsiValues = this.calculateRSIPublic(prices, rsiPeriod);
    if (rsiValues.length < stochPeriod) return [];

    const stochRSIValues: number[] = [];

    for (let i = stochPeriod - 1; i < rsiValues.length; i++) {
      const rsiWindow = rsiValues.slice(i - stochPeriod + 1, i + 1);
      const minRSI = Math.min(...rsiWindow);
      const maxRSI = Math.max(...rsiWindow);
      const currentRSI = rsiValues[i];

      const stochRSI = maxRSI !== minRSI 
        ? ((currentRSI - minRSI) / (maxRSI - minRSI)) * 100 
        : 50;

      stochRSIValues.push(stochRSI);
    }

    return stochRSIValues;
  }

  /**
   * Calcular BMSB - Método público
   */
  public calculateBMSBPublic(prices: number[], volumes: number[], period = 20): number[] {
    if (prices.length < period || volumes.length < period) return [];

    const bmsbValues: number[] = [];

    for (let i = period - 1; i < prices.length; i++) {
      const priceWindow = prices.slice(i - period + 1, i + 1);
      const volumeWindow = volumes.slice(i - period + 1, i + 1);

      // Calcular preço médio ponderado por volume
      let totalVolumePrice = 0;
      let totalVolume = 0;

      for (let j = 0; j < priceWindow.length; j++) {
        totalVolumePrice += priceWindow[j] * volumeWindow[j];
        totalVolume += volumeWindow[j];
      }

      const vwap = totalVolume > 0 ? totalVolumePrice / totalVolume : priceWindow[priceWindow.length - 1];

      // Calcular suporte baseado em VWAP
      const currentPrice = priceWindow[priceWindow.length - 1];
      const supportLevel = vwap * 0.98; // 2% abaixo do VWAP

      // Calcular força do sinal
      const strength = Math.abs((currentPrice - supportLevel) / supportLevel) * 100;

      bmsbValues.push(strength);
    }

    return bmsbValues;
  }

  // ========================================
  // MÉTODOS PRIVADOS (ORIGINAIS)
  // ========================================
  private calculateRSI(prices: number[], period = 14): RSIResult {
    const rsiValues = this.calculateRSIPublic(prices, period);
    const currentRSI = rsiValues[rsiValues.length - 1] || 50;

    let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (currentRSI < 30) signal = 'bullish';
    else if (currentRSI > 70) signal = 'bearish';

    return {
      value: currentRSI,
      signal,
      timeframe: '1h'
    };
  }

  private calculateStochasticRSI(prices: number[], rsiPeriod = 14, stochPeriod = 14): StochasticRSIResult {
    const stochValues = this.calculateStochasticRSIPublic(prices, rsiPeriod, stochPeriod);
    const currentStoch = stochValues[stochValues.length - 1] || 50;

    // Simular %D como média móvel simples de %K
    const kPeriod = 3;
    const dValues = [];
    for (let i = kPeriod - 1; i < stochValues.length; i++) {
      const kWindow = stochValues.slice(i - kPeriod + 1, i + 1);
      const d = kWindow.reduce((sum, val) => sum + val, 0) / kWindow.length;
      dValues.push(d);
    }

    const currentD = dValues[dValues.length - 1] || 50;

    let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (currentStoch < 20 && currentD < 20) signal = 'bullish';
    else if (currentStoch > 80 && currentD > 80) signal = 'bearish';

    return {
      k: currentStoch,
      d: currentD,
      signal,
      timeframe: '1h'
    };
  }

  private calculateBMSB(prices: number[], volumes: number[], period = 20): BMSBResult {
    const bmsbValues = this.calculateBMSBPublic(prices, volumes, period);
    const currentStrength = bmsbValues[bmsbValues.length - 1] || 0;

    // Calcular níveis de suporte
    const recentPrices = prices.slice(-period);
    const minPrice = Math.min(...recentPrices);
    const maxPrice = Math.max(...recentPrices);
    const currentPrice = prices[prices.length - 1];

    const supportLevel = minPrice + (maxPrice - minPrice) * 0.236; // Fibonacci 23.6%

    let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (currentPrice <= supportLevel && currentStrength > 2) signal = 'bullish';
    else if (currentPrice >= maxPrice * 0.95 && currentStrength > 5) signal = 'bearish';

    return {
      support: supportLevel,
      current: currentPrice,
      signal,
      strength: currentStrength
    };
  }

  // ========================================
  // ANÁLISE COMPLETA
  // ========================================
  analyzeMarket(prices: number[], volumes: number[]): any {
    if (prices.length < 20 || volumes.length < 20) {
      return {
        error: 'Dados insuficientes para análise',
        timestamp: Date.now()
      };
    }

    const rsi = this.calculateRSI(prices);
    const stochRSI = this.calculateStochasticRSI(prices);
    const bmsb = this.calculateBMSB(prices, volumes);

    // Gerar sinal geral
    let overallSignal = 'HOLD';
    let signalStrength = 0;

    if (rsi.signal === 'bullish') signalStrength += 1;
    if (stochRSI.signal === 'bullish') signalStrength += 1;
    if (bmsb.signal === 'bullish') signalStrength += 1;

    if (rsi.signal === 'bearish') signalStrength -= 1;
    if (stochRSI.signal === 'bearish') signalStrength -= 1;
    if (bmsb.signal === 'bearish') signalStrength -= 1;

    if (signalStrength >= 2) overallSignal = 'BUY';
    else if (signalStrength <= -2) overallSignal = 'SELL';

    return {
      indicators: {
        rsi,
        stochasticRSI: stochRSI,
        bmsb
      },
      overallSignal,
      signalStrength: Math.abs(signalStrength),
      recommendation: this.generateRecommendation(overallSignal, signalStrength),
      timestamp: Date.now()
    };
  }

  private generateRecommendation(signal: string, strength: number): string {
    const strengthMap = ['Fraco', 'Moderado', 'Forte'];
    const strengthLabel = strengthMap[Math.min(strength, 2)] || 'Neutro';

    switch (signal) {
      case 'BUY':
        return `Sinal de COMPRA ${strengthLabel}. Considere abrir posição long.`;
      case 'SELL':
        return `Sinal de VENDA ${strengthLabel}. Considere abrir posição short.`;
      default:
        return 'Sinal neutro. Aguarde confirmação antes de operar.';
    }
  }

  // ========================================
  // HEALTH CHECK
  // ========================================
  healthCheck(): any {
    return {
      status: 'operational',
      indicators: ['RSI', 'Stochastic RSI', 'BMSB'],
      timestamp: Date.now()
    };
  }
}