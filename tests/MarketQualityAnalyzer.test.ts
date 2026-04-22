// ================================================
// TESTS: MarketQualityAnalyzer
// ================================================

jest.mock('../src/utils/Logger', () => ({
  logger: { debug: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import { MarketQualityAnalyzer, MIN_QUALITY_SCORE } from '../src/analysis/MarketQualityAnalyzer';
import { ParsedMarket } from '../src/services/GammaApiClient';

function makeMarket(overrides: Partial<ParsedMarket> = {}): ParsedMarket {
  return {
    id: 'market-1',
    question: 'Will candidate X win the 2024 election?',
    conditionId: 'cond-1',
    slug: 'market-slug',
    yesPrice: 0.50,
    noPrice: 0.50,
    yesTokenId: 'yes-token',
    noTokenId: 'no-token',
    liquidity: 100_000,
    volume: 500_000,
    active: true,
    closed: false,
    endDate: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    createdAt: new Date().toISOString(),
    description: '',
    negRisk: false,
    acceptingOrders: true,
    ...overrides,
  };
}

describe('MarketQualityAnalyzer', () => {
  let analyzer: MarketQualityAnalyzer;

  beforeEach(() => {
    analyzer = new MarketQualityAnalyzer();
  });

  // ----------------------------------------
  // score() return structure
  // ----------------------------------------
  describe('score() return structure', () => {
    it('returns all 5 dimension fields plus total and flags', () => {
      const market = makeMarket();
      const score = analyzer.score(market);
      expect(score).toHaveProperty('total');
      expect(score).toHaveProperty('liquidity');
      expect(score).toHaveProperty('priceRange');
      expect(score).toHaveProperty('clarity');
      expect(score).toHaveProperty('resolution');
      expect(score).toHaveProperty('activity');
      expect(score).toHaveProperty('flags');
      expect(Array.isArray(score.flags)).toBe(true);
    });

    it('total equals sum of all dimension scores', () => {
      const market = makeMarket();
      const score = analyzer.score(market);
      const sum = score.liquidity + score.priceRange + score.clarity + score.resolution + score.activity;
      expect(score.total).toBe(sum);
    });

    it('total is always between 0 and 100', () => {
      const markets = [
        makeMarket({ liquidity: 0, yesPrice: 0.01, question: 'X?', volume: 0 }),
        makeMarket({ liquidity: 500_000, yesPrice: 0.50, volume: 10_000_000 }),
      ];
      for (const m of markets) {
        const score = analyzer.score(m);
        expect(score.total).toBeGreaterThanOrEqual(0);
        expect(score.total).toBeLessThanOrEqual(100);
      }
    });
  });

  // ----------------------------------------
  // Dimension 1: Liquidity (0–25)
  // ----------------------------------------
  describe('liquidity scoring (0–25)', () => {
    it('returns 25 for liquidity >= $200K', () => {
      const score = analyzer.score(makeMarket({ liquidity: 200_000 }));
      expect(score.liquidity).toBe(25);
    });

    it('returns 22 for liquidity $100K–$200K', () => {
      const score = analyzer.score(makeMarket({ liquidity: 150_000 }));
      expect(score.liquidity).toBe(22);
    });

    it('returns 18 for liquidity $50K–$100K', () => {
      const score = analyzer.score(makeMarket({ liquidity: 75_000 }));
      expect(score.liquidity).toBe(18);
    });

    it('returns 13 for liquidity $20K–$50K', () => {
      const score = analyzer.score(makeMarket({ liquidity: 30_000 }));
      expect(score.liquidity).toBe(13);
    });

    it('returns 0 and adds flag for liquidity below $5K', () => {
      const score = analyzer.score(makeMarket({ liquidity: 4_000 }));
      expect(score.liquidity).toBe(0);
      expect(score.flags.some(f => /low liquidity/i.test(f))).toBe(true);
    });
  });

  // ----------------------------------------
  // Dimension 2: Price Range (0–20)
  // ----------------------------------------
  describe('price range scoring (0–20)', () => {
    it('returns 20 for price in 30%–70% range', () => {
      expect(analyzer.score(makeMarket({ yesPrice: 0.50 })).priceRange).toBe(20);
      expect(analyzer.score(makeMarket({ yesPrice: 0.45 })).priceRange).toBe(20);
    });

    it('returns 17 for price in 70%–80% or 20%–30% range', () => {
      expect(analyzer.score(makeMarket({ yesPrice: 0.75 })).priceRange).toBe(17);
      expect(analyzer.score(makeMarket({ yesPrice: 0.25 })).priceRange).toBe(17);
    });

    it('returns 5 for price in 90%–97% range', () => {
      const score = analyzer.score(makeMarket({ yesPrice: 0.92 }));
      expect(score.priceRange).toBe(5);
    });

    it('returns 0 for extreme prices (>= 0.97 or <= 0.03)', () => {
      const score1 = analyzer.score(makeMarket({ yesPrice: 0.98 }));
      const score2 = analyzer.score(makeMarket({ yesPrice: 0.02 }));
      expect(score1.priceRange).toBe(0);
      expect(score2.priceRange).toBe(0);
    });

    it('adds flag for extreme prices', () => {
      const score = analyzer.score(makeMarket({ yesPrice: 0.99 }));
      expect(score.flags.some(f => /extreme price|near certainty/i.test(f))).toBe(true);
    });
  });

  // ----------------------------------------
  // Dimension 3: Question Clarity (0–20)
  // ----------------------------------------
  describe('clarity scoring (0–20)', () => {
    it('boosts clarity for questions with clear anchor terms', () => {
      const clearQ = makeMarket({ question: 'Will Bitcoin reach $100k by end of 2024?' });
      const vagueQ = makeMarket({ question: 'Will something happen approximately?' });
      expect(analyzer.score(clearQ).clarity).toBeGreaterThan(analyzer.score(vagueQ).clarity);
    });

    it('penalizes vague resolution language', () => {
      const vague = makeMarket({ question: 'Will this approximately happen subject to interpretation?' });
      const score = analyzer.score(vague);
      expect(score.clarity).toBeLessThan(10);
    });

    it('adds flag for very short question text (< 20 chars)', () => {
      const score = analyzer.score(makeMarket({ question: 'Will X win?' })); // 11 chars
      expect(score.flags.some(f => /short question/i.test(f))).toBe(true);
    });

    it('boosts clarity for questions with specific numbers or years', () => {
      const withNum = makeMarket({ question: 'Will Bitcoin exceed $100k in 2024?' });
      const noNum = makeMarket({ question: 'Will Bitcoin reach a high price soon?' });
      expect(analyzer.score(withNum).clarity).toBeGreaterThanOrEqual(analyzer.score(noNum).clarity);
    });

    it('clarity score is clamped to 0–20', () => {
      const markets = [
        makeMarket({ question: 'Will the Supreme Court officially certify the 2024 election results above expectations?' }),
        makeMarket({ question: 'Will X happen subject to discretion as determined by major outlet interpretation?' }),
      ];
      for (const m of markets) {
        const score = analyzer.score(m);
        expect(score.clarity).toBeGreaterThanOrEqual(0);
        expect(score.clarity).toBeLessThanOrEqual(20);
      }
    });
  });

  // ----------------------------------------
  // Dimension 4: Resolution Proximity (0–20)
  // ----------------------------------------
  describe('resolution scoring (0–20)', () => {
    it('returns 20 for markets resolving in 1–30 days (sweet spot)', () => {
      const market = makeMarket({
        endDate: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      });
      expect(analyzer.score(market).resolution).toBe(20);
    });

    it('returns 18 for markets resolving in < 7 days', () => {
      const market = makeMarket({
        endDate: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      });
      expect(analyzer.score(market).resolution).toBe(18);
    });

    it('returns 5 for markets > 1 year away', () => {
      const market = makeMarket({
        endDate: new Date(Date.now() + 400 * 86_400_000).toISOString(),
      });
      expect(analyzer.score(market).resolution).toBe(5);
    });

    it('returns 0 and adds flag for markets past resolution date', () => {
      const market = makeMarket({
        endDate: new Date(Date.now() - 86_400_000).toISOString(), // yesterday
      });
      const score = analyzer.score(market);
      expect(score.resolution).toBe(0);
      expect(score.flags.some(f => /past resolution/i.test(f))).toBe(true);
    });

    it('returns 8 for markets with no endDate', () => {
      const market = makeMarket({ endDate: undefined as unknown as string });
      expect(analyzer.score(market).resolution).toBe(8);
    });
  });

  // ----------------------------------------
  // Dimension 5: Market Activity (0–15)
  // ----------------------------------------
  describe('activity scoring (0–15)', () => {
    it('returns 15 for vol/liq ratio >= 20x', () => {
      const market = makeMarket({ liquidity: 10_000, volume: 200_000 }); // 20x
      expect(analyzer.score(market).activity).toBe(15);
    });

    it('returns 12 for vol/liq ratio 10x–20x', () => {
      const market = makeMarket({ liquidity: 10_000, volume: 120_000 }); // 12x
      expect(analyzer.score(market).activity).toBe(12);
    });

    it('returns 0 and adds flag for vol/liq < 0.5x', () => {
      const market = makeMarket({ liquidity: 100_000, volume: 10_000 }); // 0.1x
      const score = analyzer.score(market);
      expect(score.activity).toBe(0);
      expect(score.flags.some(f => /very low activity/i.test(f))).toBe(true);
    });

    it('handles zero liquidity without throwing', () => {
      const market = makeMarket({ liquidity: 0, volume: 50_000 });
      expect(() => analyzer.score(market)).not.toThrow();
    });
  });

  // ----------------------------------------
  // passes() method
  // ----------------------------------------
  describe('passes()', () => {
    it('returns true for a high-quality market', () => {
      const market = makeMarket({
        liquidity: 200_000,
        volume: 2_000_000,
        yesPrice: 0.50,
        question: 'Will the Fed officially announce a rate cut above 0.25% in 2024?',
        endDate: new Date(Date.now() + 20 * 86_400_000).toISOString(),
      });
      expect(analyzer.passes(market)).toBe(true);
    });

    it('returns false for an extreme-price, low-liquidity market', () => {
      const market = makeMarket({
        liquidity: 1_000,
        volume: 100,
        yesPrice: 0.99,
        question: 'Win?',
        endDate: new Date(Date.now() - 86_400_000).toISOString(),
      });
      expect(analyzer.passes(market)).toBe(false);
    });

    it('respects custom minScore threshold', () => {
      const market = makeMarket({
        liquidity: 5_000,
        yesPrice: 0.50,
        volume: 25_000,
      });
      const score = analyzer.score(market);
      // passes with lenient threshold, may fail with strict
      expect(analyzer.passes(market, score.total - 1)).toBe(true);
      expect(analyzer.passes(market, score.total + 1)).toBe(false);
    });

    it('MIN_QUALITY_SCORE constant is 40', () => {
      expect(MIN_QUALITY_SCORE).toBe(40);
    });
  });
});
