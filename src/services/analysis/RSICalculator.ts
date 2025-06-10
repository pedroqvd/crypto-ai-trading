import { TechnicalIndicatorBase, PriceData, RSIResult } from '../../models/TechnicalIndicator';

export class RSICalculator extends TechnicalIndicatorBase {
  private period: number;
  private overboughtLevel: number;
  private oversoldLevel: number;

  constructor(period: number = 14, overboughtLevel: number = 70, oversoldLevel: number = 30) {
    super();
    this.period = period;
    this.overboughtLevel = overboughtLevel;
    this.oversoldLevel = oversoldLevel;
  }

  public calculateRSI(): RSIResult | null {
    if (!this.hasEnoughData(this.period + 1)) {
      return null;
    }

    const closes = this.data.map(d => d.close);
    const rsi = this.calculateRSIValue(closes);
    
    if (rsi === null) return null;

    const latestTimestamp = this.data[this.data.length - 1].timestamp;
    
    return {
      timestamp: latestTimestamp,
      value: rsi,
      signal: this.determineSignal(rsi),
      strength: this.determineStrength(rsi)
    };
  }

  private calculateRSIValue(closes: number[]): number | null {
    if (closes.length < this.period + 1) return null;

    const gains: number[] = [];
    const losses: number[] = [];

    // Calcular gains e losses
    for (let i = 1; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? Math.abs(change) : 0);
    }

    // Primeira média (SMA)
    const avgGain = gains.slice(0, this.period).reduce((a, b) => a + b, 0) / this.period;
    const avgLoss = losses.slice(0, this.period).reduce((a, b) => a + b, 0) / this.period;

    let currentAvgGain = avgGain;
    let currentAvgLoss = avgLoss;

    // Calcular RSI para os próximos períodos usando EMA
    for (let i = this.period; i < gains.length; i++) {
      currentAvgGain = ((currentAvgGain * (this.period - 1)) + gains[i]) / this.period;
      currentAvgLoss = ((currentAvgLoss * (this.period - 1)) + losses[i]) / this.period;
    }

    if (currentAvgLoss === 0) return 100;

    const rs = currentAvgGain / currentAvgLoss;
    const rsi = 100 - (100 / (1 + rs));

    return Math.round(rsi * 100) / 100;
  }

  private determineSignal(rsi: number): 'overbought' | 'oversold' | 'neutral' {
    if (rsi >= this.overboughtLevel) return 'overbought';
    if (rsi <= this.oversoldLevel) return 'oversold';
    return 'neutral';
  }

  private determineStrength(rsi: number): 'strong' | 'medium' | 'weak' {
    if (rsi >= 80 || rsi <= 20) return 'strong';
    if (rsi >= 65 || rsi <= 35) return 'medium';
    return 'weak';
  }

  // Detectar divergências
  public detectDivergence(priceData: PriceData[], rsiHistory: RSIResult[]): 'bullish' | 'bearish' | null {
    if (priceData.length < 4 || rsiHistory.length < 4) return null;

    const recentPrices = priceData.slice(-4);
    const recentRSI = rsiHistory.slice(-4);

    // Divergência Bullish: preços fazem lower lows, RSI faz higher lows
    const priceLL = recentPrices[3].low < recentPrices[1].low;
    const rsiHL = recentRSI[3].value > recentRSI[1].value;

    if (priceLL && rsiHL && recentRSI[3].value < 50) {
      return 'bullish';
    }

    // Divergência Bearish: preços fazem higher highs, RSI faz lower highs
    const priceHH = recentPrices[3].high > recentPrices[1].high;
    const rsiLH = recentRSI[3].value < recentRSI[1].value;

    if (priceHH && rsiLH && recentRSI[3].value > 50) {
      return 'bearish';
    }

    return null;
  }
}