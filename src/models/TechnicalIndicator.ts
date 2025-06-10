export interface PriceData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface RSIResult {
  timestamp: number;
  value: number;
  signal: 'overbought' | 'oversold' | 'neutral';
  strength: 'strong' | 'medium' | 'weak';
}

export interface StochasticRSIResult {
  timestamp: number;
  k: number;
  d: number;
  signal: 'buy' | 'sell' | 'neutral';
  divergence?: 'bullish' | 'bearish' | null;
}

export interface BMSBResult {
  timestamp: number;
  sma20: number;
  sma21: number;
  currentPrice: number;
  position: 'above' | 'below' | 'between';
  signal: 'bullish' | 'bearish' | 'neutral';
  strength: number; // 0-100
}

export class TechnicalIndicatorBase {
  protected data: PriceData[] = [];
  protected maxDataPoints: number = 200;

  public addDataPoint(data: PriceData): void {
    this.data.push(data);
    
    // Manter apenas os últimos N pontos para performance
    if (this.data.length > this.maxDataPoints) {
      this.data = this.data.slice(-this.maxDataPoints);
    }
    
    // Ordenar por timestamp
    this.data.sort((a, b) => a.timestamp - b.timestamp);
  }

  public getLatestData(count: number): PriceData[] {
    return this.data.slice(-count);
  }

  public hasEnoughData(required: number): boolean {
    return this.data.length >= required;
  }

  protected calculateSMA(prices: number[], period: number): number[] {
    const sma: number[] = [];
    
    for (let i = period - 1; i < prices.length; i++) {
      const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      sma.push(sum / period);
    }
    
    return sma;
  }

  protected calculateEMA(prices: number[], period: number): number[] {
    const ema: number[] = [];
    const multiplier = 2 / (period + 1);
    
    // Primeira EMA é a SMA
    ema[0] = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    // Calcular EMAs subsequentes
    for (let i = 1; i < prices.length - period + 1; i++) {
      ema[i] = (prices[i + period - 1] * multiplier) + (ema[i - 1] * (1 - multiplier));
    }
    
    return ema;
  }
}