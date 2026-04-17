// ================================================
// PROBABILITY ESTIMATOR — True Probability Model
//
// Design principle: trust the market price by default.
// The market aggregates far more information than our
// heuristics can. We only deviate when:
//
//  1. There is a structural inefficiency (book spread)
//  2. An external LLM estimate (Claude) disagrees
//  3. Historical calibration reveals a systematic bias
//
// The old "mean reversion" signals were removed because
// pushing every price toward 50% generates fake edges
// and is not supported by prediction market research.
// ================================================

import { ParsedMarket } from '../services/GammaApiClient';
import { NewsResult } from '../services/NewsApiClient';
import { logger } from '../utils/Logger';

export interface ProbabilityEstimate {
  marketId: string;
  question: string;
  marketPrice: number;
  estimatedTrueProb: number;
  confidence: number;
  signals: SignalResult[];
}

interface SignalResult {
  name: string;
  weight: number;
  adjustment: number;
  reasoning: string;
}

export interface ExternalEstimate {
  probability: number;
  confidence: number;
  source: string;
}

export interface CalibrationInput {
  adjustment: number;
  confidence: number;
  sampleSize: number;
}

// Maximum shift from market price — requires all signals aligned + high confidence
const MAX_ADJUSTMENT = 0.15;

export class ProbabilityEstimator {

  /**
   * Estimate the true probability of a market YES outcome.
   *
   * Signals (in priority order):
   *  1. Book inefficiency — structural edge when YES+NO≠1.0
   *  2. Volume/liquidity anomaly — unusual ratio may signal informed flow
   *  3. Calibration correction — historical bias correction (optional)
   *  4. External estimate — Claude or other LLM (optional, high weight)
   *
   * Final adjustment is dampened by consensus ratio and liquidity,
   * then hard-capped at ±MAX_ADJUSTMENT.
   */
  estimate(
    market: ParsedMarket,
    _allMarkets?: ParsedMarket[],
    newsResult?: NewsResult,
    externalEstimate?: ExternalEstimate,
    calibrationInput?: CalibrationInput
  ): ProbabilityEstimate {
    const signals: SignalResult[] = [];
    const marketPrice = market.yesPrice;

    // Signal 1: Structural book inefficiency (always computed)
    signals.push(this.bookInefficiencySignal(market));

    // Signal 2: Volume/liquidity anomaly (directional only when extreme)
    signals.push(this.volumeAnomalySignal(market));

    // Signal 3: Calibration correction (if provided by BayesianCalibrator)
    if (calibrationInput && calibrationInput.sampleSize >= 10) {
      signals.push(this.calibrationSignal(calibrationInput));
    }

    // Signal 4: External LLM estimate (if provided by ClaudeAnalyzer)
    if (externalEstimate) {
      signals.push(this.externalEstimateSignal(externalEstimate, marketPrice));
    }

    // Weighted average of adjustments
    let totalWeight = 0;
    let weightedAdj = 0;
    for (const s of signals) {
      totalWeight += s.weight;
      weightedAdj += s.adjustment * s.weight;
    }
    const avgAdj = totalWeight > 0 ? weightedAdj / totalWeight : 0;

    // Consensus gate: penalise conflicting signals
    const sig = signals.filter(s => Math.abs(s.adjustment) > 0.003);
    const posW = sig.filter(s => s.adjustment > 0).reduce((sum, s) => sum + s.weight, 0);
    const negW = sig.filter(s => s.adjustment < 0).reduce((sum, s) => sum + s.weight, 0);
    const totalSig = posW + negW;
    const dominantW = Math.max(posW, negW);
    const consensusRatio = totalSig > 0 ? dominantW / totalSig : 0;

    const consensusMult =
      consensusRatio >= 0.80 ? 1.00 :
      consensusRatio >= 0.60 ? 0.60 :
      totalSig === 0         ? 0.00 :
                               0.20;

    // Liquidity dampening: large markets are harder to misprice
    const liqDamp =
      market.liquidity >= 200_000 ? 0.25 :
      market.liquidity >= 100_000 ? 0.45 :
      market.liquidity >=  50_000 ? 0.70 :
                                    1.00;

    // Hard cap at MAX_ADJUSTMENT
    const finalAdj = Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT,
      avgAdj * consensusMult * liqDamp
    ));

    let estimatedTrueProb = Math.max(0.01, Math.min(0.99, marketPrice + finalAdj));

    const confidence = this.calcConfidence(
      signals, market, consensusRatio, estimatedTrueProb, newsResult, externalEstimate
    );

    logger.debug('ProbEst',
      `"${market.question.substring(0, 40)}..." ` +
      `mkt=${(marketPrice * 100).toFixed(0)}% ` +
      `est=${(estimatedTrueProb * 100).toFixed(0)}% ` +
      `adj=${(finalAdj * 100).toFixed(1)}% ` +
      `conf=${(confidence * 100).toFixed(0)}%` +
      (externalEstimate ? ` [${externalEstimate.source}]` : '') +
      (newsResult?.hasRecentNews ? ` 📰` : '')
    );

    return { marketId: market.id, question: market.question, marketPrice, estimatedTrueProb, confidence, signals };
  }

  // ──────────────────────────────────────────────────────────────
  // SIGNAL 1: Book Inefficiency
  // When YES price + NO price ≠ 1.0 the market has structural slack.
  // A sum < 1.0 means both sides are cheap (under-round).
  // A sum > 1.0 means both sides are expensive (over-round).
  // We translate this into a directional nudge only when the
  // current side is relatively cheaper.
  // ──────────────────────────────────────────────────────────────
  private bookInefficiencySignal(market: ParsedMarket): SignalResult {
    const sum = market.yesPrice + market.noPrice;
    const spread = Math.abs(sum - 1.0);

    if (spread < 0.02) {
      return { name: 'Book Efficiency', weight: 1.0, adjustment: 0, reasoning: `Book tight (sum=${sum.toFixed(3)}).` };
    }

    // Under-round: both sides cheap. Favour the side the market leans to.
    // Over-round: both sides expensive — this is a low-quality market; small negative signal.
    const dir = sum < 1.0 ? Math.sign(market.yesPrice - 0.5) : -Math.sign(market.yesPrice - 0.5);
    const adj = spread * 0.4 * dir;

    return {
      name: 'Book Inefficiency',
      weight: 1.5,
      adjustment: adj,
      reasoning: `Book ${sum < 1 ? 'under' : 'over'}-round (sum=${sum.toFixed(3)}, spread=${(spread * 100).toFixed(1)}%).`,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // SIGNAL 2: Volume/Liquidity Anomaly
  // An extreme vol/liq ratio (>20×) on a market that isn't near
  // 0% or 100% can reflect informed trading. We cautiously
  // follow the direction implied by the current price move.
  // Low vol/liq means little discovery — we stay neutral.
  // ──────────────────────────────────────────────────────────────
  private volumeAnomalySignal(market: ParsedMarket): SignalResult {
    const ratio = market.liquidity > 0 ? market.volume / market.liquidity : 0;
    const distFrom50 = Math.abs(market.yesPrice - 0.5);

    // Only act on extreme ratios for non-extreme prices
    if (ratio > 20 && distFrom50 < 0.4) {
      const dir = Math.sign(market.yesPrice - 0.5); // Follow the current direction
      return {
        name: 'Volume Anomaly',
        weight: 1.2,
        adjustment: 0.015 * dir,
        reasoning: `Extreme vol/liq (${ratio.toFixed(0)}×) — confirms current direction.`,
      };
    }

    if (ratio < 0.5) {
      return {
        name: 'Volume Anomaly',
        weight: 0.5,
        adjustment: 0,
        reasoning: `Low vol/liq (${ratio.toFixed(1)}×) — little price discovery, neutral.`,
      };
    }

    return { name: 'Volume Anomaly', weight: 0.5, adjustment: 0, reasoning: `Vol/liq normal (${ratio.toFixed(1)}×).` };
  }

  // ──────────────────────────────────────────────────────────────
  // SIGNAL 3: Calibration Correction
  // Applies historical bias from BayesianCalibrator. If we've
  // consistently over/under-estimated this probability range,
  // correct for it with weight proportional to sample size.
  // ──────────────────────────────────────────────────────────────
  private calibrationSignal(cal: CalibrationInput): SignalResult {
    return {
      name: 'Calibration',
      weight: 1.0 + cal.confidence,
      adjustment: cal.adjustment * cal.confidence,
      reasoning: `Historical bias correction: ${cal.adjustment > 0 ? '+' : ''}${(cal.adjustment * 100).toFixed(1)}% (n=${cal.sampleSize}).`,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // SIGNAL 4: External Estimate (Claude / LLM)
  // High-weight directional signal when an external model
  // disagrees with the market. Weight scales with the
  // stated confidence of the external estimate.
  // ──────────────────────────────────────────────────────────────
  private externalEstimateSignal(ext: ExternalEstimate, marketPrice: number): SignalResult {
    const deviation = ext.probability - marketPrice;
    // Weight is 2× the confidence — a confident external estimate dominates heuristics
    const weight = 2.0 * ext.confidence;

    return {
      name: `External (${ext.source})`,
      weight,
      adjustment: deviation,
      reasoning: `${ext.source} estimates ${(ext.probability * 100).toFixed(0)}% ` +
        `(mkt=${(marketPrice * 100).toFixed(0)}%, Δ=${(deviation * 100).toFixed(1)}%, conf=${(ext.confidence * 100).toFixed(0)}%).`,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // CONFIDENCE
  // Starts at 0.4 (sceptical by default). Grows when signals
  // agree and we have more market data. News and Claude boosts
  // are additive.
  // ──────────────────────────────────────────────────────────────
  private calcConfidence(
    signals: SignalResult[],
    market: ParsedMarket,
    consensusRatio: number,
    _estimatedTrueProb: number,
    newsResult?: NewsResult,
    external?: ExternalEstimate
  ): number {
    let conf = 0.40;

    // More liquid/traded → market price is more reliable as baseline
    if (market.liquidity > 100_000) conf += 0.10;
    else if (market.liquidity < 5_000)  conf -= 0.10;

    if (market.volume > 200_000) conf += 0.05;
    else if (market.volume < 5_000) conf -= 0.05;

    // Signal consensus
    if (consensusRatio >= 0.80) conf += 0.10;
    else if (consensusRatio < 0.55 && signals.length > 1) conf -= 0.10;

    // News: fresh coverage increases certainty
    if (newsResult?.hasRecentNews) conf += 0.07;

    // External estimate: the confidence it carries directly adds to ours
    if (external) conf += external.confidence * 0.20;

    return Math.max(0.15, Math.min(0.90, conf));
  }
}
