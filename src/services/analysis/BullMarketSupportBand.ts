import { TechnicalIndicatorBase, PriceData, BMSBResult } from '../../models/TechnicalIndicator';

export class BullMarketSupportBand extends TechnicalIndicatorBase {
  private sma20Period: number = 20;
  private sma21Period: number = 21;

  constructor() {
    super();
    this.maxDataPoints = 100; // BMSB não precisa de muitos dados históricos
  }

  public calculateBMSB(): BMSBResult | null {
    const required = Math.max(this.sma20Period, this.sma21Period);
    
    if (!this.hasEnoughData(required)) {
      return null;
    }

    const closes = this.data.map(d => d.close);
    const currentPrice = closes[closes.length - 1];
    
    // Calcular SMA 20 e SMA 21
    const sma20Values = this.calculateSMA(closes, this.sma20Period);
    const sma21Values = this.calculateSMA(closes, this.sma21Period);
    
    if (sma20Values.length === 0 || sma21Values.length === 0) {
      return null;
    }

    const latestSMA20 = sma20Values[sma20Values.length - 1];
    const latestSMA21 = sma21Values[sma21Values.length - 1];
    const latestTimestamp = this.data[this.data.length - 1].timestamp;

    return {
      timestamp: latestTimestamp,
      sma20: Math.round(latestSMA20 * 100) / 100,
      sma21: Math.round(latestSMA21 * 100) / 100,
      currentPrice: Math.round(currentPrice * 100) / 100,
      position: this.determinePosition(currentPrice, latestSMA20, latestSMA21),
      signal: this.determineSignal(currentPrice, latestSMA20, latestSMA21),
      strength: this.calculateStrength(currentPrice, latestSMA20, latestSMA21)
    };
  }

  private determinePosition(price: number, sma20: number, sma21: number): 'above' | 'below' | 'between' {
    const upper = Math.max(sma20, sma21);
    const lower = Math.min(sma20, sma21);
    
    if (price > upper) return 'above';
    if (price < lower) return 'below';
    return 'between';
  }

  private determineSignal(price: number, sma20: number, sma21: number): 'bullish' | 'bearish' | 'neutral' {
    const upper = Math.max(sma20, sma21);
    const lower = Math.min(sma20, sma21);
    
    // Bullish: preço acima da banda (bull market confirmado)
    if (price > upper && sma20 > sma21) return 'bullish';
    
    // Bearish: preço abaixo da banda (possível bear market)
    if (price < lower) return 'bearish';
    
    return 'neutral';
  }

  private calculateStrength(price: number, sma20: number, sma21: number): number {
    const upper = Math.max(sma20, sma21);
    const lower = Math.min(sma20, sma21);
    const bandWidth = upper - lower;
    
    if (bandWidth === 0) return 50;
    
    if (price > upper) {
      // Quanto mais acima da banda, maior a força bullish
      const distance = price - upper;
      const strength = 50 + Math.min(50, (distance / bandWidth) * 25);
      return Math.round(strength);
    }
    
    if (price < lower) {
      // Quanto mais abaixo da banda, maior a força bearish
      const distance = lower - price;
      const strength = 50 - Math.min(50, (distance / bandWidth) * 25);
      return Math.round(strength);
    }
    
    // Entre as bandas
    const position = (price - lower) / bandWidth;
    return Math.round(30 + (position * 40)); // Entre 30-70 quando na banda
  }

  // Análise histórica da performance da BMSB
  public getHistoricalAccuracy(days: number = 30): number {
    if (this.data.length < days + 21) return 0;
    
    let correctPredictions = 0;
    let totalPredictions = 0;
    
    // Analisar últimos N dias
    for (let i = this.data.length - days; i < this.data.length - 1; i++) {
      const subset = this.data.slice(0, i + 1);
      const tempBMSB = new BullMarketSupportBand();
      subset.forEach(d => tempBMSB.addDataPoint(d));
      
      const result = tempBMSB.calculateBMSB();
      if (result) {
        const nextDayPrice = this.data[i + 1].close;
        const currentPrice = this.data[i].close;
        const actualMove = nextDayPrice > currentPrice ? 'up' : 'down';
        const predictedMove = result.signal === 'bullish' ? 'up' : 'down';
        
        if (actualMove === predictedMove) correctPredictions++;
        totalPredictions++;
      }
    }
    
    return totalPredictions > 0 ? (correctPredictions / totalPredictions) * 100 : 0;
  }

  // Detectar breakouts da BMSB
  public detectBreakout(): 'bullish_breakout' | 'bearish_breakdown' | null {
    if (this.data.length < 5) return null;
    
    const recent = this.data.slice(-5);
    const results = recent.map(d => {
      const tempBMSB = new BullMarketSupportBand();
      this.data.slice(0, this.data.indexOf(d) + 1).forEach(point => tempBMSB.addDataPoint(point));
      return tempBMSB.calculateBMSB();
    }).filter(r => r !== null) as BMSBResult[];
    
    if (results.length < 3) return null;
    
    // Breakout bullish: preço sai de dentro/abaixo para acima da banda
    const wasBelow = results[0].position === 'below' || results[0].position === 'between';
    const nowAbove = results[results.length - 1].position === 'above';
    
    if (wasBelow && nowAbove) return 'bullish_breakout';
    
    // Breakdown bearish: preço sai de dentro/acima para abaixo da banda
    const wasAbove = results[0].position === 'above' || results[0].position === 'between';
    const nowBelow = results[results.length - 1].position === 'below';
    
    if (wasAbove && nowBelow) return 'bearish_breakdown';
    
    return null;
  }
}