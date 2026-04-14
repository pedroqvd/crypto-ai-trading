// ================================================
// KELLY CALCULATOR — Optimal Position Sizing
// ================================================

import { config } from '../engine/Config';
import { logger } from '../utils/Logger';

export interface KellyResult {
  fullKellyFraction: number;    // f* = (p - q) / (1 - q)
  fractionalKelly: number;      // f* × KELLY_FRACTION
  recommendedStake: number;     // fractionalKelly × BANKROLL
  maxStake: number;             // Capped by risk limits
  finalStake: number;           // min(recommended, max) — the actual bet
  justification: string;        // Human-readable explanation
}

const MIN_BET_SIZE = 1; // Minimum $1 bet

export class KellyCalculator {

  /**
   * Kelly Criterion for binary prediction markets:
   * 
   *   f* = (p - q) / (1 - q)
   * 
   * Where:
   *   p = P_true (estimated true probability)
   *   q = P_implied (market price)
   *   f* = optimal fraction of bankroll to bet
   * 
   * We use Fractional Kelly for safety:
   *   stake = bankroll × (KELLY_FRACTION × f*)
   * 
   * With hard caps:
   *   stake ≤ bankroll × MAX_POSITION_PCT
   *   stake ≤ market_liquidity × 0.10 (don't move the market)
   */
  calculate(
    pTrue: number,
    pImplied: number,
    currentBankroll: number,
    marketLiquidity: number
  ): KellyResult {
    // Validate inputs
    const p = Math.max(0.01, Math.min(0.99, pTrue));
    const q = Math.max(0.01, Math.min(0.99, pImplied));

    // Kelly formula
    const fullKelly = (p - q) / (1 - q);

    // If Kelly is negative or zero, don't bet
    if (fullKelly <= 0) {
      return {
        fullKellyFraction: fullKelly,
        fractionalKelly: 0,
        recommendedStake: 0,
        maxStake: 0,
        finalStake: 0,
        justification: `Kelly negativo (f*=${fullKelly.toFixed(4)}). Sem edge, não apostar.`,
      };
    }

    // Fractional Kelly
    const fractional = fullKelly * config.kellyFraction;

    // Recommended stake
    const recommended = currentBankroll * fractional;

    // Hard caps
    const maxByPosition = currentBankroll * config.maxPositionPct;
    const maxByLiquidity = marketLiquidity * 0.10; // Don't take more than 10% of liquidity
    const maxStake = Math.min(maxByPosition, maxByLiquidity);

    // Final stake
    let finalStake = Math.min(recommended, maxStake);
    finalStake = Math.max(finalStake, MIN_BET_SIZE); // At least $1

    // If final stake is more than bankroll allows, cap it
    if (finalStake > currentBankroll * 0.5) {
      finalStake = currentBankroll * 0.5; // Never bet more than 50% of bankroll
    }

    const justification = this.buildJustification(
      fullKelly, fractional, recommended, maxStake, finalStake,
      p, q, currentBankroll, marketLiquidity
    );

    logger.debug('Kelly', `p=${p.toFixed(3)} q=${q.toFixed(3)} f*=${fullKelly.toFixed(4)} → $${finalStake.toFixed(2)}`);

    return {
      fullKellyFraction: fullKelly,
      fractionalKelly: fractional,
      recommendedStake: recommended,
      maxStake,
      finalStake,
      justification,
    };
  }

  private buildJustification(
    fullKelly: number,
    fractional: number,
    recommended: number,
    maxStake: number,
    finalStake: number,
    p: number,
    q: number,
    bankroll: number,
    liquidity: number
  ): string {
    let reason = `Kelly: f*=${(fullKelly * 100).toFixed(2)}%, `;
    reason += `fração=${(fractional * 100).toFixed(2)}%, `;
    reason += `recomendado=$${recommended.toFixed(2)}. `;

    if (finalStake < recommended) {
      if (recommended > maxStake) {
        if (maxStake === bankroll * config.maxPositionPct) {
          reason += `Limitado pelo cap de posição (${(config.maxPositionPct * 100).toFixed(0)}% do bankroll). `;
        } else {
          reason += `Limitado pela liquidez do mercado ($${liquidity.toFixed(0)}). `;
        }
      }
    }

    reason += `Stake final: $${finalStake.toFixed(2)} (${((finalStake / bankroll) * 100).toFixed(1)}% do bankroll).`;
    return reason;
  }
}
