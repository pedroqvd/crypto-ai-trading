import { TechnicalIndicatorBase, PriceData, StochasticRSIResult } from '../../models/TechnicalIndicator';
import { RSICalculator } from './RSICalculator';

export class StochasticRSI extends TechnicalIndicatorBase {
  private rsiPeriod: number;
  private stochPeriod: number;
  private kPeriod: number;
  private dPeriod: number;
  private rsiCalculator: RSICalculator;

  constructor(
    rsiPeriod: number = 14,
    stochPeriod: number = 14, 
    kPeriod: number = 3,
    dPeriod: number = 3
  ) {
    super();
    this.rsiPeriod = rsiPeriod;
    this.stochPeriod = stochPeriod;
    this.kPeriod = kPeriod;
    this.dPeriod = dPeriod;
    this.rsiCalculator = new RSICalculator(rsiPeriod);
  }

  public addDataPoint(data: PriceData): void {
    super.addDataPoint(data);
    this.rsiCalculator.addDataPoint(data);
  }

  public calculateStochasticRSI(): StochasticRSIResult | null {
    const requiredData = this.rsiPeriod + this.stochPeriod + this.kPeriod + this.dPeriod;
    
    if (!this.hasEnoughData(requiredData)) {
      return null;
    }

    // 1. Calcular RSI para cada período
    const rsiValues = this.calculateRSIHistory();
    
    if (rsiValues.length < this.stochPeriod) return null;

    // 2. Calcular Stochastic do RSI
    const stochRSI = this.calculateStochRSI(rsiValues);
    
    if (stochRSI.length < this.kPeriod) return null;

    // 3. Calcular %K (média móvel do StochRSI)
    const kValues = this.calculateSMA(stochRSI, this.kPeriod);
    
    if (kValues.length < this.dPeriod) return null;

    // 4. Calcular %D (média móvel do %K)
    const dValues = this.calculateSMA(kValues, this.dPeriod);

    const latestK = kValues[kValues.length - 1] * 100;
    const latestD = dValues[dValues.length - 1] * 100;
    const latestTimestamp = this.data[this.data.length - 1].timestamp;

    return {
      timestamp: latestTimestamp,
      k: Math.round(latestK * 100) / 100,
      d: Math.round(latestD * 100) / 100,
      signal: this.determineSignal(latestK, latestD),
      divergence: this.detectDivergence()
    };
  }

  private calculateRSIHistory(): number[] {
    const rsiValues: number[] = [];
    
    // Calcular RSI para cada ponto dos dados
    for (let i = this.rsiPeriod; i < this.data.length; i++) {
      const subset = this.data.slice(0, i + 1);
      const tempCalculator = new RSICalculator(this.rsiPeriod);
      
      subset.forEach(d => tempCalculator.addDataPoint(d));
      const rsi = tempCalculator.calculateRSI();
      
      if (rsi) {
        rsiValues.push(rsi.value);
      }
    }
    
    return rsiValues;
  }

  private calculateStochRSI(rsiValues: number[]): number[] {
    const stochRSI: number[] = [];
    
    for (let i = this.stochPeriod - 1; i < rsiValues.length; i++) {
      const periodRSI = rsiValues.slice(i - this.stochPeriod + 1, i + 1);
      const minRSI = Math.min(...periodRSI);
      const maxRSI = Math.max(...periodRSI);
      const currentRSI = rsiValues[i];
      
      if (maxRSI - minRSI === 0) {
        stochRSI.push(0);
      } else {
        stochRSI.push((currentRSI - minRSI) / (maxRSI - minRSI));
      }
    }
    
    return stochRSI;
  }

  private determineSignal(k: number, d: number): 'buy' | 'sell' | 'neutral' {
    // Sinal de compra: %K cruza acima de %D na zona de oversold (< 20)
    if (k > d && k < 20 && d < 20) return 'buy';
    
    // Sinal de venda: %K cruza abaixo de %D na zona de overbought (> 80)
    if (k < d && k > 80 && d > 80) return 'sell';
    
    return 'neutral';
  }

  private detectDivergence(): 'bullish' | 'bearish' | null {
    // Implementar lógica de divergência similar ao RSI
    // Por brevidade, retornando null aqui
    return null;
  }

  // Métodos auxiliares para análise avançada
  public isOverbought(k: number = 80): boolean {
    const latest = this.calculateStochasticRSI();
    return latest ? latest.k > k : false;
  }

  public isOversold(k: number = 20): boolean {
    const latest = this.calculateStochasticRSI();
    return latest ? latest.k < k : false;
  }
}