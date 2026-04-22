// ================================================
// TESTS: EnsembleWeightTracker
// ================================================

jest.mock('fs');
jest.mock('../src/utils/Logger', () => ({
  logger: { debug: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import { EnsembleWeightTracker } from '../src/analysis/EnsembleWeightTracker';

type Signal = { name: string; adjustment: number; weight: number };

function makeTracker(): EnsembleWeightTracker {
  return new EnsembleWeightTracker('/tmp/test-ensemble.json');
}

function recordN(
  tracker: EnsembleWeightTracker,
  signalName: string,
  n: number,
  winRate: number,
  side: 'BUY_YES' | 'BUY_NO' = 'BUY_YES'
): void {
  const signal: Signal = { name: signalName, adjustment: 0.1, weight: 1.0 };
  for (let i = 0; i < n; i++) {
    tracker.recordOutcome([signal], i < Math.round(n * winRate), side);
  }
}

describe('EnsembleWeightTracker', () => {

  // ----------------------------------------
  // Initial state
  // ----------------------------------------
  describe('initial state', () => {
    it('returns 1.0 weight for unknown signals', () => {
      const tracker = makeTracker();
      const weights = tracker.getLearnedWeights();
      expect(Object.keys(weights)).toHaveLength(0); // no signals yet
    });

    it('returns 1.0 weight for signals below MIN_SAMPLES (15)', () => {
      const tracker = makeTracker();
      recordN(tracker, 'signal-a', 10, 1.0); // 10 < 15
      const weights = tracker.getLearnedWeights();
      expect(weights['signal-a']).toBe(1.0);
    });

    it('getStats() returns empty array initially', () => {
      const tracker = makeTracker();
      expect(tracker.getStats()).toHaveLength(0);
    });
  });

  // ----------------------------------------
  // Weight calculation
  // ----------------------------------------
  describe('weight calculation', () => {
    it('weight = 1.0 at exactly 50% accuracy (boundary)', () => {
      const tracker = makeTracker();
      recordN(tracker, 'signal-mid', 20, 0.5);
      const weights = tracker.getLearnedWeights();
      expect(weights['signal-mid']).toBeCloseTo(1.0, 1);
    });

    it('weight > 1.0 for accuracy > 50%', () => {
      const tracker = makeTracker();
      recordN(tracker, 'signal-good', 20, 0.8);
      const weights = tracker.getLearnedWeights();
      expect(weights['signal-good']).toBeGreaterThan(1.0);
    });

    it('weight < 1.0 for accuracy < 50%', () => {
      const tracker = makeTracker();
      recordN(tracker, 'signal-bad', 20, 0.2);
      const weights = tracker.getLearnedWeights();
      expect(weights['signal-bad']).toBeLessThan(1.0);
    });

    it('weight is clamped to [0.4, 2.0]', () => {
      const tracker = makeTracker();
      recordN(tracker, 'perfect', 20, 1.0);
      recordN(tracker, 'terrible', 20, 0.0);
      const weights = tracker.getLearnedWeights();
      expect(weights['perfect']).toBeLessThanOrEqual(2.0);
      expect(weights['terrible']).toBeGreaterThanOrEqual(0.4);
    });

    it('higher accuracy produces higher weight', () => {
      const tracker = makeTracker();
      recordN(tracker, 'sig-60', 20, 0.6);
      recordN(tracker, 'sig-80', 20, 0.8);
      const weights = tracker.getLearnedWeights();
      expect(weights['sig-80']).toBeGreaterThan(weights['sig-60']);
    });
  });

  // ----------------------------------------
  // recordOutcome direction logic
  // ----------------------------------------
  describe('direction alignment', () => {
    it('bullish signal on BUY_YES trade that wins → correct', () => {
      const tracker = makeTracker();
      const bullishSignal: Signal = { name: 'bull-sig', adjustment: +0.1, weight: 1.0 };
      // BUY_YES + win = correct for bullish signal
      for (let i = 0; i < 20; i++) {
        tracker.recordOutcome([bullishSignal], true, 'BUY_YES');
      }
      const weights = tracker.getLearnedWeights();
      expect(weights['bull-sig']).toBeGreaterThan(1.0);
    });

    it('bullish signal on BUY_YES trade that loses → incorrect', () => {
      const tracker = makeTracker();
      const bullishSignal: Signal = { name: 'wrong-bull', adjustment: +0.1, weight: 1.0 };
      for (let i = 0; i < 20; i++) {
        tracker.recordOutcome([bullishSignal], false, 'BUY_YES'); // all losses
      }
      const weights = tracker.getLearnedWeights();
      expect(weights['wrong-bull']).toBeLessThan(1.0);
    });

    it('bearish signal on BUY_NO trade that wins → correct', () => {
      const tracker = makeTracker();
      const bearSignal: Signal = { name: 'bear-sig', adjustment: -0.1, weight: 1.0 };
      for (let i = 0; i < 20; i++) {
        tracker.recordOutcome([bearSignal], true, 'BUY_NO'); // direction match, won
      }
      const weights = tracker.getLearnedWeights();
      expect(weights['bear-sig']).toBeGreaterThan(1.0);
    });

    it('accumulates history for multiple signals in same call', () => {
      const tracker = makeTracker();
      const signals: Signal[] = [
        { name: 'sig-1', adjustment: 0.1, weight: 1.0 },
        { name: 'sig-2', adjustment: 0.2, weight: 1.0 },
      ];
      for (let i = 0; i < 16; i++) {
        tracker.recordOutcome(signals, true, 'BUY_YES');
      }
      const weights = tracker.getLearnedWeights();
      expect(weights['sig-1']).toBeGreaterThan(1.0);
      expect(weights['sig-2']).toBeGreaterThan(1.0);
    });
  });

  // ----------------------------------------
  // purgeUnreliableSignals (Fix 7)
  // ----------------------------------------
  describe('purgeUnreliableSignals', () => {
    it('removes signals with accuracy < 30% after >= 15 samples', () => {
      const tracker = makeTracker();
      recordN(tracker, 'bad-signal', 20, 0.1); // 10% accuracy — well below 30%
      expect(tracker.getLearnedWeights()['bad-signal']).toBeDefined();

      const purged = tracker.purgeUnreliableSignals();
      expect(purged).toContain('bad-signal');
      expect(tracker.getLearnedWeights()['bad-signal']).toBeUndefined();
    });

    it('keeps signals with accuracy >= 30%', () => {
      const tracker = makeTracker();
      recordN(tracker, 'ok-signal', 20, 0.35); // 35% accuracy — above threshold
      const purged = tracker.purgeUnreliableSignals();
      expect(purged).not.toContain('ok-signal');
      expect(tracker.getLearnedWeights()['ok-signal']).toBeDefined();
    });

    it('does NOT purge signals below MIN_SAMPLES (< 15)', () => {
      const tracker = makeTracker();
      recordN(tracker, 'new-signal', 10, 0.0); // 0% accuracy but only 10 samples
      const purged = tracker.purgeUnreliableSignals();
      expect(purged).not.toContain('new-signal');
    });

    it('returns empty array when no signals qualify for purge', () => {
      const tracker = makeTracker();
      recordN(tracker, 'good', 20, 0.7);
      recordN(tracker, 'ok', 20, 0.4);
      const purged = tracker.purgeUnreliableSignals();
      expect(purged).toHaveLength(0);
    });

    it('can purge multiple signals at once', () => {
      const tracker = makeTracker();
      // Keep total outcomes under 50 to prevent auto-purge from firing first
      recordN(tracker, 'bad-1', 16, 0.05);
      recordN(tracker, 'bad-2', 16, 0.10);
      recordN(tracker, 'good', 16, 0.80);
      // 48 total outcomes — under auto-purge threshold of 50
      const purged = tracker.purgeUnreliableSignals();
      expect(purged).toContain('bad-1');
      expect(purged).toContain('bad-2');
      expect(purged).not.toContain('good');
    });

    it('is auto-triggered every 50 recordOutcome calls', () => {
      const tracker = makeTracker();
      const purgeSpy = jest.spyOn(tracker, 'purgeUnreliableSignals');
      // Insert a bad signal first, then fire 50 outcomes to trigger auto-purge
      recordN(tracker, 'auto-bad', 20, 0.0);
      const goodSignal: Signal = { name: 'trigger', adjustment: 0.1, weight: 1.0 };
      for (let i = 0; i < 50; i++) {
        tracker.recordOutcome([goodSignal], true, 'BUY_YES');
      }
      // At 50 calls total, auto-purge should have fired
      expect(purgeSpy).toHaveBeenCalled();
    });
  });

  // ----------------------------------------
  // getStats
  // ----------------------------------------
  describe('getStats', () => {
    it('returns sorted stats by sample count descending', () => {
      const tracker = makeTracker();
      recordN(tracker, 'small', 16, 0.5);
      recordN(tracker, 'large', 30, 0.5);
      const stats = tracker.getStats();
      expect(stats[0].name).toBe('large');
      expect(stats[1].name).toBe('small');
    });

    it('accuracy field matches expected win rate', () => {
      const tracker = makeTracker();
      recordN(tracker, 'sig', 20, 0.75); // 75% win rate
      const stats = tracker.getStats();
      const s = stats.find(x => x.name === 'sig')!;
      expect(s.accuracy).toBeCloseTo(0.75, 1);
    });
  });
});
