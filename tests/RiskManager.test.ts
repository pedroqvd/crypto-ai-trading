// ================================================
// TESTS: RiskManager
// ================================================

jest.mock('../src/engine/Config', () => ({
  config: {
    bankroll: 1000,
    maxPositionPct: 0.05,       // 5% per position = $50
    maxTotalExposurePct: 0.50,  // 50% total exposure = $500
    logLevel: 'warn',
  },
}));

// Mock TradeJournal to avoid filesystem I/O
jest.mock('../src/utils/TradeJournal', () => ({
  TradeJournal: jest.fn().mockImplementation(() => ({
    getStats: () => ({ totalPnl: 0 }),
    getOpenTrades: () => [],
  })),
}));

import { RiskManager } from '../src/risk/RiskManager';
import { TradeJournal } from '../src/utils/TradeJournal';

function makeManager(bankroll = 1000): RiskManager {
  const journal = new TradeJournal();
  const manager = new RiskManager(journal);
  return manager;
}

describe('RiskManager', () => {

  // ----------------------------------------
  // checkTrade — happy path
  // ----------------------------------------
  describe('checkTrade (allowed)', () => {
    it('allows a trade within all limits', () => {
      const rm = makeManager();
      const result = rm.checkTrade(30, 'market-1'); // $30 < 5% of $1000 = $50
      expect(result.allowed).toBe(true);
    });

    it('includes current exposure in result', () => {
      const rm = makeManager();
      rm.registerPosition(20);
      const result = rm.checkTrade(10, 'market-2');
      expect(result.currentExposure).toBe(20);
    });
  });

  // ----------------------------------------
  // checkTrade — position size limit
  // ----------------------------------------
  describe('position size limit (maxPositionPct=5%)', () => {
    it('blocks trade exceeding 5% of bankroll ($50)', () => {
      const rm = makeManager();
      const result = rm.checkTrade(51, 'market-1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/posição|position|stake/i);
    });

    it('allows trade exactly at 5% of bankroll ($50)', () => {
      const rm = makeManager();
      const result = rm.checkTrade(50, 'market-1');
      expect(result.allowed).toBe(true);
    });
  });

  // ----------------------------------------
  // checkTrade — total exposure limit
  // ----------------------------------------
  describe('total exposure limit (maxTotalExposurePct=50%)', () => {
    it('blocks trade when total exposure would exceed 50% ($500)', () => {
      const rm = makeManager();
      rm.registerPosition(480); // already $480 in
      const result = rm.checkTrade(30, 'market-x'); // would take to $510 > $500
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/exposição|exposure/i);
    });

    it('allows trade when total stays under 50%', () => {
      const rm = makeManager();
      rm.registerPosition(200);
      const result = rm.checkTrade(40, 'market-x'); // $240 < $500
      expect(result.allowed).toBe(true);
    });
  });

  // ----------------------------------------
  // checkTrade — daily loss limit (10%)
  // ----------------------------------------
  describe('daily loss limit (10% of bankroll = $100)', () => {
    it('blocks trade when daily loss reached $100', () => {
      const rm = makeManager();
      // Simulate losses
      rm.registerPosition(50);
      rm.closePosition(50, -50); // -$50
      rm.registerPosition(50);
      rm.closePosition(50, -55); // -$55 → total -$105

      const result = rm.checkTrade(10, 'market-new');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/diária|daily/i);
    });
  });

  // ----------------------------------------
  // Circuit breaker — 15% drawdown
  // ----------------------------------------
  describe('circuit breaker (15% drawdown)', () => {
    it('activates circuit breaker at 15% drawdown when checkTrade is called', () => {
      const rm = makeManager(1000);
      // closePosition updates bankroll but does NOT activate circuit breaker by itself
      rm.closePosition(0, -150); // lose $150 → 15% drawdown

      // Circuit breaker only activates inside checkTrade()
      const result = rm.checkTrade(10, 'market-new');
      expect(result.allowed).toBe(false);
      expect(rm.getStatus().circuitBreaker).toBe(true);
    });

    it('blocks all trades once circuit breaker is active', () => {
      const rm = makeManager(1000);
      rm.closePosition(0, -200); // 20% drawdown
      rm.checkTrade(5, 'market-trigger'); // activate circuit breaker

      const r1 = rm.checkTrade(5, 'market-1');
      const r2 = rm.checkTrade(5, 'market-2');
      expect(r1.allowed).toBe(false);
      expect(r2.allowed).toBe(false);
      expect(r1.reason).toMatch(/[Cc]ircuit/i);
    });

    it('resetCircuitBreaker() clears the flag', () => {
      const rm = makeManager(1000);
      rm.closePosition(0, -200); // 20% drawdown
      rm.checkTrade(5, 'market-trigger'); // activate

      expect(rm.getStatus().circuitBreaker).toBe(true);
      rm.resetCircuitBreaker();
      // Flag should be cleared (checkTrade may re-trip it, but flag itself was reset)
      // Verify by inspecting directly before any new checkTrade
      expect(rm.getStatus().circuitBreaker).toBe(false);
    });
  });

  // ----------------------------------------
  // registerPosition / closePosition
  // ----------------------------------------
  describe('position tracking', () => {
    it('registerPosition increases totalExposure', () => {
      const rm = makeManager();
      rm.registerPosition(100);
      expect(rm.getStatus().totalExposure).toBe(100);
    });

    it('closePosition decreases totalExposure', () => {
      const rm = makeManager();
      rm.registerPosition(100);
      rm.closePosition(100, 0);
      expect(rm.getStatus().totalExposure).toBe(0);
    });

    it('closePosition with profit increases bankroll', () => {
      const rm = makeManager();
      rm.closePosition(50, 25);
      expect(rm.getStatus().bankroll).toBe(1025);
    });

    it('closePosition with loss decreases bankroll', () => {
      const rm = makeManager();
      rm.closePosition(50, -30);
      expect(rm.getStatus().bankroll).toBe(970);
    });

    it('totalExposure never goes below 0', () => {
      const rm = makeManager();
      rm.closePosition(999, -999); // Close more than registered
      expect(rm.getStatus().totalExposure).toBeGreaterThanOrEqual(0);
    });
  });

  // ----------------------------------------
  // getDrawdownPct
  // ----------------------------------------
  describe('drawdown calculation', () => {
    it('starts at 0% drawdown', () => {
      const rm = makeManager();
      expect(rm.getDrawdownPct()).toBe(0);
    });

    it('calculates correct drawdown percentage', () => {
      const rm = makeManager(1000);
      rm.closePosition(0, -100); // lose $100 → 10% drawdown
      expect(rm.getDrawdownPct()).toBeCloseTo(10, 1);
    });

    it('updates peak on profit', () => {
      const rm = makeManager(1000);
      rm.closePosition(0, 200); // gain $200 → new peak $1200
      rm.closePosition(0, -100); // lose $100 → bankroll $1100
      // drawdown from $1200 peak = 100/1200 = 8.33%
      expect(rm.getDrawdownPct()).toBeCloseTo(8.33, 1);
    });
  });

  // ----------------------------------------
  // getStatus structure
  // ----------------------------------------
  describe('getStatus', () => {
    it('returns all required fields including emergencyStop', () => {
      const rm = makeManager();
      const status = rm.getStatus();
      expect(status).toHaveProperty('bankroll');
      expect(status).toHaveProperty('peakBankroll');
      expect(status).toHaveProperty('drawdownPct');
      expect(status).toHaveProperty('totalExposure');
      expect(status).toHaveProperty('positionCount');
      expect(status).toHaveProperty('dailyLoss');
      expect(status).toHaveProperty('circuitBreaker');
      expect(status).toHaveProperty('emergencyStop');
      expect(status).toHaveProperty('maxExposure');
    });

    it('maxExposure equals bankroll * 0.50', () => {
      const rm = makeManager(1000);
      const status = rm.getStatus();
      expect(status.maxExposure).toBeCloseTo(500, 1);
    });

    it('emergencyStop is false initially', () => {
      const rm = makeManager();
      expect(rm.getStatus().emergencyStop).toBe(false);
    });
  });

  // ----------------------------------------
  // Emergency stop (25% drawdown)
  // ----------------------------------------
  describe('emergency stop (25% drawdown)', () => {
    it('activates emergencyStop at >= 25% drawdown', () => {
      const rm = makeManager(1000);
      rm.closePosition(0, -250); // 25% drawdown
      rm.checkTrade(10, 'market-new'); // trigger activation
      expect(rm.getStatus().emergencyStop).toBe(true);
    });

    it('blocks all trades once emergencyStop is active', () => {
      const rm = makeManager(1000);
      rm.closePosition(0, -300); // 30% drawdown → emergency
      rm.checkTrade(1, 'trigger');

      const r1 = rm.checkTrade(5, 'market-1');
      const r2 = rm.checkTrade(5, 'market-2');
      expect(r1.allowed).toBe(false);
      expect(r2.allowed).toBe(false);
    });

    it('emergency stop reason mentions emergency', () => {
      const rm = makeManager(1000);
      rm.closePosition(0, -260);
      const result = rm.checkTrade(1, 'trigger');
      expect(result.reason).toMatch(/emergência|emergency/i);
    });

    it('resetEmergencyStop() clears emergencyStop and circuitBreaker flags', () => {
      const rm = makeManager(1000);
      rm.closePosition(0, -300);
      rm.checkTrade(1, 'trigger');
      expect(rm.getStatus().emergencyStop).toBe(true);

      rm.resetEmergencyStop();
      expect(rm.getStatus().emergencyStop).toBe(false);
      expect(rm.getStatus().circuitBreaker).toBe(false);
    });

    it('emergency stop is permanent — circuit breaker reset does NOT clear it', () => {
      const rm = makeManager(1000);
      rm.closePosition(0, -300);
      rm.checkTrade(1, 'trigger');

      rm.resetCircuitBreaker(); // only resets circuit breaker, not emergency stop
      expect(rm.getStatus().emergencyStop).toBe(true);
    });
  });

  // ----------------------------------------
  // getCategoryKellyDiscount
  // ----------------------------------------
  describe('getCategoryKellyDiscount', () => {
    it('returns 1.0 with 0 positions in category', () => {
      const rm = makeManager();
      expect(rm.getCategoryKellyDiscount('Will Bitcoin reach $100k?')).toBe(1.0);
    });

    it('returns 0.75 with 1 position in same category', () => {
      const rm = makeManager();
      rm.registerPosition(30, 'trade-1', 'Will Bitcoin rally this year?');
      expect(rm.getCategoryKellyDiscount('Will Ethereum reach $5000?')).toBe(0.75);
    });

    it('returns 0.55 with 2 positions in same category', () => {
      const rm = makeManager();
      rm.registerPosition(20, 'trade-1', 'Will Bitcoin rally?');
      rm.registerPosition(20, 'trade-2', 'Will Ethereum reach $5000?');
      expect(rm.getCategoryKellyDiscount('Will Solana break $200?')).toBe(0.55);
    });

    it('returns 0.40 with 3+ positions in same category', () => {
      const rm = makeManager();
      rm.registerPosition(10, 'trade-1', 'Will Bitcoin hit $100k?');
      rm.registerPosition(10, 'trade-2', 'Will Ethereum reach $5000?');
      rm.registerPosition(10, 'trade-3', 'Will Solana break $200?');
      // BTC is also detected as 'Crypto' → 4th position in same category
      expect(rm.getCategoryKellyDiscount('Will BTC drop below $50k?')).toBe(0.40);
    });
  });

  // ----------------------------------------
  // getDynamicKellyMultiplier
  // ----------------------------------------
  describe('getDynamicKellyMultiplier', () => {
    it('returns 1.0 at 0% drawdown', () => {
      const rm = makeManager(1000);
      expect(rm.getDynamicKellyMultiplier()).toBe(1.0);
    });

    it('returns 0.75 at 2–5% drawdown', () => {
      const rm = makeManager(1000);
      rm.closePosition(0, -30); // 3% drawdown
      expect(rm.getDynamicKellyMultiplier()).toBe(0.75);
    });

    it('returns 0.50 at 5–10% drawdown', () => {
      const rm = makeManager(1000);
      rm.closePosition(0, -70); // 7% drawdown
      expect(rm.getDynamicKellyMultiplier()).toBe(0.50);
    });

    it('returns 0.25 at > 10% drawdown', () => {
      const rm = makeManager(1000);
      rm.closePosition(0, -120); // 12% drawdown
      expect(rm.getDynamicKellyMultiplier()).toBe(0.25);
    });
  });

  // ----------------------------------------
  // Category concentration limit
  // ----------------------------------------
  describe('category concentration (MAX_POSITIONS_PER_CATEGORY=3)', () => {
    it('blocks 4th trade in same category', () => {
      const rm = makeManager();
      rm.registerPosition(10, 'trade-1', 'Will Bitcoin hit $100k?');
      rm.registerPosition(10, 'trade-2', 'Will Ethereum reach $5000?');
      rm.registerPosition(10, 'trade-3', 'Will Solana break $200?');
      // 'eth' is also Crypto → 4th position should be blocked
      const result = rm.checkTrade(5, 'market-4', 'Will ETH hit $10k before year end?');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/categoria|category/i);
    });

    it('allows 3rd trade in same category', () => {
      const rm = makeManager();
      rm.registerPosition(10, 'trade-1', 'Will Bitcoin hit $100k?');
      rm.registerPosition(10, 'trade-2', 'Will Ethereum reach $5000?');
      const result = rm.checkTrade(5, 'market-3', 'Will Solana break $200?');
      expect(result.allowed).toBe(true);
    });
  });
});
