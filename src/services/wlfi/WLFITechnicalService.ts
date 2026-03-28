// ================================================
// WLFI TECHNICAL SERVICE - Calculates technical
// analysis indicators for WLFI token with caching
// ================================================

import axios, { AxiosInstance } from 'axios';

// ================================================
// INTERFACES
// ================================================

export interface RSIData {
  current: number;
  signal: 'overbought' | 'neutral' | 'oversold';
  history: { timestamp: string; value: number }[];
}

export interface MACDData {
  macdLine: number;
  signalLine: number;
  histogram: number;
  signal: 'bullish' | 'bearish' | 'neutral';
  history: { timestamp: string; macd: number; signal: number; histogram: number }[];
}

export interface BollingerData {
  upper: number;
  middle: number;
  lower: number;
  bandwidth: number;
  percentB: number;
  signal: 'overbought' | 'neutral' | 'oversold';
  history: { timestamp: string; upper: number; middle: number; lower: number; close: number }[];
}

export interface MovingAverages {
  sma20: number;
  sma50: number;
  sma200: number;
  ema12: number;
  ema26: number;
  trend: 'bullish' | 'bearish' | 'sideways';
  goldenCross: boolean;
  deathCross: boolean;
}

export interface VolumeProfile {
  current24h: number;
  average7d: number;
  average30d: number;
  volumeChange: number;
  buyVolume: number;
  sellVolume: number;
  buyPercentage: number;
}

export interface PriceCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TechnicalOverview {
  rsi: RSIData;
  macd: MACDData;
  bollinger: BollingerData;
  movingAverages: MovingAverages;
  volume: VolumeProfile;
  overallSignal: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';
  overallScore: number;
  priceHistory: PriceCandle[];
  lastUpdated: string;
}

// ================================================
// CONSTANTS
// ================================================

const BASE_PRICE = 0.0482;
const CANDLE_COUNT = 100;
const CANDLE_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

// ================================================
// SERVICE CLASS
// ================================================

export class WLFITechnicalService {
  private client: AxiosInstance;
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private cacheTTL = 90000; // 90 seconds
  private priceHistory: PriceCandle[] | null = null;

  constructor() {
    this.client = axios.create({
      timeout: 10000,
      headers: { Accept: 'application/json' },
    });

    console.log('📊 WLFITechnicalService initialized');
  }

  // ========================================
  // CACHE HELPERS
  // ========================================

  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.timestamp < this.cacheTTL) {
      return entry.data as T;
    }
    return null;
  }

  private setCache(key: string, data: any): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  // ========================================
  // SEEDED RANDOM (deterministic per seed)
  // ========================================

  private seededRandom(seed: number): number {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  }

  // ========================================
  // GENERATE MOCK PRICE HISTORY
  // ========================================

  private generatePriceHistory(): PriceCandle[] {
    if (this.priceHistory) return this.priceHistory;

    const candles: PriceCandle[] = [];
    const now = Date.now();
    let price = BASE_PRICE * 0.92; // Start lower so we trend up to ~0.0482

    for (let i = 0; i < CANDLE_COUNT; i++) {
      const timestamp = new Date(now - (CANDLE_COUNT - 1 - i) * CANDLE_INTERVAL_MS).toISOString();
      const seed = i + 42;
      const rand1 = this.seededRandom(seed);
      const rand2 = this.seededRandom(seed + 1000);
      const rand3 = this.seededRandom(seed + 2000);

      // Slight upward drift to end near BASE_PRICE
      const drift = 0.0003;
      const volatility = 0.015;
      const change = (rand1 - 0.48) * volatility + drift;

      const open = price;
      const close = open * (1 + change);
      const highExtra = Math.abs(rand2 * volatility * open * 0.5);
      const lowExtra = Math.abs(rand3 * volatility * open * 0.5);
      const high = Math.max(open, close) + highExtra;
      const low = Math.min(open, close) - lowExtra;

      // Volume: trending up over time with some noise
      const baseVolume = 2_000_000 + (i / CANDLE_COUNT) * 1_500_000;
      const volumeNoise = (rand1 - 0.5) * 800_000;
      const volume = Math.max(500_000, baseVolume + volumeNoise);

      candles.push({
        timestamp,
        open: parseFloat(open.toFixed(6)),
        high: parseFloat(high.toFixed(6)),
        low: parseFloat(low.toFixed(6)),
        close: parseFloat(close.toFixed(6)),
        volume: parseFloat(volume.toFixed(0)),
      });

      price = close;
    }

    this.priceHistory = candles;
    return candles;
  }

  // ========================================
  // MATH HELPERS
  // ========================================

  private calculateSMA(values: number[], period: number): number {
    if (values.length < period) return values[values.length - 1];
    const slice = values.slice(values.length - period);
    return slice.reduce((sum, v) => sum + v, 0) / period;
  }

  private calculateSMAArray(values: number[], period: number): number[] {
    const result: number[] = [];
    for (let i = 0; i < values.length; i++) {
      if (i < period - 1) {
        result.push(NaN);
      } else {
        const slice = values.slice(i - period + 1, i + 1);
        result.push(slice.reduce((sum, v) => sum + v, 0) / period);
      }
    }
    return result;
  }

  private calculateEMAArray(values: number[], period: number): number[] {
    const result: number[] = [];
    const multiplier = 2 / (period + 1);

    for (let i = 0; i < values.length; i++) {
      if (i < period - 1) {
        result.push(NaN);
      } else if (i === period - 1) {
        // First EMA value is the SMA
        const sma = values.slice(0, period).reduce((sum, v) => sum + v, 0) / period;
        result.push(sma);
      } else {
        const prevEma = result[i - 1];
        result.push((values[i] - prevEma) * multiplier + prevEma);
      }
    }
    return result;
  }

  private calculateStdDev(values: number[], period: number, index: number): number {
    if (index < period - 1) return 0;
    const slice = values.slice(index - period + 1, index + 1);
    const mean = slice.reduce((sum, v) => sum + v, 0) / period;
    const squaredDiffs = slice.map((v) => (v - mean) ** 2);
    return Math.sqrt(squaredDiffs.reduce((sum, v) => sum + v, 0) / period);
  }

  // ========================================
  // RSI CALCULATION
  // ========================================

  async getRSI(): Promise<RSIData> {
    const cacheKey = 'wlfi-rsi';
    const cached = this.getCached<RSIData>(cacheKey);
    if (cached) return cached;

    try {
      const candles = this.generatePriceHistory();
      const closes = candles.map((c) => c.close);
      const period = 14;

      // Calculate price changes
      const changes: number[] = [];
      for (let i = 1; i < closes.length; i++) {
        changes.push(closes[i] - closes[i - 1]);
      }

      // Calculate RSI series
      const rsiValues: { timestamp: string; value: number }[] = [];
      let avgGain = 0;
      let avgLoss = 0;

      // Initial average gain/loss over first `period` changes
      for (let i = 0; i < period; i++) {
        if (changes[i] > 0) avgGain += changes[i];
        else avgLoss += Math.abs(changes[i]);
      }
      avgGain /= period;
      avgLoss /= period;

      const firstRS = avgLoss === 0 ? 100 : avgGain / avgLoss;
      const firstRSI = 100 - 100 / (1 + firstRS);
      rsiValues.push({ timestamp: candles[period].timestamp, value: parseFloat(firstRSI.toFixed(2)) });

      // Smoothed RSI for remaining values
      for (let i = period; i < changes.length; i++) {
        const gain = changes[i] > 0 ? changes[i] : 0;
        const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        const rsi = 100 - 100 / (1 + rs);
        rsiValues.push({
          timestamp: candles[i + 1].timestamp,
          value: parseFloat(rsi.toFixed(2)),
        });
      }

      // Take last 50 for history
      const history = rsiValues.slice(-50);
      const current = history[history.length - 1].value;

      let signal: 'overbought' | 'neutral' | 'oversold' = 'neutral';
      if (current >= 70) signal = 'overbought';
      else if (current <= 30) signal = 'oversold';

      const result: RSIData = { current, signal, history };
      this.setCache(cacheKey, result);
      console.log(`📈 RSI calculated: ${current} (${signal})`);
      return result;
    } catch (error) {
      console.error('❌ WLFITechnicalService RSI error:', error instanceof Error ? error.message : error);
      return { current: 58, signal: 'neutral', history: [] };
    }
  }

  // ========================================
  // MACD CALCULATION
  // ========================================

  async getMACD(): Promise<MACDData> {
    const cacheKey = 'wlfi-macd';
    const cached = this.getCached<MACDData>(cacheKey);
    if (cached) return cached;

    try {
      const candles = this.generatePriceHistory();
      const closes = candles.map((c) => c.close);

      const ema12 = this.calculateEMAArray(closes, 12);
      const ema26 = this.calculateEMAArray(closes, 26);

      // MACD line = EMA12 - EMA26
      const macdLine: number[] = [];
      for (let i = 0; i < closes.length; i++) {
        if (isNaN(ema12[i]) || isNaN(ema26[i])) {
          macdLine.push(NaN);
        } else {
          macdLine.push(ema12[i] - ema26[i]);
        }
      }

      // Signal line = 9-period EMA of MACD line
      const validMacd = macdLine.filter((v) => !isNaN(v));
      const signalLineArr = this.calculateEMAArray(validMacd, 9);

      // Build history from valid MACD values
      const macdStartIndex = macdLine.findIndex((v) => !isNaN(v));
      const history: { timestamp: string; macd: number; signal: number; histogram: number }[] = [];

      for (let i = 0; i < validMacd.length; i++) {
        if (!isNaN(signalLineArr[i])) {
          const candleIndex = macdStartIndex + i;
          const macdVal = validMacd[i];
          const sigVal = signalLineArr[i];
          const hist = macdVal - sigVal;
          history.push({
            timestamp: candles[candleIndex].timestamp,
            macd: parseFloat(macdVal.toFixed(8)),
            signal: parseFloat(sigVal.toFixed(8)),
            histogram: parseFloat(hist.toFixed(8)),
          });
        }
      }

      // Take last 50 for history
      const last50 = history.slice(-50);
      const latest = last50[last50.length - 1];

      let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
      if (latest.histogram > 0 && latest.macd > latest.signal) signal = 'bullish';
      else if (latest.histogram < 0 && latest.macd < latest.signal) signal = 'bearish';

      const result: MACDData = {
        macdLine: latest.macd,
        signalLine: latest.signal,
        histogram: latest.histogram,
        signal,
        history: last50,
      };

      this.setCache(cacheKey, result);
      console.log(`📉 MACD calculated: ${latest.macd.toFixed(8)} (${signal})`);
      return result;
    } catch (error) {
      console.error('❌ WLFITechnicalService MACD error:', error instanceof Error ? error.message : error);
      return {
        macdLine: 0, signalLine: 0, histogram: 0, signal: 'neutral', history: [],
      };
    }
  }

  // ========================================
  // BOLLINGER BANDS CALCULATION
  // ========================================

  async getBollingerBands(): Promise<BollingerData> {
    const cacheKey = 'wlfi-bollinger';
    const cached = this.getCached<BollingerData>(cacheKey);
    if (cached) return cached;

    try {
      const candles = this.generatePriceHistory();
      const closes = candles.map((c) => c.close);
      const period = 20;
      const stdDevMultiplier = 2;

      const smaArr = this.calculateSMAArray(closes, period);

      const history: { timestamp: string; upper: number; middle: number; lower: number; close: number }[] = [];

      for (let i = period - 1; i < closes.length; i++) {
        const middle = smaArr[i];
        const stdDev = this.calculateStdDev(closes, period, i);
        const upper = middle + stdDevMultiplier * stdDev;
        const lower = middle - stdDevMultiplier * stdDev;

        history.push({
          timestamp: candles[i].timestamp,
          upper: parseFloat(upper.toFixed(6)),
          middle: parseFloat(middle.toFixed(6)),
          lower: parseFloat(lower.toFixed(6)),
          close: closes[i],
        });
      }

      // Take last 50 for history
      const last50 = history.slice(-50);
      const latest = last50[last50.length - 1];

      const bandwidth = (latest.upper - latest.lower) / latest.middle;
      const percentB = latest.upper !== latest.lower
        ? (latest.close - latest.lower) / (latest.upper - latest.lower)
        : 0.5;

      let signal: 'overbought' | 'neutral' | 'oversold' = 'neutral';
      if (percentB > 0.8) signal = 'overbought';
      else if (percentB < 0.2) signal = 'oversold';

      const result: BollingerData = {
        upper: latest.upper,
        middle: latest.middle,
        lower: latest.lower,
        bandwidth: parseFloat(bandwidth.toFixed(6)),
        percentB: parseFloat(percentB.toFixed(4)),
        signal,
        history: last50,
      };

      this.setCache(cacheKey, result);
      console.log(`📊 Bollinger Bands calculated: %B=${percentB.toFixed(4)} (${signal})`);
      return result;
    } catch (error) {
      console.error('❌ WLFITechnicalService Bollinger error:', error instanceof Error ? error.message : error);
      return {
        upper: 0, middle: 0, lower: 0, bandwidth: 0, percentB: 0.5, signal: 'neutral', history: [],
      };
    }
  }

  // ========================================
  // MOVING AVERAGES CALCULATION
  // ========================================

  async getMovingAverages(): Promise<MovingAverages> {
    const cacheKey = 'wlfi-ma';
    const cached = this.getCached<MovingAverages>(cacheKey);
    if (cached) return cached;

    try {
      const candles = this.generatePriceHistory();
      const closes = candles.map((c) => c.close);

      const sma20 = this.calculateSMA(closes, 20);
      const sma50 = this.calculateSMA(closes, 50);
      // For SMA200 we only have 100 candles, so use all available
      const sma200 = this.calculateSMA(closes, Math.min(200, closes.length));

      const ema12Arr = this.calculateEMAArray(closes, 12);
      const ema26Arr = this.calculateEMAArray(closes, 26);
      const ema12 = ema12Arr[ema12Arr.length - 1];
      const ema26 = ema26Arr[ema26Arr.length - 1];

      const currentPrice = closes[closes.length - 1];

      // Trend determination
      let trend: 'bullish' | 'bearish' | 'sideways' = 'sideways';
      if (currentPrice > sma20 && sma20 > sma50) trend = 'bullish';
      else if (currentPrice < sma20 && sma20 < sma50) trend = 'bearish';

      // Golden cross: SMA50 crosses above SMA200 (check last 2 values)
      const sma50Prev = this.calculateSMA(closes.slice(0, -1), 50);
      const sma200Prev = this.calculateSMA(closes.slice(0, -1), Math.min(200, closes.length - 1));
      const goldenCross = sma50Prev <= sma200Prev && sma50 > sma200;
      const deathCross = sma50Prev >= sma200Prev && sma50 < sma200;

      const result: MovingAverages = {
        sma20: parseFloat(sma20.toFixed(6)),
        sma50: parseFloat(sma50.toFixed(6)),
        sma200: parseFloat(sma200.toFixed(6)),
        ema12: parseFloat(ema12.toFixed(6)),
        ema26: parseFloat(ema26.toFixed(6)),
        trend,
        goldenCross,
        deathCross,
      };

      this.setCache(cacheKey, result);
      console.log(`📈 Moving Averages calculated: trend=${trend}, goldenCross=${goldenCross}`);
      return result;
    } catch (error) {
      console.error('❌ WLFITechnicalService MA error:', error instanceof Error ? error.message : error);
      return {
        sma20: BASE_PRICE, sma50: BASE_PRICE, sma200: BASE_PRICE,
        ema12: BASE_PRICE, ema26: BASE_PRICE,
        trend: 'sideways', goldenCross: false, deathCross: false,
      };
    }
  }

  // ========================================
  // VOLUME PROFILE CALCULATION
  // ========================================

  async getVolumeProfile(): Promise<VolumeProfile> {
    const cacheKey = 'wlfi-volume';
    const cached = this.getCached<VolumeProfile>(cacheKey);
    if (cached) return cached;

    try {
      const candles = this.generatePriceHistory();

      // Last 6 candles = 24h (4h intervals)
      const last6 = candles.slice(-6);
      const current24h = last6.reduce((sum, c) => sum + c.volume, 0);

      // Last 42 candles = 7 days
      const last42 = candles.slice(-42);
      const total7d = last42.reduce((sum, c) => sum + c.volume, 0);
      const average7d = total7d / 7;

      // All 100 candles span ~17 days, approximate 30d average from available data
      const totalAll = candles.reduce((sum, c) => sum + c.volume, 0);
      const daysSpanned = (CANDLE_COUNT * 4) / 24;
      const average30d = totalAll / daysSpanned;

      const volumeChange = average7d > 0 ? ((current24h - average7d) / average7d) * 100 : 0;

      // Buy/sell split from candle direction
      let buyVol = 0;
      let sellVol = 0;
      for (const candle of last6) {
        if (candle.close >= candle.open) {
          buyVol += candle.volume;
        } else {
          sellVol += candle.volume;
        }
      }

      const buyPercentage = current24h > 0 ? (buyVol / current24h) * 100 : 50;

      const result: VolumeProfile = {
        current24h: parseFloat(current24h.toFixed(0)),
        average7d: parseFloat(average7d.toFixed(0)),
        average30d: parseFloat(average30d.toFixed(0)),
        volumeChange: parseFloat(volumeChange.toFixed(2)),
        buyVolume: parseFloat(buyVol.toFixed(0)),
        sellVolume: parseFloat(sellVol.toFixed(0)),
        buyPercentage: parseFloat(buyPercentage.toFixed(2)),
      };

      this.setCache(cacheKey, result);
      console.log(`📊 Volume Profile calculated: 24h=${current24h.toFixed(0)}, change=${volumeChange.toFixed(2)}%`);
      return result;
    } catch (error) {
      console.error('❌ WLFITechnicalService Volume error:', error instanceof Error ? error.message : error);
      return {
        current24h: 0, average7d: 0, average30d: 0, volumeChange: 0,
        buyVolume: 0, sellVolume: 0, buyPercentage: 50,
      };
    }
  }

  // ========================================
  // TECHNICAL OVERVIEW (all combined)
  // ========================================

  async getTechnicalOverview(): Promise<TechnicalOverview> {
    const cacheKey = 'wlfi-technical-overview';
    const cached = this.getCached<TechnicalOverview>(cacheKey);
    if (cached) return cached;

    try {
      const [rsi, macd, bollinger, movingAverages, volume] = await Promise.all([
        this.getRSI(),
        this.getMACD(),
        this.getBollingerBands(),
        this.getMovingAverages(),
        this.getVolumeProfile(),
      ]);

      // Calculate overall score (-100 to 100)
      let score = 0;

      // RSI contribution (-25 to 25)
      if (rsi.current < 30) score += 25;
      else if (rsi.current < 40) score += 15;
      else if (rsi.current < 50) score += 5;
      else if (rsi.current < 60) score += 10;
      else if (rsi.current < 70) score += 0;
      else score -= 20;

      // MACD contribution (-25 to 25)
      if (macd.signal === 'bullish') score += 20;
      else if (macd.signal === 'bearish') score -= 20;

      // Bollinger contribution (-25 to 25)
      if (bollinger.percentB < 0.2) score += 15; // oversold = buy signal
      else if (bollinger.percentB > 0.8) score -= 15; // overbought = sell signal
      else if (bollinger.percentB > 0.4 && bollinger.percentB < 0.6) score += 5;

      // Moving averages contribution (-25 to 25)
      if (movingAverages.trend === 'bullish') score += 15;
      else if (movingAverages.trend === 'bearish') score -= 15;
      if (movingAverages.goldenCross) score += 10;
      if (movingAverages.deathCross) score -= 10;

      // Clamp score
      score = Math.max(-100, Math.min(100, score));

      // Determine overall signal
      let overallSignal: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell' = 'neutral';
      if (score >= 60) overallSignal = 'strong_buy';
      else if (score >= 20) overallSignal = 'buy';
      else if (score <= -60) overallSignal = 'strong_sell';
      else if (score <= -20) overallSignal = 'sell';

      const priceHistory = this.generatePriceHistory();

      const result: TechnicalOverview = {
        rsi,
        macd,
        bollinger,
        movingAverages,
        volume,
        overallSignal,
        overallScore: score,
        priceHistory,
        lastUpdated: new Date().toISOString(),
      };

      this.setCache(cacheKey, result);
      console.log(`🎯 Technical Overview: signal=${overallSignal}, score=${score}`);
      return result;
    } catch (error) {
      console.error('❌ WLFITechnicalService overview error:', error instanceof Error ? error.message : error);
      throw error;
    }
  }

  // ========================================
  // HEALTH CHECK
  // ========================================

  async healthCheck(): Promise<{ status: string; cacheSize: number; timestamp: number }> {
    try {
      // Verify we can generate data successfully
      const candles = this.generatePriceHistory();
      const healthy = candles.length === CANDLE_COUNT;

      return {
        status: healthy ? 'operational' : 'degraded',
        cacheSize: this.cache.size,
        timestamp: Date.now(),
      };
    } catch {
      return { status: 'error', cacheSize: this.cache.size, timestamp: Date.now() };
    }
  }
}
