// ================================================
// TESTS: TradeJournal
// ================================================

jest.mock('../src/engine/Config', () => ({
  config: { logLevel: 'warn' },
}));

// Mock filesystem to avoid creating real files during tests
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

import { TradeJournal, TradeRecord } from '../src/utils/TradeJournal';

function makeTradeRecord(overrides: Partial<TradeRecord> = {}): TradeRecord {
  return {
    id: `trade-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    marketId: 'market-1',
    question: 'Will X happen?',
    side: 'BUY_YES',
    entryPrice: 0.45,
    size: 22.22,
    stake: 10,
    edge: 0.10,
    ev: 0.08,
    kellyFraction: 0.025,
    confidence: 0.7,
    reasoning: 'Strong signal',
    status: 'open',
    dryRun: true,
    ...overrides,
  };
}

describe('TradeJournal', () => {
  let journal: TradeJournal;

  beforeEach(() => {
    journal = new TradeJournal();
  });

  // ----------------------------------------
  // recordTrade
  // ----------------------------------------
  describe('recordTrade', () => {
    it('stores trade and returns it in getAllTrades()', () => {
      const trade = makeTradeRecord();
      journal.recordTrade(trade);
      expect(journal.getAllTrades()).toContainEqual(trade);
    });

    it('multiple trades accumulate', () => {
      journal.recordTrade(makeTradeRecord({ id: 't1' }));
      journal.recordTrade(makeTradeRecord({ id: 't2' }));
      journal.recordTrade(makeTradeRecord({ id: 't3' }));
      expect(journal.getAllTrades()).toHaveLength(3);
    });
  });

  // ----------------------------------------
  // getOpenTrades
  // ----------------------------------------
  describe('getOpenTrades', () => {
    it('returns only open trades', () => {
      journal.recordTrade(makeTradeRecord({ id: 'open-1', status: 'open' }));
      journal.recordTrade(makeTradeRecord({ id: 'won-1', status: 'won' }));
      journal.recordTrade(makeTradeRecord({ id: 'lost-1', status: 'lost' }));

      const open = journal.getOpenTrades();
      expect(open).toHaveLength(1);
      expect(open[0].id).toBe('open-1');
    });

    it('returns empty when no open trades', () => {
      journal.recordTrade(makeTradeRecord({ id: 'won-1', status: 'won' }));
      expect(journal.getOpenTrades()).toHaveLength(0);
    });
  });

  // ----------------------------------------
  // resolveTrade
  // ----------------------------------------
  describe('resolveTrade', () => {
    it('marks trade as won with correct P&L', () => {
      const trade = makeTradeRecord({ id: 'trade-1', stake: 10, size: 22.22, status: 'open' });
      journal.recordTrade(trade);
      journal.resolveTrade('trade-1', true, 1.0);

      const resolved = journal.getAllTrades().find(t => t.id === 'trade-1')!;
      expect(resolved.status).toBe('won');
      expect(resolved.exitPrice).toBe(1.0);
      // P&L = size*1 - stake = 22.22 - 10 = 12.22
      expect(resolved.pnl).toBeCloseTo(12.22, 1);
    });

    it('marks trade as lost with correct P&L', () => {
      const trade = makeTradeRecord({ id: 'trade-1', stake: 10, size: 22.22, status: 'open' });
      journal.recordTrade(trade);
      journal.resolveTrade('trade-1', false, 0.0);

      const resolved = journal.getAllTrades().find(t => t.id === 'trade-1')!;
      expect(resolved.status).toBe('lost');
      expect(resolved.exitPrice).toBe(0.0);
      expect(resolved.pnl).toBe(-10); // lose stake
    });

    it('sets resolvedAt timestamp', () => {
      const trade = makeTradeRecord({ id: 'trade-1' });
      journal.recordTrade(trade);
      journal.resolveTrade('trade-1', true, 1.0);

      const resolved = journal.getAllTrades().find(t => t.id === 'trade-1')!;
      expect(resolved.resolvedAt).toBeDefined();
      expect(typeof resolved.resolvedAt).toBe('string');
    });

    it('does nothing for unknown trade ID', () => {
      expect(() => journal.resolveTrade('nonexistent', true, 1.0)).not.toThrow();
    });
  });

  // ----------------------------------------
  // getRecentTrades
  // ----------------------------------------
  describe('getRecentTrades', () => {
    it('returns last N trades', () => {
      for (let i = 0; i < 10; i++) {
        journal.recordTrade(makeTradeRecord({ id: `t${i}` }));
      }
      const recent = journal.getRecentTrades(3);
      expect(recent).toHaveLength(3);
      expect(recent[2].id).toBe('t9');
    });

    it('returns all trades if N > total', () => {
      journal.recordTrade(makeTradeRecord());
      journal.recordTrade(makeTradeRecord());
      expect(journal.getRecentTrades(100)).toHaveLength(2);
    });
  });

  // ----------------------------------------
  // getStats
  // ----------------------------------------
  describe('getStats', () => {
    it('returns zeros when no trades', () => {
      const stats = journal.getStats();
      expect(stats.totalTrades).toBe(0);
      expect(stats.wins).toBe(0);
      expect(stats.losses).toBe(0);
      expect(stats.totalPnl).toBe(0);
      expect(stats.winRate).toBe(0);
    });

    it('calculates win rate correctly', () => {
      journal.recordTrade(makeTradeRecord({ id: 't1', status: 'won', pnl: 10 }));
      journal.recordTrade(makeTradeRecord({ id: 't2', status: 'won', pnl: 5 }));
      journal.recordTrade(makeTradeRecord({ id: 't3', status: 'lost', pnl: -10 }));

      const stats = journal.getStats();
      expect(stats.wins).toBe(2);
      expect(stats.losses).toBe(1);
      expect(stats.winRate).toBeCloseTo(66.67, 1);
    });

    it('calculates total P&L correctly', () => {
      journal.recordTrade(makeTradeRecord({ id: 't1', status: 'won', pnl: 20 }));
      journal.recordTrade(makeTradeRecord({ id: 't2', status: 'lost', pnl: -8 }));

      const stats = journal.getStats();
      expect(stats.totalPnl).toBeCloseTo(12, 2);
    });

    it('counts open trades separately', () => {
      journal.recordTrade(makeTradeRecord({ id: 't1', status: 'open' }));
      journal.recordTrade(makeTradeRecord({ id: 't2', status: 'won', pnl: 5 }));

      const stats = journal.getStats();
      expect(stats.totalTrades).toBe(2);
      expect(stats.openTrades).toBe(1);
    });

    it('identifies best and worst trade', () => {
      journal.recordTrade(makeTradeRecord({ id: 't1', status: 'won', pnl: 50 }));
      journal.recordTrade(makeTradeRecord({ id: 't2', status: 'lost', pnl: -20 }));
      journal.recordTrade(makeTradeRecord({ id: 't3', status: 'won', pnl: 10 }));

      const stats = journal.getStats();
      expect(stats.bestTrade).toBe(50);
      expect(stats.worstTrade).toBe(-20);
    });

    it('calculates avgEdge across all trades', () => {
      journal.recordTrade(makeTradeRecord({ edge: 0.10 }));
      journal.recordTrade(makeTradeRecord({ edge: 0.20 }));
      journal.recordTrade(makeTradeRecord({ edge: 0.30 }));

      const stats = journal.getStats();
      expect(stats.avgEdge).toBeCloseTo(0.20, 4);
    });
  });

  // ----------------------------------------
  // getClosedTrades
  // ----------------------------------------
  describe('getClosedTrades', () => {
    it('returns won and lost trades but not open', () => {
      journal.recordTrade(makeTradeRecord({ id: 't1', status: 'open' }));
      journal.recordTrade(makeTradeRecord({ id: 't2', status: 'won', pnl: 5 }));
      journal.recordTrade(makeTradeRecord({ id: 't3', status: 'lost', pnl: -5 }));
      journal.recordTrade(makeTradeRecord({ id: 't4', status: 'cancelled' }));

      const closed = journal.getClosedTrades();
      expect(closed).toHaveLength(3); // won + lost + cancelled
      expect(closed.every(t => t.status !== 'open')).toBe(true);
    });
  });
});
