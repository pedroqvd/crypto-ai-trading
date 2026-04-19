// ================================================
// BAYESIAN CALIBRATOR — Self-learning accuracy tracker
// Phase 1: Per-category calibration (sports/politics/crypto/general)
// Phase 2: Time-weighted calibration (30-day exponential decay)
// Phase 3: Rolling Brier score (last 50 predictions)
// ================================================

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/Logger';

export type MarketCategory = 'sports' | 'politics' | 'crypto' | 'general';

interface TimedOutcome {
  won: boolean;
  timestamp: number;
  estimatedProb: number;
}

interface CalibrationBucket {
  low: number;
  high: number;
  n: number;
  wins: number;
  outcomes: TimedOutcome[];
}

export interface CalibrationAdjustment {
  adjustment: number;
  confidence: number;
  sampleSize: number;
  category: MarketCategory;
}

export interface CalibrationReport {
  totalPredictions: number;
  overallBrier: number;
  rollingBrier50: number;
  byCategory: Record<MarketCategory, { n: number; brier: number }>;
  buckets: Array<{
    range: string;
    n: number;
    expectedRate: number;
    actualRate: number;
    bias: number;
  }>;
}

const BUCKET_SIZE = 0.1;
const MIN_SAMPLES = 10;
const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000; // 30-day decay half-life
const MAX_OUTCOMES_PER_BUCKET = 200;
const ROLLING_WINDOW = 50;

const CATEGORIES: MarketCategory[] = ['sports', 'politics', 'crypto', 'general'];

export class BayesianCalibrator {
  private categoryBuckets: Record<MarketCategory, CalibrationBucket[]>;
  private recentPredictions: TimedOutcome[] = [];
  private dataPath: string;

  constructor(dataPath = path.join(process.cwd(), 'data', 'calibration.json')) {
    this.dataPath = dataPath;
    this.categoryBuckets = {
      sports: this.initBuckets(),
      politics: this.initBuckets(),
      crypto: this.initBuckets(),
      general: this.initBuckets(),
    };
    this.load();
  }

  recordOutcome(estimatedProb: number, won: boolean, question?: string): void {
    const category = question ? this.detectCategory(question) : 'general';
    const bucket = this.getBucket(this.categoryBuckets[category], estimatedProb);
    if (!bucket) return;

    const outcome: TimedOutcome = { won, timestamp: Date.now(), estimatedProb };
    bucket.n++;
    if (won) bucket.wins++;
    bucket.outcomes.push(outcome);
    if (bucket.outcomes.length > MAX_OUTCOMES_PER_BUCKET) {
      bucket.outcomes = bucket.outcomes.slice(-MAX_OUTCOMES_PER_BUCKET);
    }

    this.recentPredictions.push(outcome);
    if (this.recentPredictions.length > ROLLING_WINDOW) {
      this.recentPredictions = this.recentPredictions.slice(-ROLLING_WINDOW);
    }

    this.save();
    logger.debug('Calibrator',
      `[${category}] est=${(estimatedProb * 100).toFixed(0)}% → ${won ? 'WIN' : 'LOSS'} ` +
      `| bucket ${(bucket.low * 100).toFixed(0)}-${(bucket.high * 100).toFixed(0)}%: ${bucket.wins}/${bucket.n}`
    );
  }

  getCalibrationAdjustment(estimatedProb: number, question?: string): CalibrationAdjustment | null {
    const category = question ? this.detectCategory(question) : 'general';
    const bucket = this.getBucket(this.categoryBuckets[category], estimatedProb);

    // Fall back to 'general' bucket if category has fewer than MIN_SAMPLES
    const effectiveBucket = (bucket && bucket.n >= MIN_SAMPLES)
      ? bucket
      : this.getBucket(this.categoryBuckets.general, estimatedProb);

    if (!effectiveBucket || effectiveBucket.n < MIN_SAMPLES) return null;

    const { weightedWinRate, totalWeight } = this.timeWeightedRate(effectiveBucket);
    if (totalWeight < 1) return null;

    const expectedRate = (effectiveBucket.low + effectiveBucket.high) / 2;
    const adjustment = weightedWinRate - expectedRate;
    const confidence = Math.min(0.8, effectiveBucket.n / 50);

    return { adjustment, confidence, sampleSize: effectiveBucket.n, category };
  }

  getCalibrationReport(): CalibrationReport {
    const merged = this.mergeBuckets();
    const totalPredictions = merged.reduce((s, b) => s + b.n, 0);

    let brierSum = 0;
    let brierN = 0;
    for (const b of merged) {
      if (b.n > 0) {
        const { weightedWinRate } = this.timeWeightedRate(b);
        brierSum += b.n * Math.pow((b.low + b.high) / 2 - weightedWinRate, 2);
        brierN += b.n;
      }
    }

    const byCategory = {} as Record<MarketCategory, { n: number; brier: number }>;
    for (const cat of CATEGORIES) {
      const buckets = this.categoryBuckets[cat];
      const n = buckets.reduce((s, b) => s + b.n, 0);
      let catBrier = 0, catN = 0;
      for (const b of buckets) {
        if (b.n > 0) {
          const { weightedWinRate } = this.timeWeightedRate(b);
          catBrier += b.n * Math.pow((b.low + b.high) / 2 - weightedWinRate, 2);
          catN += b.n;
        }
      }
      byCategory[cat] = { n, brier: catN > 0 ? catBrier / catN : 0 };
    }

    return {
      totalPredictions,
      overallBrier: brierN > 0 ? brierSum / brierN : 0,
      rollingBrier50: this.computeRollingBrier(),
      byCategory,
      buckets: merged.map(b => {
        const { weightedWinRate } = this.timeWeightedRate(b);
        return {
          range: `${(b.low * 100).toFixed(0)}-${(b.high * 100).toFixed(0)}%`,
          n: b.n,
          expectedRate: (b.low + b.high) / 2,
          actualRate: b.n > 0 ? weightedWinRate : 0,
          bias: b.n > 0 ? weightedWinRate - (b.low + b.high) / 2 : 0,
        };
      }),
    };
  }

  detectCategory(question: string): MarketCategory {
    const q = question.toLowerCase();
    if (/\b(nba|nfl|nhl|mlb|ufc|mls|premier|champions league|world cup|super bowl|championship|tournament|score|vs\.? |standings|playoffs|game \d|season|basketball|football|soccer|tennis|golf)\b/.test(q)) return 'sports';
    if (/\b(bitcoin|btc|ethereum|eth|crypto|blockchain|defi|token|nft|solana|polygon|binance|coinbase|altcoin|web3|dao)\b/.test(q)) return 'crypto';
    if (/\b(election|president|senate|congress|republican|democrat|vote|legislation|governor|trump|biden|harris|poll|ballot|referendum|party)\b/.test(q)) return 'politics';
    return 'general';
  }

  private timeWeightedRate(bucket: CalibrationBucket): { weightedWinRate: number; totalWeight: number } {
    if (bucket.outcomes.length === 0) {
      if (bucket.n === 0) return { weightedWinRate: 0, totalWeight: 0 };
      return { weightedWinRate: bucket.wins / bucket.n, totalWeight: bucket.n };
    }
    let weightedWins = 0, totalWeight = 0;
    for (const o of bucket.outcomes) {
      const w = Math.pow(0.5, (Date.now() - o.timestamp) / HALF_LIFE_MS);
      if (o.won) weightedWins += w;
      totalWeight += w;
    }
    return { weightedWinRate: totalWeight > 0 ? weightedWins / totalWeight : 0, totalWeight };
  }

  private computeRollingBrier(): number {
    if (this.recentPredictions.length === 0) return 0;
    const sum = this.recentPredictions.reduce(
      (s, p) => s + Math.pow(p.estimatedProb - (p.won ? 1 : 0), 2), 0
    );
    return sum / this.recentPredictions.length;
  }

  private mergeBuckets(): CalibrationBucket[] {
    return Array.from({ length: 10 }, (_, i) => {
      const low = i * BUCKET_SIZE;
      const high = (i + 1) * BUCKET_SIZE;
      const merged: CalibrationBucket = { low, high, n: 0, wins: 0, outcomes: [] };
      for (const cat of CATEGORIES) {
        const b = this.categoryBuckets[cat][i];
        merged.n += b.n;
        merged.wins += b.wins;
        merged.outcomes.push(...b.outcomes);
      }
      return merged;
    });
  }

  private getBucket(buckets: CalibrationBucket[], prob: number): CalibrationBucket | null {
    const p = Math.max(0, Math.min(0.999, prob));
    return buckets.find(b => p >= b.low && p < b.high) || null;
  }

  private initBuckets(): CalibrationBucket[] {
    return Array.from({ length: 10 }, (_, i) => ({
      low: i * BUCKET_SIZE,
      high: (i + 1) * BUCKET_SIZE,
      n: 0,
      wins: 0,
      outcomes: [],
    }));
  }

  exportData(): object {
    return {
      categoryBuckets: this.categoryBuckets,
      recentPredictions: this.recentPredictions,
    };
  }

  importData(data: unknown): void {
    try {
      const raw = data as Record<string, unknown>;
      if (!raw || typeof raw !== 'object') throw new Error('Invalid format');
      if (raw.categoryBuckets) {
        for (const cat of CATEGORIES) {
          const buckets = (raw.categoryBuckets as Record<string, CalibrationBucket[]>)[cat];
          if (Array.isArray(buckets) && buckets.length === 10) {
            this.categoryBuckets[cat] = buckets.map(b => ({ ...b, outcomes: b.outcomes || [] }));
          }
        }
      }
      if (Array.isArray(raw.recentPredictions)) {
        this.recentPredictions = raw.recentPredictions as TimedOutcome[];
      }
      this.save();
      const total = CATEGORIES.reduce((s, c) => s + this.categoryBuckets[c].reduce((ss, b) => ss + b.n, 0), 0);
      logger.info('Calibrator', `✅ Import: ${total} predições carregadas`);
    } catch (err) {
      throw new Error(`Calibration import failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.dataPath, JSON.stringify({
        categoryBuckets: this.categoryBuckets,
        recentPredictions: this.recentPredictions,
      }, null, 2));
    } catch (err) {
      logger.warn('Calibrator', `Save failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.dataPath)) return;
      const raw = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));
      // Migrate old format (plain array) → general category
      if (Array.isArray(raw) && raw.length === 10) {
        this.categoryBuckets.general = raw.map(b => ({ ...b, outcomes: b.outcomes || [] }));
        const total = raw.reduce((s: number, b: CalibrationBucket) => s + b.n, 0);
        if (total > 0) logger.debug('Calibrator', `Migrated ${total} predictions to 'general' category`);
      } else if (raw.categoryBuckets) {
        for (const cat of CATEGORIES) {
          if (raw.categoryBuckets[cat]) {
            this.categoryBuckets[cat] = raw.categoryBuckets[cat].map((b: CalibrationBucket) => ({
              ...b, outcomes: b.outcomes || [],
            }));
          }
        }
        this.recentPredictions = raw.recentPredictions || [];
        const total = CATEGORIES.reduce((s, c) =>
          s + this.categoryBuckets[c].reduce((ss, b) => ss + b.n, 0), 0);
        if (total > 0) logger.debug('Calibrator', `Loaded ${total} predictions`);
      }
    } catch (err) {
      logger.warn('Calibrator', `Load failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
