// ================================================
// TESTS: KellyCalculator
// ================================================

jest.mock('../src/engine/Config', () => ({
  config: {
    kellyFraction: 0.25,
    maxPositionPct: 0.05,
    logLevel: 'warn',
  },
}));

import { KellyCalculator } from '../src/analysis/KellyCalculator';

describe('KellyCalculator', () => {
  let calc: KellyCalculator;

  beforeEach(() => {
    calc = new KellyCalculator();
  });

  // ----------------------------------------
  // Kelly formula: f* = (p - q) / (1 - q)
  // ----------------------------------------
  describe('Kelly formula', () => {
    it('calculates correct full Kelly fraction', () => {
      // p=0.6, q=0.5 → f* = (0.6-0.5)/(1-0.5) = 0.2
      const result = calc.calculate(0.6, 0.5, 1000, 100000);
      expect(result.fullKellyFraction).toBeCloseTo(0.2, 4);
    });

    it('calculates correct fractional Kelly (quarter-Kelly)', () => {
      // f* = 0.2, fractional = 0.2 * 0.25 = 0.05
      const result = calc.calculate(0.6, 0.5, 1000, 100000);
      expect(result.fractionalKelly).toBeCloseTo(0.05, 4);
    });

    it('calculates correct recommended stake', () => {
      // fractional=0.05, bankroll=1000 → recommended=$50
      const result = calc.calculate(0.6, 0.5, 1000, 100000);
      expect(result.recommendedStake).toBeCloseTo(50, 1);
    });

    it('handles zero Kelly when p <= q', () => {
      const result = calc.calculate(0.5, 0.6, 1000, 100000);
      expect(result.fullKellyFraction).toBeLessThanOrEqual(0);
      expect(result.finalStake).toBe(0);
    });

    it('handles exactly zero edge (p === q)', () => {
      const result = calc.calculate(0.5, 0.5, 1000, 100000);
      expect(result.finalStake).toBe(0);
    });

    it('clamps extreme inputs (pTrue > 0.99)', () => {
      const result = calc.calculate(1.5, 0.5, 1000, 100000);
      // Should not crash or produce infinity
      expect(Number.isFinite(result.finalStake)).toBe(true);
      expect(result.finalStake).toBeGreaterThan(0);
    });

    it('clamps extreme inputs (pImplied < 0.01)', () => {
      const result = calc.calculate(0.5, 0.001, 1000, 100000);
      expect(Number.isFinite(result.finalStake)).toBe(true);
    });
  });

  // ----------------------------------------
  // Position size caps
  // ----------------------------------------
  describe('position size caps', () => {
    it('caps stake at maxPositionPct of bankroll (5%)', () => {
      // Big edge: f* would be huge, but cap is 5% of $10000 = $500
      const result = calc.calculate(0.99, 0.5, 10000, 1_000_000);
      expect(result.finalStake).toBeLessThanOrEqual(10000 * 0.05 + 0.01);
    });

    it('caps stake at 10% of market liquidity', () => {
      // Liquidity=$500 → max by liquidity = $50
      const result = calc.calculate(0.7, 0.5, 10000, 500);
      expect(result.finalStake).toBeLessThanOrEqual(500 * 0.10 + 0.01);
    });

    it('uses the smaller of position cap and liquidity cap', () => {
      // maxByPosition=10000*0.05=500, maxByLiquidity=100*0.10=10
      const result = calc.calculate(0.7, 0.5, 10000, 100);
      expect(result.finalStake).toBeLessThanOrEqual(10 + 1); // liquidity cap wins
    });

    it('never bets more than 50% of bankroll', () => {
      const result = calc.calculate(0.99, 0.01, 1000, 1_000_000);
      expect(result.finalStake).toBeLessThanOrEqual(500);
    });

    it('enforces minimum bet of $1 when bankroll allows', () => {
      // bankroll=$20, maxByPosition=20*0.05=$1, so cap=$1
      // tiny edge → recommended is tiny, max(tiny, 1) = $1, 1 <= 20*0.5=$10 ✓
      const result = calc.calculate(0.501, 0.5, 20, 1_000_000);
      expect(result.finalStake).toBeGreaterThanOrEqual(1);
    });

    it('50% bankroll cap takes precedence over MIN_BET_SIZE on tiny bankroll', () => {
      // bankroll=$1 → 50% = $0.50, MIN_BET_SIZE=$1 would exceed 50% cap → capped at $0.50
      const result = calc.calculate(0.501, 0.5, 1, 1_000_000);
      expect(result.finalStake).toBe(0.5);
    });
  });

  // ----------------------------------------
  // Return structure
  // ----------------------------------------
  describe('result structure', () => {
    it('returns all required fields', () => {
      const result = calc.calculate(0.6, 0.5, 1000, 50000);
      expect(result).toHaveProperty('fullKellyFraction');
      expect(result).toHaveProperty('fractionalKelly');
      expect(result).toHaveProperty('recommendedStake');
      expect(result).toHaveProperty('maxStake');
      expect(result).toHaveProperty('finalStake');
      expect(result).toHaveProperty('justification');
    });

    it('justification is a non-empty string', () => {
      const result = calc.calculate(0.6, 0.5, 1000, 50000);
      expect(typeof result.justification).toBe('string');
      expect(result.justification.length).toBeGreaterThan(0);
    });

    it('finalStake <= recommendedStake when under cap', () => {
      // Small edge, large bankroll/liquidity — cap shouldn't bite
      const result = calc.calculate(0.55, 0.5, 100, 1_000_000);
      // finalStake could be min bet, but never greater than recommended (unless min bet)
      expect(result.finalStake).toBeLessThanOrEqual(
        Math.max(result.recommendedStake, 1)
      );
    });
  });
});
