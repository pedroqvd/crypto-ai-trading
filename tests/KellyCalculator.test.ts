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
  // Kelly formula with taker fee (2%)
  // ----------------------------------------
  describe('Kelly formula', () => {
    it('calculates correct full Kelly fraction', () => {
      // p=0.6, q=0.5 → bNet = 1.0 * 0.98 = 0.98 → f* = (0.98*0.6 - 0.4) / 0.98 ≈ 0.1918
      const result = calc.calculate(0.6, 0.5, 1000, 100000);
      expect(result.fullKellyFraction).toBeCloseTo(0.1918, 3);
    });

    it('calculates correct fractional Kelly (quarter-Kelly)', () => {
      // f* ≈ 0.1918, fractional = 0.1918 * 0.25 ≈ 0.0479
      const result = calc.calculate(0.6, 0.5, 1000, 100000);
      expect(result.fractionalKelly).toBeCloseTo(0.0480, 3);
    });

    it('calculates correct recommended stake', () => {
      // fractional ≈ 0.0479, bankroll=1000 → recommended ≈ $48
      const result = calc.calculate(0.6, 0.5, 1000, 100000);
      expect(result.recommendedStake).toBeCloseTo(48, 0);
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

    it('never bets more than maxPositionPct of bankroll', () => {
      // p=0.99, q=0.01 has huge edge → but capped at maxPositionPct (5%)
      const result = calc.calculate(0.99, 0.01, 1000, 1_000_000);
      expect(result.finalStake).toBeLessThanOrEqual(50); // 5% of $1000
    });

    it('returns 0 finalStake when Kelly recommendation is below MIN_BET_SIZE', () => {
      // p=0.51, q=0.5 → tiny edge, recommended < $1 → finalStake = 0
      const result = calc.calculate(0.51, 0.5, 20, 1_000_000);
      expect(result.finalStake).toBe(0);
      expect(result.justification).toMatch(/mínimo/);
    });

    it('applies liquidity cap to position size', () => {
      // p=0.7, q=0.3 → good edge, but liquidity cap = 10% of $500 = $50
      const result = calc.calculate(0.7, 0.3, 1000, 500);
      expect(result.finalStake).toBeLessThanOrEqual(50);
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
