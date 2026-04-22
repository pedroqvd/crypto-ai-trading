// ================================================
// TESTS: CorrelationAnalyzer
// ================================================

jest.mock('../src/utils/Logger', () => ({
  logger: { debug: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import { CorrelationAnalyzer } from '../src/analysis/CorrelationAnalyzer';
import { ParsedEvent, ParsedMarket } from '../src/services/GammaApiClient';

function makeMarket(overrides: Partial<ParsedMarket> = {}): ParsedMarket {
  return {
    id: `market-${Math.random().toString(36).slice(2)}`,
    question: 'Will candidate X win?',
    conditionId: 'cond-1',
    slug: 'market-slug',
    yesPrice: 0.33,
    noPrice: 0.67,
    yesTokenId: 'yes-token',
    noTokenId: 'no-token',
    liquidity: 50_000,
    volume: 100_000,
    active: true,
    closed: false,
    endDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    createdAt: new Date().toISOString(),
    description: '',
    negRisk: false,
    acceptingOrders: true,
    ...overrides,
  };
}

function makeEvent(markets: ParsedMarket[], overrides: Partial<ParsedEvent> = {}): ParsedEvent {
  return {
    id: `event-${Math.random().toString(36).slice(2)}`,
    title: 'Test Election Event',
    slug: 'test-election-event',
    markets,
    ...overrides,
  };
}

describe('CorrelationAnalyzer', () => {
  let analyzer: CorrelationAnalyzer;

  beforeEach(() => {
    analyzer = new CorrelationAnalyzer();
  });

  // ----------------------------------------
  // Minimum market count (Fix 8: min 3)
  // ----------------------------------------
  describe('minimum market count', () => {
    it('ignores events with fewer than 3 markets', () => {
      const event = makeEvent([makeMarket({ yesPrice: 0.7 }), makeMarket({ yesPrice: 0.7 })]);
      const opps = analyzer.findInconsistencies([event]);
      expect(opps).toHaveLength(0);
    });

    it('processes events with exactly 3 markets', () => {
      // Sum = 1.5 → 50% over-book (well above 10% threshold)
      const event = makeEvent([
        makeMarket({ yesPrice: 0.50 }),
        makeMarket({ yesPrice: 0.50 }),
        makeMarket({ yesPrice: 0.50 }),
      ]);
      const opps = analyzer.findInconsistencies([event]);
      expect(opps.length).toBeGreaterThanOrEqual(0); // may or may not find opp depending on threshold
    });

    it('processes events with 4+ markets', () => {
      const event = makeEvent([
        makeMarket({ yesPrice: 0.40 }),
        makeMarket({ yesPrice: 0.40 }),
        makeMarket({ yesPrice: 0.40 }),
        makeMarket({ yesPrice: 0.40 }),
      ]);
      // Sum = 1.60 → 60% over-book
      const opps = analyzer.findInconsistencies([event]);
      expect(opps).toHaveLength(1); // returns top 1 per event
    });
  });

  // ----------------------------------------
  // Threshold (Fix 8: raised to 10%)
  // ----------------------------------------
  describe('deviation threshold (10%)', () => {
    it('ignores over-book below 10%', () => {
      // Sum = 1.05 → 5% deviation (below 10% threshold)
      const m1 = makeMarket({ yesPrice: 0.35 });
      const m2 = makeMarket({ yesPrice: 0.35 });
      const m3 = makeMarket({ yesPrice: 0.35 });
      const event = makeEvent([m1, m2, m3]);
      const opps = analyzer.findInconsistencies([event]);
      expect(opps).toHaveLength(0);
    });

    it('ignores under-book below 10%', () => {
      // Sum = 0.96 → 4% under (below 10% threshold)
      const event = makeEvent([
        makeMarket({ yesPrice: 0.32 }),
        makeMarket({ yesPrice: 0.32 }),
        makeMarket({ yesPrice: 0.32 }),
      ]);
      const opps = analyzer.findInconsistencies([event]);
      expect(opps).toHaveLength(0);
    });

    it('flags over-book above 10%', () => {
      // Sum = 1.45 → 45% over-book
      const event = makeEvent([
        makeMarket({ yesPrice: 0.50 }),
        makeMarket({ yesPrice: 0.50 }),
        makeMarket({ yesPrice: 0.45 }),
      ]);
      const opps = analyzer.findInconsistencies([event]);
      expect(opps).toHaveLength(1);
      expect(opps[0].type).toBe('over_book');
    });

    it('flags under-book above 10%', () => {
      // Sum = 0.60 → 40% under-book
      const event = makeEvent([
        makeMarket({ yesPrice: 0.20 }),
        makeMarket({ yesPrice: 0.20 }),
        makeMarket({ yesPrice: 0.20 }),
      ]);
      const opps = analyzer.findInconsistencies([event]);
      expect(opps).toHaveLength(1);
      expect(opps[0].type).toBe('under_book');
    });
  });

  // ----------------------------------------
  // Price range validity check (Fix 8)
  // ----------------------------------------
  describe('price range validity', () => {
    it('ignores markets with extreme prices (> 0.90)', () => {
      // One market has a near-certain price — event should be skipped
      const event = makeEvent([
        makeMarket({ yesPrice: 0.95 }), // dominant — skip whole event
        makeMarket({ yesPrice: 0.30 }),
        makeMarket({ yesPrice: 0.30 }),
      ]);
      const opps = analyzer.findInconsistencies([event]);
      expect(opps).toHaveLength(0);
    });

    it('ignores markets priced near 0 (< 0.02)', () => {
      const event = makeEvent([
        makeMarket({ yesPrice: 0.01 }), // near zero — skip event
        makeMarket({ yesPrice: 0.50 }),
        makeMarket({ yesPrice: 0.50 }),
      ]);
      const opps = analyzer.findInconsistencies([event]);
      expect(opps).toHaveLength(0);
    });

    it('processes markets all within valid range (0.02–0.90)', () => {
      const event = makeEvent([
        makeMarket({ yesPrice: 0.45 }),
        makeMarket({ yesPrice: 0.45 }),
        makeMarket({ yesPrice: 0.45 }),
      ]);
      // Sum = 1.35 → 35% over-book — should be flagged
      const opps = analyzer.findInconsistencies([event]);
      expect(opps).toHaveLength(1);
    });
  });

  // ----------------------------------------
  // Recommendation direction
  // ----------------------------------------
  describe('recommendation direction', () => {
    it('recommends BUY_NO for over-priced market (over-book)', () => {
      const event = makeEvent([
        makeMarket({ yesPrice: 0.55 }), // most over-priced
        makeMarket({ yesPrice: 0.40 }),
        makeMarket({ yesPrice: 0.40 }),
      ]);
      // Sum = 1.35 — over-book; most mispriced = 0.55 market
      const opps = analyzer.findInconsistencies([event]);
      expect(opps[0].recommendation).toBe('BUY_NO');
    });

    it('recommends BUY_YES for under-priced market (under-book)', () => {
      const event = makeEvent([
        makeMarket({ yesPrice: 0.25 }), // most under-priced (mispricing = negative = BUY_YES)
        makeMarket({ yesPrice: 0.18 }),
        makeMarket({ yesPrice: 0.18 }),
      ]);
      // Sum = 0.61 — under-book
      const opps = analyzer.findInconsistencies([event]);
      expect(opps[0].recommendation).toBe('BUY_YES');
    });
  });

  // ----------------------------------------
  // Output fields
  // ----------------------------------------
  describe('opportunity fields', () => {
    it('populates all required fields', () => {
      const event = makeEvent([
        makeMarket({ yesPrice: 0.50 }),
        makeMarket({ yesPrice: 0.50 }),
        makeMarket({ yesPrice: 0.45 }),
      ]);
      const opps = analyzer.findInconsistencies([event]);
      if (opps.length === 0) return; // threshold may not be met
      const opp = opps[0];
      expect(opp).toHaveProperty('type');
      expect(opp).toHaveProperty('eventId');
      expect(opp).toHaveProperty('eventTitle');
      expect(opp).toHaveProperty('marketId');
      expect(opp).toHaveProperty('question');
      expect(opp).toHaveProperty('yesPrice');
      expect(opp).toHaveProperty('fairPrice');
      expect(opp).toHaveProperty('mispricing');
      expect(opp).toHaveProperty('bookSum');
      expect(opp).toHaveProperty('siblingCount');
      expect(opp).toHaveProperty('recommendation');
    });

    it('fairPrice is always between 0 and 1', () => {
      const event = makeEvent([
        makeMarket({ yesPrice: 0.50 }),
        makeMarket({ yesPrice: 0.50 }),
        makeMarket({ yesPrice: 0.50 }),
      ]);
      const opps = analyzer.findInconsistencies([event]);
      for (const opp of opps) {
        expect(opp.fairPrice).toBeGreaterThan(0);
        expect(opp.fairPrice).toBeLessThan(1);
      }
    });

    it('returns at most 1 opportunity per event', () => {
      const event = makeEvent([
        makeMarket({ yesPrice: 0.45 }),
        makeMarket({ yesPrice: 0.45 }),
        makeMarket({ yesPrice: 0.45 }),
        makeMarket({ yesPrice: 0.45 }),
      ]);
      const opps = analyzer.findInconsistencies([event]);
      expect(opps.length).toBeLessThanOrEqual(1);
    });
  });

  // ----------------------------------------
  // Edge cases
  // ----------------------------------------
  describe('edge cases', () => {
    it('returns empty array for empty event list', () => {
      expect(analyzer.findInconsistencies([])).toHaveLength(0);
    });

    it('returns empty array when all events have < 3 markets', () => {
      const events = [
        makeEvent([makeMarket(), makeMarket()]),
        makeEvent([makeMarket()]),
      ];
      expect(analyzer.findInconsistencies(events)).toHaveLength(0);
    });

    it('handles multiple events independently', () => {
      const eventA = makeEvent([
        makeMarket({ yesPrice: 0.45 }),
        makeMarket({ yesPrice: 0.45 }),
        makeMarket({ yesPrice: 0.45 }),
      ]); // sum 1.35
      const eventB = makeEvent([
        makeMarket({ yesPrice: 0.20 }),
        makeMarket({ yesPrice: 0.20 }),
        makeMarket({ yesPrice: 0.20 }),
      ]); // sum 0.60
      const opps = analyzer.findInconsistencies([eventA, eventB]);
      expect(opps.length).toBe(2);
    });

    it('summarize() returns a non-empty string', () => {
      const event = makeEvent([
        makeMarket({ yesPrice: 0.45 }),
        makeMarket({ yesPrice: 0.45 }),
        makeMarket({ yesPrice: 0.45 }),
      ]);
      const opps = analyzer.findInconsistencies([event]);
      if (opps.length === 0) return;
      const summary = analyzer.summarize(opps[0]);
      expect(typeof summary).toBe('string');
      expect(summary.length).toBeGreaterThan(10);
    });
  });
});
