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

export class RiskManager {
  private peakBankroll: number;
  private currentBankroll: number;
  private totalExposure: number = 0;
  private positionCount: number = 0;
  private dailyLoss: number = 0;
  private lastDayReset: string = '';
  private circuitBreakerActive: boolean = false;

  constructor(private journal: TradeJournal) {
    this.currentBankroll = config.bankroll;
    this.peakBankroll = config.bankroll;
    this.resetDailyIfNeeded();
  }

  /**
   * Check if a new trade is allowed given current risk state
   */
  checkTrade(stakeAmount: number, marketId: string): RiskCheck {
    this.resetDailyIfNeeded();

    // Circuit breaker
    if (this.circuitBreakerActive) {
      return {
        allowed: false,
        reason: '🚨 Circuit breaker ativo. Trading pausado após drawdown significativo.',
        currentExposure: this.totalExposure,
        maxExposure: this.currentBankroll * config.maxTotalExposurePct,
        drawdownPct: this.getDrawdownPct(),
      };
    }

    // Check drawdown
    const drawdown = this.getDrawdownPct();
    if (drawdown >= 15) {
      this.circuitBreakerActive = true;
      logger.warn('RiskMgr', `🚨 CIRCUIT BREAKER: Drawdown de ${drawdown.toFixed(1)}% atingido. Trading pausado.`);
      return {
        allowed: false,
        reason: `🚨 Drawdown de ${drawdown.toFixed(1)}% excedeu limite de 15%. Circuit breaker ativado.`,
        currentExposure: this.totalExposure,
        maxExposure: this.currentBankroll * config.maxTotalExposurePct,
        drawdownPct: drawdown,
      };
    }

    // Check total exposure
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

    // Check position size
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

    // Check daily loss limit (10% of bankroll)
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

    return {
      allowed: true,
      reason: 'Trade dentro dos limites de risco.',
      currentExposure: this.totalExposure,
      maxExposure,
      drawdownPct: drawdown,
    };
  }

  /**
   * Register a new position
   */
  registerPosition(stake: number): void {
    this.totalExposure += stake;
    this.positionCount++;
    logger.debug('RiskMgr', `Posição registrada: +$${stake.toFixed(2)}. Exposição total: $${this.totalExposure.toFixed(2)}`);
  }

  /**
   * Close a position and update P&L
   */
  closePosition(stake: number, pnl: number): void {
    this.totalExposure = Math.max(0, this.totalExposure - stake);
    this.positionCount = Math.max(0, this.positionCount - 1);
    this.currentBankroll += pnl;

    if (pnl < 0) {
      this.dailyLoss += Math.abs(pnl);
    }

    // Update peak
    if (this.currentBankroll > this.peakBankroll) {
      this.peakBankroll = this.currentBankroll;
    }

    logger.debug('RiskMgr', `Posição fechada. P&L: $${pnl.toFixed(2)}. Bankroll: $${this.currentBankroll.toFixed(2)}`);
  }

  /**
   * Reset circuit breaker (manual override)
   */
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
