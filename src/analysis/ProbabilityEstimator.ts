// ================================================
// PROBABILITY ESTIMATOR — True Probability Model
// Phase 1: Heuristic signals with consensus gating
// ================================================

import { ParsedMarket } from '../services/GammaApiClient';
import { NewsResult } from '../services/NewsApiClient';
import { logger } from '../utils/Logger';

export interface ProbabilityEstimate {
  marketId: string;
  question: string;
  marketPrice: number;           // Current implied probability
  estimatedTrueProb: number;     // Our estimate of true probability
  confidence: number;            // 0-1, how confident we are
  signals: SignalResult[];       // Individual signal contributions
}

interface SignalResult {
  name: string;
  weight: number;
  adjustment: number;            // +/- adjustment to market price
  reasoning: string;
}

export class ProbabilityEstimator {

  /**
   * Estimate the true probability of a market outcome.
   *
   * Phase 1 (Heuristic) — Uses 8 market microstructure signals:
   * 1. Volume/Liquidity ratio:  High volume with low liquidity suggests hidden info
   * 2. Price extremity:         Markets near 0% or 100% are harder to misprice
   * 3. Time to expiry:          Near-expiry markets are more efficiently priced
   * 4. Bid-ask spread proxy:    Large gap between yes+no vs 1.0 suggests inefficiency
   * 5. Volume momentum:         Markets with relative volume outliers may be mispriced
   * 6. Liquidity mean reversion: Low-liquidity + price away from 50% → likely mispriced
   * 7. Market calibration:      High-turnover / tight-spread markets are well-calibrated
   *                             (dilutes other signals by adding a 0-adjustment weight)
   * 8. Market age:              Brand-new markets have higher mispricing potential
   *
   * Final adjustment is gated by:
   *  - Consensus ratio: only applies strongly when ≥70% of signal weight agrees on direction
   *  - Liquidity dampening: high-liquidity markets get smaller adjustments (0.35×–1.0×)
   *  - Hard cap: |adjustment| ≤ 0.05 (max 5 percentage-point shift from market price)
   *
   * Optional news boost: when newsResult is provided and has fresh articles,
   * confidence is raised to reflect the increased certainty of our estimate.
   */
  estimate(
    market: ParsedMarket,
    allMarkets?: ParsedMarket[],
    medianVolume?: number,
    newsResult?: NewsResult
  ): ProbabilityEstimate {
    const signals: SignalResult[] = [];
    const marketPrice = market.yesPrice;

    // Collect all signals
    signals.push(this.volumeLiquiditySignal(market));
    signals.push(this.priceExtremitySignal(market));
    signals.push(this.timeDecaySignal(market));
    signals.push(this.spreadInefficiencySignal(market));
    signals.push(this.volumeSignificanceSignal(market, allMarkets, medianVolume));
    signals.push(this.liquidityMeanReversionSignal(market));
    signals.push(this.marketCalibrationSignal(market));
    signals.push(this.marketAgeSignal(market));   // Signal 8 — new

    // Weighted average of all adjustments
    let totalWeight = 0;
    let weightedAdjustment = 0;
    for (const signal of signals) {
      totalWeight += signal.weight;
      weightedAdjustment += signal.adjustment * signal.weight;
    }
    const avgAdjustment = totalWeight > 0 ? weightedAdjustment / totalWeight : 0;

    // ── CONSENSUS GATE ──────────────────────────────────────────────────
    // Only apply strong adjustments when signals agree on direction.
    // Signals with |adjustment| < 0.003 are treated as neutral (no vote).
    const significantSignals = signals.filter(s => Math.abs(s.adjustment) > 0.003);
    const totalSigWeight = significantSignals.reduce((sum, s) => sum + s.weight, 0);
    const positiveWeight = significantSignals
      .filter(s => s.adjustment > 0)
      .reduce((sum, s) => sum + s.weight, 0);
    const negativeWeight = significantSignals
      .filter(s => s.adjustment < 0)
      .reduce((sum, s) => sum + s.weight, 0);
    const dominantWeight = Math.max(positiveWeight, negativeWeight);
    const consensusRatio = totalSigWeight > 0 ? dominantWeight / totalSigWeight : 0;

    // Multiplier: full weight only when ≥70% of signal weight agrees
    const consensusMultiplier =
      consensusRatio >= 0.70 ? 1.00 :
      consensusRatio >= 0.55 ? 0.50 :
      totalSigWeight === 0   ? 0.00 :
                               0.15; // Signals conflict → nearly no adjustment

    // ── LIQUIDITY DAMPENING ─────────────────────────────────────────────
    // High-liquidity markets have more participants → prices are more efficient.
    const liquidityDampening =
      market.liquidity >= 100_000 ? 0.35 :
      market.liquidity >=  50_000 ? 0.60 :
      market.liquidity >=  20_000 ? 0.80 :
                                    1.00;

    // ── FINAL ADJUSTMENT ────────────────────────────────────────────────
    // Combine and cap at ±5% to prevent large false-positive edges.
    const finalAdjustment = Math.max(-0.05, Math.min(0.05,
      avgAdjustment * consensusMultiplier * liquidityDampening
    ));

    let estimatedTrueProb = marketPrice + finalAdjustment;
    estimatedTrueProb = Math.max(0.01, Math.min(0.99, estimatedTrueProb));

    // ── CONFIDENCE (with optional news boost) ───────────────────────────
    const confidence = this.calculateConfidence(signals, market, consensusRatio, estimatedTrueProb, newsResult);

    logger.debug('ProbEst',
      `"${market.question.substring(0, 40)}..." → Mkt: ${(marketPrice * 100).toFixed(0)}%, ` +
      `Est: ${(estimatedTrueProb * 100).toFixed(0)}%, Adj: ${(finalAdjustment * 100).toFixed(1)}%, ` +
      `Consensus: ${(consensusRatio * 100).toFixed(0)}%, Conf: ${(confidence * 100).toFixed(0)}%` +
      (newsResult?.hasRecentNews ? ` 📰 news:${newsResult.sentiment ?? 'mixed'}` : '')
    );

    return {
      marketId: market.id,
      question: market.question,
      marketPrice,
      estimatedTrueProb,
      confidence,
      signals,
    };
  }

  // ========================================
  // SIGNAL 1: Volume/Liquidity Ratio
  // ========================================
  private volumeLiquiditySignal(market: ParsedMarket): SignalResult {
    const ratio = market.liquidity > 0 ? market.volume / market.liquidity : 0;

    let adjustment = 0;
    let reasoning = '';

    if (ratio > 20) {
      adjustment = -0.015 * (market.yesPrice - 0.5);
      reasoning = `Volume/Liquidez extremo (${ratio.toFixed(0)}x). Mercado provavelmente eficiente, leve reversão.`;
    } else if (ratio > 5) {
      adjustment = 0.01 * Math.sign(market.yesPrice - 0.5);
      reasoning = `Volume/Liquidez moderado (${ratio.toFixed(0)}x). Confirmação da direção.`;
    } else if (ratio < 1) {
      adjustment = 0.04 * (0.5 - market.yesPrice);
      reasoning = `Volume/Liquidez baixo (${ratio.toFixed(1)}x). Mercado estagnado — possível mispricing.`;
    } else {
      reasoning = `Volume/Liquidez normal (${ratio.toFixed(1)}x). Sem sinal forte.`;
    }

    return { name: 'Volume/Liquidity', weight: 1.5, adjustment, reasoning };
  }

  // ========================================
  // SIGNAL 2: Price Extremity
  // ========================================
  private priceExtremitySignal(market: ParsedMarket): SignalResult {
    const distFrom50 = Math.abs(market.yesPrice - 0.5);

    let adjustment = 0;
    let reasoning = '';

    if (distFrom50 > 0.4) {
      adjustment = 0;
      reasoning = `Preço extremo (${(market.yesPrice * 100).toFixed(0)}%). Sem ajuste — consenso forte.`;
    } else if (distFrom50 > 0.25) {
      adjustment = -0.005 * Math.sign(market.yesPrice - 0.5);
      reasoning = `Preço moderado (${(market.yesPrice * 100).toFixed(0)}%). Leve reversão à média.`;
    } else {
      adjustment = 0;
      reasoning = `Preço próximo de 50% (${(market.yesPrice * 100).toFixed(0)}%). Incerteza máxima.`;
    }

    return { name: 'Price Extremity', weight: 1.0, adjustment, reasoning };
  }

  // ========================================
  // SIGNAL 3: Time Decay
  // ========================================
  private timeDecaySignal(market: ParsedMarket): SignalResult {
    if (!market.endDate) {
      return { name: 'Time Decay', weight: 0.5, adjustment: 0, reasoning: 'Sem data de expiração.' };
    }

    const now = Date.now();
    const end = new Date(market.endDate).getTime();
    const hoursRemaining = (end - now) / (1000 * 60 * 60);

    let adjustment = 0;
    let reasoning = '';

    if (hoursRemaining < 24) {
      adjustment = 0;
      reasoning = `<24h para expirar. Mercado altamente eficiente — sem ajuste.`;
    } else if (hoursRemaining < 72) {
      adjustment = -0.005 * Math.sign(market.yesPrice - 0.5);
      reasoning = `${Math.round(hoursRemaining)}h para expirar. Eficiência moderada.`;
    } else if (hoursRemaining > 720) {
      adjustment = 0.01 * (0.5 - market.yesPrice);
      reasoning = `${Math.round(hoursRemaining / 24)} dias restantes. Mais espaço para mispricing.`;
    } else {
      reasoning = `${Math.round(hoursRemaining / 24)} dias restantes. Neutro.`;
    }

    return { name: 'Time Decay', weight: 1.2, adjustment, reasoning };
  }

  // ========================================
  // SIGNAL 4: Spread / Inefficiency
  // ========================================
  private spreadInefficiencySignal(market: ParsedMarket): SignalResult {
    const sum = market.yesPrice + market.noPrice;
    const spread = Math.abs(sum - 1.0);

    let adjustment = 0;
    let reasoning = '';

    if (spread > 0.05) {
      if (sum < 1.0) {
        adjustment = 0.02;
        reasoning = `Spread alto (soma=${sum.toFixed(3)}). Ambos os lados estão baratos.`;
      } else {
        adjustment = -0.02;
        reasoning = `Spread alto (soma=${sum.toFixed(3)}). Ambos os lados estão caros.`;
      }
    } else if (spread > 0.02) {
      adjustment = spread * 0.5 * (sum < 1 ? 1 : -1);
      reasoning = `Spread moderado (soma=${sum.toFixed(3)}). Leve oportunidade.`;
    } else {
      reasoning = `Spread pequeno (soma=${sum.toFixed(3)}). Mercado eficiente.`;
    }

    return { name: 'Spread/Inefficiency', weight: 2.0, adjustment, reasoning };
  }

  // ========================================
  // SIGNAL 5: Volume Significance
  // Pre-calculated medianVolume avoids N×M recalculation
  // ========================================
  private volumeSignificanceSignal(market: ParsedMarket, allMarkets?: ParsedMarket[], medianVolume?: number): SignalResult {
    let calcMedianVolume = medianVolume;
    
    if (calcMedianVolume === undefined) {
      if (!allMarkets || allMarkets.length === 0) {
        return { name: 'Volume Significance', weight: 0.5, adjustment: 0, reasoning: 'Sem dados comparativos.' };
      }
      const volumes = allMarkets.map(m => m.volume).sort((a, b) => a - b);
      calcMedianVolume = volumes[Math.floor(volumes.length / 2)];
    }

    const ratio = calcMedianVolume > 0 ? market.volume / calcMedianVolume : 1;

    let adjustment = 0;
    let reasoning = '';

    if (ratio > 10) {
      adjustment = 0;
      reasoning = `Volume ${ratio.toFixed(0)}x acima da mediana. Mercado muito líquido e eficiente.`;
    } else if (ratio < 0.1) {
      adjustment = 0.015 * (0.5 - market.yesPrice);
      reasoning = `Volume ${ratio.toFixed(2)}x abaixo da mediana. Possível mispricing, mas baixa confiança.`;
    } else {
      reasoning = `Volume normal (${ratio.toFixed(1)}x da mediana).`;
    }

    return { name: 'Volume Significance', weight: 1.0, adjustment, reasoning };
  }

  // ========================================
  // SIGNAL 6: Liquidity Mean Reversion
  // ========================================
  private liquidityMeanReversionSignal(market: ParsedMarket): SignalResult {
    const distFrom50 = Math.abs(market.yesPrice - 0.5);
    const direction = Math.sign(0.5 - market.yesPrice);

    let adjustment = 0;
    let reasoning = '';

    if (market.liquidity < 15000 && distFrom50 > 0.1) {
      adjustment = 0.04 * direction;
      reasoning = `Baixa liquidez ($${(market.liquidity / 1000).toFixed(0)}K) com preço ${(market.yesPrice * 100).toFixed(0)}%. Forte sinal de mispricing.`;
    } else if (market.liquidity < 30000 && distFrom50 > 0.15) {
      adjustment = 0.025 * direction;
      reasoning = `Liquidez moderada ($${(market.liquidity / 1000).toFixed(0)}K) com preço ${(market.yesPrice * 100).toFixed(0)}%. Possível mispricing.`;
    } else if (market.liquidity < 50000 && distFrom50 > 0.25) {
      adjustment = 0.015 * direction;
      reasoning = `Liquidez ok ($${(market.liquidity / 1000).toFixed(0)}K) mas preço extremo (${(market.yesPrice * 100).toFixed(0)}%). Leve oportunidade.`;
    } else {
      reasoning = `Liquidez e preço dentro do normal. Sem sinal de mean-reversion.`;
    }

    return { name: 'Liquidity Mean Reversion', weight: 2.5, adjustment, reasoning };
  }

  // ========================================
  // SIGNAL 7: Market Calibration
  // Well-traded markets with tight spreads are efficiently priced.
  // Adds diluting weight with zero adjustment to trust market price.
  // ========================================
  private marketCalibrationSignal(market: ParsedMarket): SignalResult {
    const volLiqRatio = market.liquidity > 0 ? market.volume / market.liquidity : 0;
    const spread = Math.abs((market.yesPrice + market.noPrice) - 1.0);

    if (volLiqRatio > 15 && spread < 0.02 && market.liquidity > 50_000) {
      return {
        name: 'Market Calibration',
        weight: 3.0,
        adjustment: 0.0,
        reasoning: `Mercado altamente eficiente (vol/liq=${volLiqRatio.toFixed(0)}x, spread=${(spread * 100).toFixed(1)}%, liq=$${(market.liquidity / 1000).toFixed(0)}K). Confiar no preço de mercado.`,
      };
    }

    if (volLiqRatio > 5 && spread < 0.03) {
      return {
        name: 'Market Calibration',
        weight: 1.5,
        adjustment: 0.0,
        reasoning: `Mercado razoavelmente eficiente (vol/liq=${volLiqRatio.toFixed(0)}x, spread=${(spread * 100).toFixed(1)}%). Preço provavelmente calibrado.`,
      };
    }

    return {
      name: 'Market Calibration',
      weight: 0.5,
      adjustment: 0.0,
      reasoning: `Mercado pouco calibrado (vol/liq=${volLiqRatio.toFixed(1)}x, spread=${(spread * 100).toFixed(1)}%). Outros sinais têm mais influência.`,
    };
  }

  // ========================================
  // SIGNAL 8: Market Age (NEW)
  // Newly created markets have fewer participants and higher
  // mispricing potential. We give a light mean-reversion nudge
  // to new markets, reflecting that early prices are less reliable.
  // ========================================
  private marketAgeSignal(market: ParsedMarket): SignalResult {
    if (!market.createdAt) {
      return { name: 'Market Age', weight: 0.5, adjustment: 0, reasoning: 'Data de criação desconhecida.' };
    }

    const now = Date.now();
    const created = new Date(market.createdAt).getTime();

    if (isNaN(created)) {
      return { name: 'Market Age', weight: 0.5, adjustment: 0, reasoning: 'Data de criação inválida.' };
    }

    const ageDays = (now - created) / (1000 * 60 * 60 * 24);
    const direction = Math.sign(0.5 - market.yesPrice); // Nudge toward 50% for new markets

    if (ageDays < 2) {
      return {
        name: 'Market Age',
        weight: 1.5,
        adjustment: 0.025 * direction,
        reasoning: `Mercado muito novo (<2 dias). Alto potencial de mispricing inicial.`,
      };
    }

    if (ageDays < 7) {
      return {
        name: 'Market Age',
        weight: 1.0,
        adjustment: 0.01 * direction,
        reasoning: `Mercado jovem (${ageDays.toFixed(0)} dias). Algum mispricing ainda possível.`,
      };
    }

    if (ageDays > 60) {
      // Old market: trust the price more → add diluting weight
      return {
        name: 'Market Age',
        weight: 1.0,
        adjustment: 0.0,
        reasoning: `Mercado estabelecido (${Math.round(ageDays)} dias). Preço bem calibrado pelo histórico.`,
      };
    }

    return {
      name: 'Market Age',
      weight: 0.5,
      adjustment: 0.0,
      reasoning: `Mercado com ${Math.round(ageDays)} dias. Sem sinal de idade relevante.`,
    };
  }

  // ========================================
  // CONFIDENCE CALCULATOR
  // Incorporates signal consensus + market quality + optional news boost
  // ========================================
  private calculateConfidence(
    signals: SignalResult[],
    market: ParsedMarket,
    consensusRatio: number = 0,
    estimatedTrueProb: number = 0.5,
    newsResult?: NewsResult
  ): number {
    let confidence = 0.5;

    // Higher liquidity → more data → more confidence in estimate
    if (market.liquidity > 50_000) confidence += 0.15;
    else if (market.liquidity > 10_000) confidence += 0.10;
    else if (market.liquidity < 1_000) confidence -= 0.15;

    // Higher volume → more price discovery → more confidence
    if (market.volume > 100_000) confidence += 0.10;
    else if (market.volume < 5_000) confidence -= 0.10;

    // Signal consensus → higher confidence in the direction
    if (consensusRatio >= 0.70) confidence += 0.10;
    else if (consensusRatio < 0.55) confidence -= 0.10;

    // ── NEWS BOOST ───────────────────────────────────────────────────────
    // Fresh news increases our confidence that something real is happening.
    // If sentiment aligns with our estimate direction, boost further.
    if (newsResult?.hasRecentNews) {
      confidence += 0.08; // Any recent news = more market activity = more certainty

      if (newsResult.sentiment === 'bullish' && estimatedTrueProb > market.yesPrice) {
        // News is bullish AND we're estimating YES is underpriced → aligned
        confidence += 0.07;
      } else if (newsResult.sentiment === 'bearish' && estimatedTrueProb < market.yesPrice) {
        // News is bearish AND we're estimating YES is overpriced → aligned
        confidence += 0.07;
      }
    }

    return Math.max(0.1, Math.min(0.9, confidence));
  }
}
