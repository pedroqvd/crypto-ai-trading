// ================================================
// BAYESIAN CALIBRATOR — Self-learning accuracy tracker
// Records resolved trade outcomes and computes per-bucket
// calibration error so future estimates can be corrected.
// ================================================

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/Logger';

interface CalibrationBucket {
  low: number;
  high: number;
  n: number;
  wins: number;
}

export interface CalibrationAdjustment {
  adjustment: number;
  confidence: number;
  sampleSize: number;
}

export interface CalibrationReport {
  totalPredictions: number;
  overallBrier: number;
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

export class BayesianCalibrator {
  private buckets: CalibrationBucket[];
  private dataPath: string;

  constructor(dataPath = path.join(process.cwd(), 'data', 'calibration.json')) {
    this.dataPath = dataPath;
    this.buckets = this.initBuckets();
    this.load();
  }

  /**
   * Record the outcome of a resolved trade.
   * @param estimatedProb - The probability we estimated for the side we bet on
   * @param won - Whether the bet resolved in our favour
   */
  recordOutcome(estimatedProb: number, won: boolean): void {
    const bucket = this.getBucket(estimatedProb);
    if (!bucket) return;

    bucket.n++;
    if (won) bucket.wins++;
    this.save();

    logger.debug('Calibrator',
      `Recorded est=${(estimatedProb * 100).toFixed(0)}% → ${won ? 'WIN' : 'LOSS'} ` +
      `| bucket ${(bucket.low * 100).toFixed(0)}-${(bucket.high * 100).toFixed(0)}%: ` +
      `${bucket.wins}/${bucket.n} actual`
    );
  }

  /**
   * Get calibration correction for a given estimated probability.
   * Returns null when fewer than MIN_SAMPLES exist in the bucket.
   *
   * adjustment > 0  → we've been underestimating (actual wins > expected)
   * adjustment < 0  → we've been overestimating (actual wins < expected)
   */
  getCalibrationAdjustment(estimatedProb: number): CalibrationAdjustment | null {
    const bucket = this.getBucket(estimatedProb);
    if (!bucket || bucket.n < MIN_SAMPLES) return null;

    const actualRate = bucket.wins / bucket.n;
    const expectedRate = (bucket.low + bucket.high) / 2;
    const adjustment = actualRate - expectedRate;

    // Confidence grows with samples but never exceeds 0.8
    const confidence = Math.min(0.8, bucket.n / 50);

    return { adjustment, confidence, sampleSize: bucket.n };
  }

  getCalibrationReport(): CalibrationReport {
    const totalPredictions = this.buckets.reduce((s, b) => s + b.n, 0);

    let brierSum = 0;
    let brierN = 0;
    for (const b of this.buckets) {
      if (b.n > 0) {
        const mid = (b.low + b.high) / 2;
        brierSum += b.n * Math.pow(mid - b.wins / b.n, 2);
        brierN += b.n;
      }
    }

    return {
      totalPredictions,
      overallBrier: brierN > 0 ? brierSum / brierN : 0,
      buckets: this.buckets.map(b => ({
        range: `${(b.low * 100).toFixed(0)}-${(b.high * 100).toFixed(0)}%`,
        n: b.n,
        expectedRate: (b.low + b.high) / 2,
        actualRate: b.n > 0 ? b.wins / b.n : 0,
        bias: b.n > 0 ? b.wins / b.n - (b.low + b.high) / 2 : 0,
      })),
    };
  }

  private getBucket(prob: number): CalibrationBucket | null {
    const p = Math.max(0, Math.min(0.999, prob));
    return this.buckets.find(b => p >= b.low && p < b.high) || null;
  }

  private initBuckets(): CalibrationBucket[] {
    return Array.from({ length: 10 }, (_, i) => ({
      low: i * BUCKET_SIZE,
      high: (i + 1) * BUCKET_SIZE,
      n: 0,
      wins: 0,
    }));
  }

  private save(): void {
    try {
      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.dataPath, JSON.stringify(this.buckets, null, 2));
    } catch (err) {
      logger.warn('Calibrator', `Save failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.dataPath)) return;
      const raw = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));
      if (Array.isArray(raw) && raw.length === 10) {
        this.buckets = raw;
        const total = this.buckets.reduce((s, b) => s + b.n, 0);
        if (total > 0) logger.debug('Calibrator', `Loaded ${total} historical predictions`);
      }
    } catch (err) {
      logger.warn('Calibrator', `Load failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
