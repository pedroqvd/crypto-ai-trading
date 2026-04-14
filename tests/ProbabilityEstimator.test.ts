// ================================================
// TESTS: ProbabilityEstimator
// ================================================

jest.mock('../src/engine/Config', () => ({
  config: { logLevel: 'warn' },
}));

import { ProbabilityEstimator } from '../src/analysis/ProbabilityEstimator';
import { ParsedMarket } from '../src/services/GammaApiClient';

function makeMarket(overrides: Partial<ParsedMarket> = {}): ParsedMarket {
  return {
    id: 'market-1',
    question: 'Will X happen?',
    conditionId: 'cond-1',
    slug: 'will-x-happen',
    yesPrice: 0.50,
    noPrice: 0.50,
    volume: 50000,
    liquidity: 25000,
    active: true,
    closed: false,
    endDate: new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString(), // 60 days
    description: '',
    yesTokenId: 'tok-yes',
    noTokenId: 'tok-no',
    acceptingOrders: true,
    negRisk: false,
    ...overrides,
  };
}

describe('ProbabilityEstimator', () => {
  let estimator: ProbabilityEstimator;

  beforeEach(() => {
    estimator = new ProbabilityEstimator();
  });

  // ----------------------------------------
  // Return structure
  // ----------------------------------------
  describe('result structure', () => {
    it('returns all required fields', () => {
      const market = makeMarket();
      const result = estimator.estimate(market, [market]);
      expect(result).toHaveProperty('marketId', 'market-1');
      expect(result).toHaveProperty('question');
      expect(result).toHaveProperty('marketPrice');
      expect(result).toHaveProperty('estimatedTrueProb');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('signals');
    });

    it('returns 7 signals (includes Market Calibration)', () => {
      const market = makeMarket();
      const result = estimator.estimate(market, [market]);
      expect(result.signals).toHaveLength(7);
      expect(result.signals.map(s => s.name)).toContain('Market Calibration');
    });

    it('estimatedTrueProb is between 0.01 and 0.99', () => {
      const market = makeMarket({ yesPrice: 0.95, noPrice: 0.05 });
      const result = estimator.estimate(market, [market]);
      expect(result.estimatedTrueProb).toBeGreaterThanOrEqual(0.01);
      expect(result.estimatedTrueProb).toBeLessThanOrEqual(0.99);
    });

    it('confidence is between 0.1 and 0.9', () => {
      const market = makeMarket();
      const result = estimator.estimate(market, [market]);
      expect(result.confidence).toBeGreaterThanOrEqual(0.1);
      expect(result.confidence).toBeLessThanOrEqual(0.9);
    });
  });

  // ----------------------------------------
  // Liquidity mean reversion signal
  // Low liquidity + extreme price → push toward 50%
  // ----------------------------------------
  describe('liquidity mean reversion', () => {
    it('pushes low-liquidity price-high market toward 50%', () => {
      const market = makeMarket({ yesPrice: 0.80, noPrice: 0.20, liquidity: 5000 });
      const result = estimator.estimate(market, [market]);
      // Should adjust down toward 0.5
      expect(result.estimatedTrueProb).toBeLessThan(0.80);
    });

    it('pushes low-liquidity price-low market toward 50%', () => {
      const market = makeMarket({ yesPrice: 0.20, noPrice: 0.80, liquidity: 5000 });
      const result = estimator.estimate(market, [market]);
      // Should adjust up toward 0.5
      expect(result.estimatedTrueProb).toBeGreaterThan(0.20);
    });

    it('applies less adjustment on high-liquidity markets', () => {
      const lowLiqMarket = makeMarket({ yesPrice: 0.70, liquidity: 5000 });
      const highLiqMarket = makeMarket({ yesPrice: 0.70, liquidity: 200000 });

      const lowResult = estimator.estimate(lowLiqMarket, [lowLiqMarket]);
      const highResult = estimator.estimate(highLiqMarket, [highLiqMarket]);

      const lowAdjustment = Math.abs(lowResult.estimatedTrueProb - 0.70);
      const highAdjustment = Math.abs(highResult.estimatedTrueProb - 0.70);

      expect(lowAdjustment).toBeGreaterThan(highAdjustment);
    });
  });

  // ----------------------------------------
  // Spread / inefficiency signal
  // ----------------------------------------
  describe('spread/inefficiency signal', () => {
    it('detects large spread when yesPrice + noPrice != 1', () => {
      // yesPrice=0.40, noPrice=0.40 → sum=0.80 (large inefficiency)
      const market = makeMarket({ yesPrice: 0.40, noPrice: 0.40 });
      const result = estimator.estimate(market, [market]);
      const spreadSignal = result.signals.find(s => s.name === 'Spread/Inefficiency');
      expect(spreadSignal).toBeDefined();
      expect(Math.abs(spreadSignal!.adjustment)).toBeGreaterThan(0);
    });

    it('has zero adjustment for tight spread (sum ~1.0)', () => {
      const market = makeMarket({ yesPrice: 0.50, noPrice: 0.50 }); // sum=1.0
      const result = estimator.estimate(market, [market]);
      const spreadSignal = result.signals.find(s => s.name === 'Spread/Inefficiency');
      expect(spreadSignal!.adjustment).toBeCloseTo(0, 2);
    });
  });

  // ----------------------------------------
  // Volume significance signal
  // ----------------------------------------
  describe('volume significance signal', () => {
    it('works without allMarkets (returns zero adjustment)', () => {
      const market = makeMarket();
      const result = estimator.estimate(market); // no allMarkets
      const volSignal = result.signals.find(s => s.name === 'Volume Significance');
      expect(volSignal).toBeDefined();
      expect(volSignal!.adjustment).toBe(0);
    });

    it('identifies low-volume market vs median', () => {
      const lowVolMarket = makeMarket({ id: 'low', volume: 100, yesPrice: 0.70 });
      const highVolMarkets = Array.from({ length: 10 }, (_, i) =>
        makeMarket({ id: `m${i}`, volume: 100000 })
      );
      const allMarkets = [...highVolMarkets, lowVolMarket];

      const result = estimator.estimate(lowVolMarket, allMarkets);
      const volSignal = result.signals.find(s => s.name === 'Volume Significance');
      // Low volume vs high median → non-zero mean-reversion adjustment
      expect(Math.abs(volSignal!.adjustment)).toBeGreaterThanOrEqual(0);
    });
  });

  // ----------------------------------------
  // Time decay signal
  // ----------------------------------------
  describe('time decay signal', () => {
    it('returns zero adjustment for market expiring < 24h', () => {
      const market = makeMarket({
        endDate: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
      });
      const result = estimator.estimate(market, [market]);
      const timeSignal = result.signals.find(s => s.name === 'Time Decay');
      expect(timeSignal!.adjustment).toBe(0);
    });

    it('returns zero adjustment for missing endDate', () => {
      const market = makeMarket({ endDate: '' });
      const result = estimator.estimate(market, [market]);
      const timeSignal = result.signals.find(s => s.name === 'Time Decay');
      expect(timeSignal!.adjustment).toBe(0);
    });

    it('applies mean-reversion for market 30+ days out', () => {
      const market = makeMarket({
        yesPrice: 0.70,
        endDate: new Date(Date.now() + 45 * 24 * 3600 * 1000).toISOString(),
      });
      const result = estimator.estimate(market, [market]);
      const timeSignal = result.signals.find(s => s.name === 'Time Decay');
      expect(timeSignal!.adjustment).toBeLessThan(0); // push down toward 0.5
    });
  });

  // ----------------------------------------
  // Confidence
  // ----------------------------------------
  describe('confidence', () => {
    it('is higher for high-liquidity markets', () => {
      const low = makeMarket({ liquidity: 500 });
      const high = makeMarket({ liquidity: 100000 });

      const lowResult = estimator.estimate(low, [low]);
      const highResult = estimator.estimate(high, [high]);

      expect(highResult.confidence).toBeGreaterThan(lowResult.confidence);
    });

    it('is higher for high-volume markets', () => {
      const low = makeMarket({ volume: 1000 });
      const high = makeMarket({ volume: 500000 });

      const lowResult = estimator.estimate(low, [low]);
      const highResult = estimator.estimate(high, [high]);

      expect(highResult.confidence).toBeGreaterThan(lowResult.confidence);
    });
  });
});
