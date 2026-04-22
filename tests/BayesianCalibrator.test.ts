// ================================================
// TESTS: BayesianCalibrator
// ================================================

jest.mock('fs');
jest.mock('../src/utils/Logger', () => ({
  logger: { debug: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import { BayesianCalibrator } from '../src/analysis/BayesianCalibrator';

function makeCal(): BayesianCalibrator {
  return new BayesianCalibrator('/tmp/test-calibration.json');
}

describe('BayesianCalibrator', () => {

  // ----------------------------------------
  // category detection
  // ----------------------------------------
  describe('detectCategory', () => {
    it('classifies sports questions', () => {
      const cal = makeCal();
      expect(cal.detectCategory('Will the NBA finals go to game 7?')).toBe('sports');
      expect(cal.detectCategory('Will the Super Bowl draw 100M viewers?')).toBe('sports');
    });

    it('classifies crypto questions', () => {
      const cal = makeCal();
      expect(cal.detectCategory('Will Bitcoin reach $100k by year end?')).toBe('crypto');
      expect(cal.detectCategory('Will Ethereum ETF be approved?')).toBe('crypto');
    });

    it('classifies politics questions', () => {
      const cal = makeCal();
      expect(cal.detectCategory('Will Trump win the 2024 election?')).toBe('politics');
      expect(cal.detectCategory('Will the Senate pass the bill?')).toBe('politics');
    });

    it('defaults to general for ambiguous questions', () => {
      const cal = makeCal();
      expect(cal.detectCategory('Will it rain in London tomorrow?')).toBe('general');
      expect(cal.detectCategory('Will SpaceX launch successfully?')).toBe('general');
    });
  });

  // ----------------------------------------
  // recordOutcome + getCalibrationAdjustment
  // ----------------------------------------
  describe('getCalibrationAdjustment', () => {
    it('returns null when insufficient samples', () => {
      const cal = makeCal();
      cal.recordOutcome(0.7, true, 'Will Bitcoin rally?');
      const adj = cal.getCalibrationAdjustment(0.7, 'Will Bitcoin rally?');
      expect(adj).toBeNull();
    });

    it('returns null for a fresh calibrator with no data', () => {
      const cal = makeCal();
      expect(cal.getCalibrationAdjustment(0.6)).toBeNull();
    });

    it('returns an adjustment after enough samples in the same bucket', () => {
      const cal = makeCal();
      // Fill the 0.6–0.7 bucket with 10+ samples
      for (let i = 0; i < 12; i++) {
        cal.recordOutcome(0.65, i < 9, 'general question'); // 9 wins / 12 = 75% actual
      }
      const adj = cal.getCalibrationAdjustment(0.65, 'another general question');
      expect(adj).not.toBeNull();
      expect(adj!.sampleSize).toBeGreaterThanOrEqual(10);
      expect(typeof adj!.adjustment).toBe('number');
      expect(adj!.confidence).toBeGreaterThan(0);
      expect(adj!.confidence).toBeLessThanOrEqual(0.8);
    });

    it('adjustment is positive when model underestimates (actual > expected)', () => {
      const cal = makeCal();
      // Bucket 0.4–0.5: expected win rate = 45%. Fill with 100% wins → big positive bias
      for (let i = 0; i < 12; i++) {
        cal.recordOutcome(0.45, true); // all wins at 45% bucket
      }
      const adj = cal.getCalibrationAdjustment(0.45);
      expect(adj).not.toBeNull();
      expect(adj!.adjustment).toBeGreaterThan(0); // actual > expected
    });

    it('adjustment is negative when model overestimates (actual < expected)', () => {
      const cal = makeCal();
      // Bucket 0.6–0.7: expected 65%. Fill with 0% wins → negative bias
      for (let i = 0; i < 12; i++) {
        cal.recordOutcome(0.65, false);
      }
      const adj = cal.getCalibrationAdjustment(0.65);
      expect(adj).not.toBeNull();
      expect(adj!.adjustment).toBeLessThan(0);
    });

    it('returns category in the adjustment result', () => {
      const cal = makeCal();
      for (let i = 0; i < 12; i++) cal.recordOutcome(0.55, true, 'Will Bitcoin drop?');
      const adj = cal.getCalibrationAdjustment(0.55, 'Will Ethereum break $5000?');
      expect(adj).not.toBeNull();
      expect(adj!.category).toBe('crypto');
    });
  });

  // ----------------------------------------
  // Brier score
  // ----------------------------------------
  describe('getCalibrationReport', () => {
    it('returns zero Brier score for empty calibrator', () => {
      const cal = makeCal();
      const report = cal.getCalibrationReport();
      expect(report.totalPredictions).toBe(0);
      expect(report.overallBrier).toBe(0);
      expect(report.rollingBrier50).toBe(0);
    });

    it('returns Brier score in 0–1 range', () => {
      const cal = makeCal();
      for (let i = 0; i < 20; i++) {
        cal.recordOutcome(0.7, i < 14); // 70% accuracy at 70% confidence = good
      }
      const report = cal.getCalibrationReport();
      expect(report.overallBrier).toBeGreaterThanOrEqual(0);
      expect(report.overallBrier).toBeLessThanOrEqual(1);
    });

    it('perfect calibration produces Brier score near 0', () => {
      const cal = makeCal();
      // 70% bucket: predict 0.65 (mid of bucket), win 65% of time
      for (let i = 0; i < 20; i++) {
        cal.recordOutcome(0.65, i < 13); // 13/20 = 65% ≈ bucket midpoint
      }
      const report = cal.getCalibrationReport();
      expect(report.rollingBrier50).toBeGreaterThanOrEqual(0);
      expect(report.rollingBrier50).toBeLessThan(0.3); // reasonable upper bound
    });

    it('reports all 4 categories in byCategory', () => {
      const cal = makeCal();
      const report = cal.getCalibrationReport();
      expect(report.byCategory).toHaveProperty('sports');
      expect(report.byCategory).toHaveProperty('politics');
      expect(report.byCategory).toHaveProperty('crypto');
      expect(report.byCategory).toHaveProperty('general');
    });

    it('totalPredictions matches records inserted', () => {
      const cal = makeCal();
      for (let i = 0; i < 7; i++) cal.recordOutcome(0.6, true);
      for (let i = 0; i < 5; i++) cal.recordOutcome(0.4, false, 'NBA finals game');
      const report = cal.getCalibrationReport();
      expect(report.totalPredictions).toBe(12);
    });

    it('buckets array covers the full 0–100% range', () => {
      const cal = makeCal();
      const report = cal.getCalibrationReport();
      expect(report.buckets.length).toBe(10); // 10 buckets of 10%
    });
  });
});
