// ================================================
// PROBABILITY ESTIMATOR — True Probability Model
// Phase 1: Heuristic signals with consensus gating
// ================================================

import { ParsedMarket } from '../services/GammaApiClient';
import { NewsResult } from '../services/NewsApiClient';
import { ConsensusEstimate } from '../services/ConsensusClient';
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
   *  - Calibration dampening: highly efficient markets get smaller adjustments (0.3×–1.0×)
   *  - Hard cap: |adjustment| ≤ 0.10 (max 10 percentage-point shift from market price)
   *
   * Optional news boost: when newsResult is provided and has fresh articles,
   * confidence is raised to reflect the increased certainty of our estimate.
   */
  estimate(
    market: ParsedMarket,
    allMarkets?: ParsedMarket[],
    medianVolume?: number,
    newsResult?: NewsResult,
    learnedWeights?: Record<string, number>,
    consensusEstimates?: ConsensusEstimate[]
  ): ProbabilityEstimate {
    const signals: SignalResult[] = [];
    const marketPrice = market.yesPrice;

    // Collect all signals
    signals.push(this.liquidityDynamicsSignal(market));
    signals.push(this.priceExtremitySignal(market));
    signals.push(this.timeDecaySignal(market));
    signals.push(this.spreadInefficiencySignal(market));
    signals.push(this.volumeSignificanceSignal(market, allMarkets, medianVolume));
    signals.push(this.marketAgeSignal(market));

    // Signal 9: External consensus (Metaculus + Manifold)
    if (consensusEstimates && consensusEstimates.length > 0) {
      signals.push(this.consensusSignal(market, consensusEstimates));
    }

    // Apply learned weight multipliers when available (Phase 4 ensemble)
    if (learnedWeights) {
      for (const signal of signals) {
        const multiplier = learnedWeights[signal.name] ?? 1.0;
        signal.weight *= multiplier;
      }
    }

    // Weighted average of all active adjustments (Fix: Do not dilute with neutral 0-adjustment signals)
    let totalWeight = 0;
    let weightedAdjustment = 0;
    for (const signal of signals) {
      if (Math.abs(signal.adjustment) > 0.001) { // Only count active signals toward the denominator
        totalWeight += signal.weight;
        weightedAdjustment += signal.adjustment * signal.weight;
      }
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

    // Multiplier: Loosened to prevent suffocating executions when signals are slightly mixed
    const consensusMultiplier =
      consensusRatio >= 0.70 ? 1.00 :
      consensusRatio >= 0.55 ? 0.80 :
      totalSigWeight === 0   ? 0.00 :
                               0.40; // Even if conflicting, we don't completely squash the adjustment

    // ── LIQUIDITY DAMPENING ─────────────────────────────────────────────
    // High-liquidity markets have more participants → prices are more efficient.
    const liquidityDampening =
      market.liquidity >= 100_000 ? 0.35 :
      market.liquidity >=  50_000 ? 0.60 :
      market.liquidity >=  20_000 ? 0.80 :
                                    1.00;

    // ── CALIBRATION DAMPENING (New) ──────────────────────────────────────
    // Highly efficient markets (high vol/liq + tight spread) should be trusted more.
    const volLiqRatio = market.liquidity > 0 ? market.volume / market.liquidity : 0;
    const spread = Math.abs((market.yesPrice + market.noPrice) - 1.0);
    let calibrationDampening = 1.0;

    if (volLiqRatio > 15 && spread < 0.02 && market.liquidity > 50_000) {
      calibrationDampening = 0.30; // Strong dampening: market is likely very efficient
    } else if (volLiqRatio > 5 && spread < 0.03) {
      calibrationDampening = 0.70; // Moderate dampening
    }

    // ── FINAL ADJUSTMENT ────────────────────────────────────────────────
    // Combine and cap at ±10% to prevent large false-positive edges while still giving room for >= 1% edge.
    const finalAdjustment = Math.max(-0.10, Math.min(0.10,
      avgAdjustment * consensusMultiplier * liquidityDampening * calibrationDampening
    ));

    let estimatedTrueProb = marketPrice + finalAdjustment;
    estimatedTrueProb = Math.max(0.01, Math.min(0.99, estimatedTrueProb));

    // ── CONFIDENCE (with optional news boost) ───────────────────────────
    const confidence = this.calculateConfidence(signals, market, consensusRatio, estimatedTrueProb, newsResult);

    const hasConsensus = consensusEstimates && consensusEstimates.length > 0;
    logger.debug('ProbEst',
      `"${market.question.substring(0, 40)}..." → Mkt: ${(marketPrice * 100).toFixed(0)}%, ` +
      `Est: ${(estimatedTrueProb * 100).toFixed(0)}%, Adj: ${(finalAdjustment * 100).toFixed(1)}%, ` +
      `Consensus: ${(consensusRatio * 100).toFixed(0)}%, Conf: ${(confidence * 100).toFixed(0)}%` +
      (newsResult?.hasRecentNews ? ` 📰 news:${newsResult.sentiment ?? 'mixed'}` : '') +
      (hasConsensus ? ` 🌐 consensus:${consensusEstimates!.map(c => `${c.source}@${(c.probability * 100).toFixed(0)}%`).join(',')}` : '')
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
  private liquidityDynamicsSignal(market: ParsedMarket): SignalResult {
    const volLiq = market.liquidity > 0 ? market.volume / market.liquidity : 0;
    const distFrom50 = Math.abs(market.yesPrice - 0.5);
    const direction = Math.sign(0.5 - market.yesPrice);

    let adjustment = 0;
    let reasoning = '';

    // Factor A: Relative Volume Inefficiency
    if (volLiq < 1.0) {
      adjustment += 0.03 * direction;
      reasoning = `Volume baixo (${volLiq.toFixed(1)}x liq). `;
    } else if (volLiq > 20.0) {
      adjustment -= 0.015 * (market.yesPrice - 0.5);
      reasoning = `Volume extremo (${volLiq.toFixed(0)}x liq). `;
    }

    // Factor B: Liquidity Mean Reversion
    if (market.liquidity < 15000 && distFrom50 > 0.1) {
      adjustment += 0.035 * direction;
      reasoning += `Baixa liquidez com preço desviado.`;
    } else if (market.liquidity < 50000 && distFrom50 > 0.25) {
      adjustment += 0.015 * direction;
      reasoning += `Liquidez moderada em preço extremo.`;
    }

    if (!reasoning) reasoning = 'Dinâmica de volume e liquidez dentro da normalidade.';

    // Weighted combination capped to reasonable range
    return { name: 'Liquidity Dynamics', weight: 2.5, adjustment: Math.max(-0.06, Math.min(0.06, adjustment)), reasoning };
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
  // SIGNAL 9: External Consensus (Metaculus + Manifold)
  // When crowd forecasters on other platforms have a
  // significantly different probability, we nudge our
  // estimate toward theirs — weighted by their confidence.
  // ========================================
  private consensusSignal(market: ParsedMarket, estimates: ConsensusEstimate[]): SignalResult {
    if (estimates.length === 0) {
      return { name: 'External Consensus', weight: 0, adjustment: 0, reasoning: 'No consensus data.' };
    }

    // Weighted average of consensus probabilities
    let totalWeight = 0;
    let weightedProb = 0;
    for (const est of estimates) {
      totalWeight += est.confidence;
      weightedProb += est.probability * est.confidence;
    }
    const avgConsensusProb = totalWeight > 0 ? weightedProb / totalWeight : market.yesPrice;
    const avgConfidence = totalWeight / estimates.length;

    const diff = avgConsensusProb - market.yesPrice;

    // Cap the adjustment at ±4% — consensus can disagree with market but
    // we don't fully override our own signals.
    const adjustment = Math.max(-0.04, Math.min(0.04, diff * 0.5));

    const sources = estimates.map(e => `${e.source}@${(e.probability * 100).toFixed(0)}%`).join(', ');
    const reasoning = `Consenso externo: ${sources}. Média: ${(avgConsensusProb * 100).toFixed(0)}% vs mercado ${(market.yesPrice * 100).toFixed(0)}%. Ajuste: ${(adjustment * 100).toFixed(1)}%.`;

    // Weight scales with confidence and number of sources
    const weight = Math.min(2.5, avgConfidence * 2.0 * estimates.length);

    return { name: 'External Consensus', weight, adjustment, reasoning };
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
