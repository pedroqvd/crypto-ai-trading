// ================================================
// TESTS: EdgeCalculator
// ================================================

jest.mock('../src/engine/Config', () => ({
  config: {
    minEdge: 0.03,
    logLevel: 'warn',
  },
}));

import { EdgeCalculator, EdgeAnalysis } from '../src/analysis/EdgeCalculator';

const TAKER_FEE = 0.02;

describe('EdgeCalculator', () => {
  let calc: EdgeCalculator;

  beforeEach(() => {
    calc = new EdgeCalculator();
  });

  // ----------------------------------------
  // Edge identification
  // ----------------------------------------
  describe('edge identification', () => {
    it('identifies BUY_YES when estimated prob > market price by enough', () => {
      // Market says 40%, we estimate 55% → edge on YES
      const result = calc.calculateEdge('m1', 'Will X happen?', 0.40, 0.55, 0.8);
      expect(result.side).toBe('BUY_YES');
      expect(result.edge).toBeCloseTo(0.15, 4);
    });

    it('identifies BUY_NO when estimated prob < market price by enough', () => {
      // Market says 70%, we estimate 50% → edge on NO
      const result = calc.calculateEdge('m1', 'Will X happen?', 0.70, 0.50, 0.8);
      expect(result.side).toBe('BUY_NO');
    });

    it('returns NO_TRADE when edge is below minEdge (3%)', () => {
      // Market 50%, estimate 51.5% → edge only 1.5%, below 3% threshold
      const result = calc.calculateEdge('m1', 'Will X happen?', 0.50, 0.515, 0.8);
      expect(result.side).toBe('NO_TRADE');
    });

    it('returns NO_TRADE when both edges are below minEdge (symmetric near-50 market)', () => {
      // Market 50%, estimate 52% — yes edge=2%, no edge=-2%, both below 3% threshold
      const result = calc.calculateEdge('m1', 'Will X happen?', 0.50, 0.52, 0.8);
      expect(result.side).toBe('NO_TRADE');
    });
  });

  // ----------------------------------------
  // EV formula correctness
  // EV_yes = P_true × (1/q - 1) × (1 - fee) - (1 - P_true)
  // ----------------------------------------
  describe('EV formula', () => {
    it('calculates positive EV for clear YES mispricing', () => {
      // p=0.6, q=0.4 → EV_yes = 0.6*(1/0.4-1)*(0.98) - 0.4
      const pTrue = 0.6;
      const qYes = 0.4;
      const expectedEV = pTrue * ((1 / qYes) - 1) * (1 - TAKER_FEE) - (1 - pTrue);
      const result = calc.calculateEdge('m1', 'Test', qYes, pTrue, 0.8);
      expect(result.ev).toBeCloseTo(expectedEV, 4);
    });

    it('calculates positive EV for clear NO mispricing', () => {
      // Market YES=0.7, pTrue=0.5 → buy NO at 0.3
      const pTrue = 0.5;
      const qYes = 0.7;
      const qNo = 1 - qYes;
      const expectedEV = (1 - pTrue) * ((1 / qNo) - 1) * (1 - TAKER_FEE) - pTrue;
      const result = calc.calculateEdge('m1', 'Test', qYes, pTrue, 0.8);
      expect(result.ev).toBeCloseTo(expectedEV, 4);
    });

    it('evPercent equals ev * 100', () => {
      const result = calc.calculateEdge('m1', 'Test', 0.4, 0.6, 0.8);
      expect(result.evPercent).toBeCloseTo(result.ev * 100, 4);
    });

    it('edgePercent equals edge * 100', () => {
      const result = calc.calculateEdge('m1', 'Test', 0.4, 0.6, 0.8);
      expect(result.edgePercent).toBeCloseTo(result.edge * 100, 4);
    });
  });

  // ----------------------------------------
  // Confidence adjustment
  // ----------------------------------------
  describe('confidence adjustment', () => {
    it('reduces confidence when edge is marginal (near minEdge)', () => {
      const marginalResult = calc.calculateEdge('m1', 'Test', 0.40, 0.43, 0.9); // 3% edge exactly
      const strongResult = calc.calculateEdge('m1', 'Test', 0.40, 0.60, 0.9);   // 20% edge
      // Marginal edge should reduce confidence below original
      expect(marginalResult.confidence).toBeLessThan(strongResult.confidence);
    });
  });

  // ----------------------------------------
  // Market data passthrough
  // ----------------------------------------
  describe('market data passthrough', () => {
    it('preserves liquidity in result', () => {
      const result = calc.calculateEdge('m1', 'Test', 0.4, 0.6, 0.8, 25000, 'tok1', 'tok2', false);
      expect(result.liquidity).toBe(25000);
    });

    it('preserves yesTokenId and noTokenId', () => {
      const result = calc.calculateEdge('m1', 'Test', 0.4, 0.6, 0.8, 10000, 'yes-token', 'no-token', true);
      expect(result.yesTokenId).toBe('yes-token');
      expect(result.noTokenId).toBe('no-token');
      expect(result.negRisk).toBe(true);
    });

    it('defaults liquidity to 0 and tokens to empty when not provided', () => {
      const result = calc.calculateEdge('m1', 'Test', 0.4, 0.6, 0.8);
      expect(result.liquidity).toBe(0);
      expect(result.yesTokenId).toBe('');
      expect(result.noTokenId).toBe('');
      expect(result.negRisk).toBe(false);
    });
  });

  // ----------------------------------------
  // recommendedPrice
  // ----------------------------------------
  describe('recommendedPrice', () => {
    it('sets recommendedPrice to yesPrice for BUY_YES', () => {
      const result = calc.calculateEdge('m1', 'Test', 0.40, 0.60, 0.8);
      expect(result.side).toBe('BUY_YES');
      expect(result.recommendedPrice).toBeCloseTo(0.40, 4);
    });

    it('sets recommendedPrice to noPrice for BUY_NO', () => {
      // Market YES=0.70, noPrice=0.30
      const result = calc.calculateEdge('m1', 'Test', 0.70, 0.50, 0.8);
      expect(result.side).toBe('BUY_NO');
      expect(result.recommendedPrice).toBeCloseTo(0.30, 4);
    });

    it('sets recommendedPrice to 0 for NO_TRADE', () => {
      const result = calc.calculateEdge('m1', 'Test', 0.50, 0.515, 0.8);
      expect(result.side).toBe('NO_TRADE');
      expect(result.recommendedPrice).toBe(0);
    });
  });

  // ----------------------------------------
  // filterTradeableOpportunities
  // ----------------------------------------
  describe('filterTradeableOpportunities', () => {
    it('filters out NO_TRADE entries', () => {
      const analyses: EdgeAnalysis[] = [
        calc.calculateEdge('m1', 'Q1', 0.40, 0.60, 0.8),  // BUY_YES
        calc.calculateEdge('m2', 'Q2', 0.50, 0.515, 0.8), // NO_TRADE
        calc.calculateEdge('m3', 'Q3', 0.70, 0.50, 0.8),  // BUY_NO
      ];
      const tradeable = calc.filterTradeableOpportunities(analyses);
      expect(tradeable.every(a => a.side !== 'NO_TRADE')).toBe(true);
    });

    it('sorts by EV descending (best opportunity first)', () => {
      const analyses: EdgeAnalysis[] = [
        calc.calculateEdge('m1', 'Q1', 0.40, 0.55, 0.8),  // smaller edge
        calc.calculateEdge('m2', 'Q2', 0.30, 0.70, 0.8),  // larger edge
      ];
      const tradeable = calc.filterTradeableOpportunities(analyses);
      if (tradeable.length >= 2) {
        expect(tradeable[0].ev).toBeGreaterThanOrEqual(tradeable[1].ev);
      }
    });

    it('filters out low confidence entries (< 0.3)', () => {
      const lowConf = calc.calculateEdge('m1', 'Q1', 0.40, 0.60, 0.1);
      const tradeable = calc.filterTradeableOpportunities([lowConf]);
      expect(tradeable).toHaveLength(0);
    });

    it('returns empty array when all are NO_TRADE', () => {
      const analyses = [
        calc.calculateEdge('m1', 'Q1', 0.50, 0.51, 0.8),
        calc.calculateEdge('m2', 'Q2', 0.50, 0.52, 0.8),
      ];
      const tradeable = calc.filterTradeableOpportunities(analyses);
      expect(tradeable).toHaveLength(0);
    });
  });

  // ----------------------------------------
  // Edge cases / boundary values
  // ----------------------------------------
  describe('boundary values', () => {
    it('clamps yesPrice to [0.01, 0.99]', () => {
      const result = calc.calculateEdge('m1', 'Test', 0, 0.5, 0.8);
      expect(result.marketPrice).toBeGreaterThanOrEqual(0.01);
    });

    it('clamps estimatedTrueProb to [0.01, 0.99]', () => {
      const result = calc.calculateEdge('m1', 'Test', 0.5, 1.5, 0.8);
      expect(result.estimatedTrueProb).toBeLessThanOrEqual(0.99);
    });

    it('includes all required fields in result', () => {
      const result = calc.calculateEdge('m1', 'Test', 0.4, 0.6, 0.8, 5000, 'tok1', 'tok2', false);
      expect(result).toMatchObject({
        marketId: 'm1',
        question: 'Test',
        liquidity: 5000,
        yesTokenId: 'tok1',
        noTokenId: 'tok2',
        negRisk: false,
      });
    });
  });
});
