// ================================================
// RISK MANAGER — Portfolio Protection
// ================================================

import { config } from '../engine/Config';
import { logger } from '../utils/Logger';
import { TradeJournal } from '../utils/TradeJournal';

export interface RiskCheck {
  allowed: boolean;
  reason: string;
  currentExposure: number;
  maxExposure: number;
  drawdownPct: number;
}

// Maximum positions per category to prevent over-concentration
const MAX_POSITIONS_PER_CATEGORY = 3;
// When category count hits this, apply Kelly discount
const CATEGORY_DISCOUNT_THRESHOLD = 2;

// Infer category from question text (mirrors PerformanceMetrics)
function detectCategory(question: string): string {
  const q = question.toLowerCase();
  if (/\b(bitcoin|btc|ethereum|eth|crypto|defi|nft|blockchain|solana|sol)\b/.test(q)) return 'Crypto';
  if (/\b(election|president|vote|senator|congress|governor|parliament|prime minister)\b/.test(q)) return 'Politics';
  if (/\b(fed|interest rate|inflation|gdp|recession|economy|employment|cpi)\b/.test(q)) return 'Economics';
  if (/\b(nba|nfl|nhl|mlb|soccer|football|basketball|tennis|golf|olympic)\b/.test(q)) return 'Sports';
  if (/\b(ai|artificial intelligence|chatgpt|openai|google|microsoft|apple|meta|amazon)\b/.test(q)) return 'Tech / AI';
  if (/\b(war|conflict|military|nato|russia|ukraine|china|taiwan|iran|north korea)\b/.test(q)) return 'Geopolitics';
  if (/\b(climate|carbon|temperature|hurricane|earthquake|weather|environment)\b/.test(q)) return 'Science / Climate';
  if (/\b(covid|vaccine|fda|drug|clinical trial|cancer|disease|pandemic)\b/.test(q)) return 'Health / Bio';
  return 'Other';
}

// Circuit breaker cooldown: 2 hours. If no positions close to push drawdown below 5%,
// auto-release after this period so the bot is not stuck indefinitely.
const CIRCUIT_BREAKER_COOLDOWN_MS = 2 * 60 * 60 * 1000;

export class RiskManager {
  private peakBankroll: number;
  private currentBankroll: number;
  private totalExposure: number = 0;
  private positionCount: number = 0;
  private dailyLoss: number = 0;
  private lastDayReset: string = '';
  private circuitBreakerActive: boolean = false;
  private circuitBreakerActivatedAt: number = 0;
  // category → stake exposure
  private categoryExposure = new Map<string, number>();
  // tradeId → category (to deregister correctly on close)
  private tradeCategories = new Map<string, string>();

  constructor(private journal: TradeJournal) {
    this.currentBankroll = config.bankroll;
    this.peakBankroll = config.bankroll;
    this.resetDailyIfNeeded();
  }

  /**
   * Returns a 0–1 Kelly discount based on how many open positions we
   * already have in the same category as `question`.
   *   0 positions in category → 1.0 (no discount)
   *   1 position             → 0.75
   *   2 positions            → 0.55
   *   3+ positions           → 0.40
   */
  getCategoryKellyDiscount(question: string): number {
    const cat = detectCategory(question);
    const positionsInCat = [...this.tradeCategories.values()].filter(c => c === cat).length;

    if (positionsInCat === 0) return 1.0;
    if (positionsInCat === 1) return 0.75;
    if (positionsInCat === 2) return 0.55;
    return 0.40;
  }

  /**
   * Returns a 0-1 multiplier for the Kelly fraction based on current drawdown.
   * Compresses bets aggressively during bad streaks.
   */
  getDynamicKellyMultiplier(): number {
    const drawdown = this.getDrawdownPct();
    if (drawdown > 10) return 0.25; // 1/4 Kelly under severe stress
    if (drawdown > 5)  return 0.50; // 1/2 Kelly under moderate stress
    if (drawdown > 2)  return 0.75; // 3/4 Kelly
    return 1.0;                     // Full Kelly
  }

  checkTrade(stakeAmount: number, marketId: string, question?: string): RiskCheck {
    this.resetDailyIfNeeded();

    // Auto-release circuit breaker after cooldown period when drawdown recovered enough.
    if (this.circuitBreakerActive) {
      const elapsed = Date.now() - this.circuitBreakerActivatedAt;
      if (elapsed > CIRCUIT_BREAKER_COOLDOWN_MS && this.getDrawdownPct() < 10) {
        this.circuitBreakerActive = false;
        logger.info('RiskMgr', `🔄 Circuit breaker auto-liberado após ${(elapsed / 3_600_000).toFixed(1)}h (drawdown=${this.getDrawdownPct().toFixed(1)}%).`);
      }
    }

    if (this.circuitBreakerActive) {
      return {
        allowed: false,
        reason: '🚨 Circuit breaker ativo. Trading pausado após drawdown significativo.',
        currentExposure: this.totalExposure,
        maxExposure: this.currentBankroll * config.maxTotalExposurePct,
        drawdownPct: this.getDrawdownPct(),
      };
    }

    const drawdown = this.getDrawdownPct();
    if (drawdown >= 15) {
      this.circuitBreakerActive = true;
      this.circuitBreakerActivatedAt = Date.now();
      logger.warn('RiskMgr', `🚨 CIRCUIT BREAKER: Drawdown de ${drawdown.toFixed(1)}% atingido. Trading pausado.`);
      return {
        allowed: false,
        reason: `🚨 Drawdown de ${drawdown.toFixed(1)}% excedeu limite de 15%. Circuit breaker ativado.`,
        currentExposure: this.totalExposure,
        maxExposure: this.currentBankroll * config.maxTotalExposurePct,
        drawdownPct: drawdown,
      };
    }

    const maxExposure = this.currentBankroll * config.maxTotalExposurePct;
    if (this.totalExposure + stakeAmount > maxExposure) {
      return {
        allowed: false,
        reason: `Exposição total ($${(this.totalExposure + stakeAmount).toFixed(0)}) excederia limite ($${maxExposure.toFixed(0)}).`,
        currentExposure: this.totalExposure,
        maxExposure,
        drawdownPct: drawdown,
      };
    }

    const maxPosition = this.currentBankroll * config.maxPositionPct;
    if (stakeAmount > maxPosition) {
      return {
        allowed: false,
        reason: `Stake ($${stakeAmount.toFixed(0)}) excede limite por posição ($${maxPosition.toFixed(0)}).`,
        currentExposure: this.totalExposure,
        maxExposure,
        drawdownPct: drawdown,
      };
    }

    const dailyLossLimit = this.currentBankroll * 0.10;
    if (this.dailyLoss >= dailyLossLimit) {
      return {
        allowed: false,
        reason: `Perda diária ($${this.dailyLoss.toFixed(0)}) atingiu limite ($${dailyLossLimit.toFixed(0)}). Parado por hoje.`,
        currentExposure: this.totalExposure,
        maxExposure,
        drawdownPct: drawdown,
      };
    }

    // Category concentration check
    if (question) {
      const cat = detectCategory(question);
      const positionsInCat = [...this.tradeCategories.values()].filter(c => c === cat).length;
      if (positionsInCat >= MAX_POSITIONS_PER_CATEGORY) {
        return {
          allowed: false,
          reason: `Máximo de ${MAX_POSITIONS_PER_CATEGORY} posições na categoria "${cat}" atingido.`,
          currentExposure: this.totalExposure,
          maxExposure,
          drawdownPct: drawdown,
        };
      }
    }

    return {
      allowed: true,
      reason: 'Trade dentro dos limites de risco.',
      currentExposure: this.totalExposure,
      maxExposure,
      drawdownPct: drawdown,
    };
  }

  registerPosition(stake: number, tradeId?: string, question?: string): void {
    this.totalExposure += stake;
    this.positionCount++;
    if (tradeId && question) {
      const cat = detectCategory(question);
      this.tradeCategories.set(tradeId, cat);
      this.categoryExposure.set(cat, (this.categoryExposure.get(cat) ?? 0) + stake);
    }
    logger.debug('RiskMgr', `Posição registrada: +$${stake.toFixed(2)}. Exposição total: $${this.totalExposure.toFixed(2)}`);
  }

  closePosition(stake: number, pnl: number, tradeId?: string): void {
    this.totalExposure = Math.max(0, this.totalExposure - stake);
    this.positionCount = Math.max(0, this.positionCount - 1);
    if (tradeId) {
      const cat = this.tradeCategories.get(tradeId);
      if (cat) {
        const prev = this.categoryExposure.get(cat) ?? 0;
        this.categoryExposure.set(cat, Math.max(0, prev - stake));
        this.tradeCategories.delete(tradeId);
      }
    }
    this.currentBankroll += pnl;

    if (pnl < 0) {
      this.dailyLoss += Math.abs(pnl);
    }

    if (this.currentBankroll > this.peakBankroll) {
      this.peakBankroll = this.currentBankroll;
    }

    // Auto-reset circuit breaker quando drawdown se recupera abaixo de 5%
    if (this.circuitBreakerActive && this.getDrawdownPct() < 5) {
      this.circuitBreakerActive = false;
      logger.info('RiskMgr', '🔄 Circuit breaker auto-resetado: drawdown se recuperou abaixo de 5%.');
    }

    logger.debug('RiskMgr', `Posição fechada. P&L: $${pnl.toFixed(2)}. Bankroll: $${this.currentBankroll.toFixed(2)}`);
  }

  resetCircuitBreaker(): void {
    this.circuitBreakerActive = false;
    logger.info('RiskMgr', '🔄 Circuit breaker resetado manualmente.');
  }

  getDrawdownPct(): number {
    if (this.peakBankroll <= 0) return 0;
    return ((this.peakBankroll - this.currentBankroll) / this.peakBankroll) * 100;
  }

  getStatus(): {
    bankroll: number;
    peakBankroll: number;
    drawdownPct: number;
    totalExposure: number;
    positionCount: number;
    dailyLoss: number;
    circuitBreaker: boolean;
    maxExposure: number;
    categoryExposure: Record<string, number>;
  } {
    return {
      bankroll: this.currentBankroll,
      peakBankroll: this.peakBankroll,
      drawdownPct: this.getDrawdownPct(),
      totalExposure: this.totalExposure,
      positionCount: this.positionCount,
      dailyLoss: this.dailyLoss,
      circuitBreaker: this.circuitBreakerActive,
      maxExposure: this.currentBankroll * config.maxTotalExposurePct,
      categoryExposure: Object.fromEntries(this.categoryExposure),
    };
  }

  updateBankroll(newBankroll: number): void {
    this.currentBankroll = newBankroll;
    if (newBankroll > this.peakBankroll) {
      this.peakBankroll = newBankroll;
    }
  }

  private resetDailyIfNeeded(): void {
    const today = new Date().toISOString().split('T')[0];
    if (today !== this.lastDayReset) {
      this.dailyLoss = 0;
      this.lastDayReset = today;
    }
  }
}
