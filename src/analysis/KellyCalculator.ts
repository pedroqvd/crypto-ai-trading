// ================================================
// KELLY CALCULATOR — Optimal Position Sizing
// ================================================

import { config } from '../engine/Config';
import { logger } from '../utils/Logger';

export interface KellyResult {
  fullKellyFraction: number;
  fractionalKelly: number;
  recommendedStake: number;
  maxStake: number;
  finalStake: number;
  justification: string;
}

const MIN_BET_SIZE = 1; // Minimum $1 bet
const TAKER_FEE = 0.02; // Polymarket taker fee ~2%

export class KellyCalculator {

  /**
   * Kelly Criterion for binary prediction markets with taker fee:
   *
   *   b_net = ((1 - q) / q) * (1 - fee)   net payoff odds after fee
   *   f* = (b_net * p - (1 - p)) / b_net
   *      = p - (1 - p) * q / ((1 - q) * (1 - fee))
   *
   * Where p = P_true, q = P_implied (market price)
   */
  /**
   * @param correlationDiscount 0–1 multiplier applied to finalStake when we already
   *   hold positions in the same market category (reduces Kelly to avoid over-concentration).
   *   1.0 = no discount, 0.5 = half-Kelly when category is saturated.
   */
  calculate(
    pTrue: number,
    pImplied: number,
    currentBankroll: number,
    marketLiquidity: number,
    correlationDiscount = 1.0,
    dynamicMultiplier = 1.0
  ): KellyResult {
    const p = Math.max(0.01, Math.min(0.99, pTrue));
    const q = Math.max(0.01, Math.min(0.99, pImplied));

    // Net payoff odds after taker fee
    const bNet = ((1 - q) / q) * (1 - TAKER_FEE);

    // Kelly formula with fee included
    const fullKelly = (bNet * p - (1 - p)) / bNet;

    if (fullKelly <= 0) {
      return {
        fullKellyFraction: fullKelly,
        fractionalKelly: 0,
        recommendedStake: 0,
        maxStake: 0,
        finalStake: 0,
        justification: `Kelly negativo (f*=${fullKelly.toFixed(4)}). Sem edge após taxas, não apostar.`,
      };
    }

    const fractional = fullKelly * config.kellyFraction * dynamicMultiplier;
    const recommended = currentBankroll * fractional;

    // Skip trade if Kelly recommendation is below minimum bet — don't force small bets
    if (recommended < MIN_BET_SIZE) {
      return {
        fullKellyFraction: fullKelly,
        fractionalKelly: fractional,
        recommendedStake: recommended,
        maxStake: 0,
        finalStake: 0,
        justification: `Kelly recomenda $${recommended.toFixed(2)} < mínimo ($${MIN_BET_SIZE}). Edge insuficiente para o bankroll atual.`,
      };
    }

    const maxByPosition = currentBankroll * config.maxPositionPct;
    const maxByLiquidity = marketLiquidity * 0.10;
    const maxStake = Math.min(maxByPosition, maxByLiquidity);

    // Apply correlation discount to reduce concentration in same-category positions
    const discount = Math.max(0.1, Math.min(1.0, correlationDiscount));
    const finalStake = Math.min(recommended, maxStake) * discount;

    const justification = this.buildJustification(
      fullKelly, fractional, recommended, maxStake, finalStake,
      p, q, currentBankroll, marketLiquidity, discount
    );

    logger.debug('Kelly', `p=${p.toFixed(3)} q=${q.toFixed(3)} bNet=${bNet.toFixed(3)} f*=${fullKelly.toFixed(4)} → $${finalStake.toFixed(2)}`);

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
    liquidity: number,
    discount: number
  ): string {
    let reason = `Kelly (c/taxa): f*=${(fullKelly * 100).toFixed(2)}%, `;
    reason += `fração=${(fractional * 100).toFixed(2)}%, `;
    reason += `recomendado=$${recommended.toFixed(2)}. `;

    const cappedStake = Math.min(recommended, maxStake);
    if (cappedStake < recommended) {
      if (maxStake === bankroll * config.maxPositionPct) {
        reason += `Limitado pelo cap de posição (${(config.maxPositionPct * 100).toFixed(0)}% do bankroll). `;
      } else {
        reason += `Limitado pela liquidez do mercado ($${liquidity.toFixed(0)}). `;
      }
    }

    if (discount < 0.99) {
      reason += `Desconto de correlação: ${(discount * 100).toFixed(0)}% (posição na mesma categoria). `;
    }

    reason += `Stake final: $${finalStake.toFixed(2)} (${((finalStake / bankroll) * 100).toFixed(1)}% do bankroll).`;
    return reason;
  }
}
