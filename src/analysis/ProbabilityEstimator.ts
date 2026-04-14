// ================================================
// PROBABILITY ESTIMATOR — True Probability Model
// Phase 1: Heuristic signals
// ================================================

import { ParsedMarket } from '../services/GammaApiClient';
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
   * Phase 1 (Heuristic) — Uses market microstructure signals:
   * 1. Volume/Liquidity ratio: High volume with low liquidity suggests hidden info
   * 2. Price extremity: Markets near 0% or 100% are harder to misprice
   * 3. Time to expiry: Near-expiry markets are more efficiently priced
   * 4. Bid-ask spread proxy: Large gap between yes+no vs 1.0 suggests inefficiency
   * 5. Volume momentum: Markets with recent volume surges may be updating
   */
  estimate(market: ParsedMarket, allMarkets?: ParsedMarket[]): ProbabilityEstimate {
    const signals: SignalResult[] = [];
    const marketPrice = market.yesPrice;

    // Signal 1: Volume/Liquidity Ratio
    signals.push(this.volumeLiquiditySignal(market));

    // Signal 2: Price Extremity Discount
    signals.push(this.priceExtremitySignal(market));

    // Signal 3: Time Decay
    signals.push(this.timeDecaySignal(market));

    // Signal 4: Spread/Inefficiency
    signals.push(this.spreadInefficiencySignal(market));

    // Signal 5: Volume Significance
    signals.push(this.volumeSignificanceSignal(market, allMarkets));

    // Signal 6: Liquidity-Weighted Mean Reversion (strongest signal)
    signals.push(this.liquidityMeanReversionSignal(market));

    // Combine signals: weighted sum of adjustments
    let totalWeight = 0;
    let weightedAdjustment = 0;

    for (const signal of signals) {
      totalWeight += signal.weight;
      weightedAdjustment += signal.adjustment * signal.weight;
    }

    const avgAdjustment = totalWeight > 0 ? weightedAdjustment / totalWeight : 0;

    // Apply adjustment to market price — use amplification factor
    // Low-liquidity markets get bigger adjustments
    const liquidityFactor = market.liquidity < 20000 ? 2.0 : market.liquidity < 50000 ? 1.5 : 1.0;
    const finalAdjustment = avgAdjustment * liquidityFactor;

    let estimatedTrueProb = marketPrice + finalAdjustment;
    estimatedTrueProb = Math.max(0.01, Math.min(0.99, estimatedTrueProb));

    // Confidence: based on signal agreement and market quality
    const confidence = this.calculateConfidence(signals, market);

    logger.debug('ProbEst',
      `"${market.question.substring(0, 40)}..." → Mkt: ${(marketPrice * 100).toFixed(0)}%, ` +
      `Est: ${(estimatedTrueProb * 100).toFixed(0)}%, Adj: ${(finalAdjustment * 100).toFixed(1)}%, ` +
      `Conf: ${(confidence * 100).toFixed(0)}%`
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
  // High ratio → informed traders may be moving the price
  // This can suggest underpricing on the direction of flow
  // ========================================
  private volumeLiquiditySignal(market: ParsedMarket): SignalResult {
    const ratio = market.liquidity > 0 ? market.volume / market.liquidity : 0;

    let adjustment = 0;
    let reasoning = '';

    if (ratio > 20) {
      // Very high turnover — price is likely efficient, slight contrarian lean
      adjustment = -0.015 * (market.yesPrice - 0.5);
      reasoning = `Volume/Liquidez extremo (${ratio.toFixed(0)}x). Mercado provavelmente eficiente, leve reversão.`;
    } else if (ratio > 5) {
      // Moderate turnover — some signal, follow the flow
      adjustment = 0.01 * Math.sign(market.yesPrice - 0.5);
      reasoning = `Volume/Liquidez moderado (${ratio.toFixed(0)}x). Confirmação da direção.`;
    } else if (ratio < 1) {
      // Low turnover — market may be stale / mispriced → stronger mean reversion
      adjustment = 0.04 * (0.5 - market.yesPrice);
      reasoning = `Volume/Liquidez baixo (${ratio.toFixed(1)}x). Mercado estagnado — possível mispricing.`;
    } else {
      reasoning = `Volume/Liquidez normal (${ratio.toFixed(1)}x). Sem sinal forte.`;
    }

    return { name: 'Volume/Liquidity', weight: 1.5, adjustment, reasoning };
  }

  // ========================================
  // SIGNAL 2: Price Extremity
  // Prices near 0 or 1 are hard to misprice (more participant agreement)
  // Prices near 0.5 have more room for mispricing
  // ========================================
  private priceExtremitySignal(market: ParsedMarket): SignalResult {
    const distFrom50 = Math.abs(market.yesPrice - 0.5);

    let adjustment = 0;
    let reasoning = '';

    if (distFrom50 > 0.4) {
      // Very extreme (>90% or <10%) — likely correctly priced
      adjustment = 0;
      reasoning = `Preço extremo (${(market.yesPrice * 100).toFixed(0)}%). Sem ajuste — consenso forte.`;
    } else if (distFrom50 > 0.25) {
      // Moderate confidence, slight mean reversion
      adjustment = -0.005 * Math.sign(market.yesPrice - 0.5);
      reasoning = `Preço moderado (${(market.yesPrice * 100).toFixed(0)}%). Leve reversão à média.`;
    } else {
      // Near 50% — maximum uncertainty, more room for edge
      adjustment = 0;
      reasoning = `Preço próximo de 50% (${(market.yesPrice * 100).toFixed(0)}%). Incerteza máxima.`;
    }

    return { name: 'Price Extremity', weight: 1.0, adjustment, reasoning };
  }

  // ========================================
  // SIGNAL 3: Time Decay
  // Markets near expiration tend to be more efficient
  // ========================================
  private timeDecaySignal(market: ParsedMarket): SignalResult {
    let adjustment = 0;
    let reasoning = '';

    if (!market.endDate) {
      return { name: 'Time Decay', weight: 0.5, adjustment: 0, reasoning: 'Sem data de expiração.' };
    }

    const now = Date.now();
    const end = new Date(market.endDate).getTime();
    const hoursRemaining = (end - now) / (1000 * 60 * 60);

    if (hoursRemaining < 24) {
      // Very close to expiry — market is very efficient
      adjustment = 0;
      reasoning = `<24h para expirar. Mercado altamente eficiente — sem ajuste.`;
    } else if (hoursRemaining < 72) {
      // 1-3 days — moderately efficient
      adjustment = -0.005 * Math.sign(market.yesPrice - 0.5);
      reasoning = `${Math.round(hoursRemaining)}h para expirar. Eficiência moderada.`;
    } else if (hoursRemaining > 720) {
      // 30+ days — more room for mispricing
      adjustment = 0.01 * (0.5 - market.yesPrice);
      reasoning = `${Math.round(hoursRemaining / 24)} dias restantes. Mais espaço para mispricing.`;
    } else {
      reasoning = `${Math.round(hoursRemaining / 24)} dias restantes. Neutro.`;
    }

    return { name: 'Time Decay', weight: 1.2, adjustment, reasoning };
  }

  // ========================================
  // SIGNAL 4: Spread / Inefficiency
  // If yesPrice + noPrice != 1.0, there's a spread (inefficiency)
  // ========================================
  private spreadInefficiencySignal(market: ParsedMarket): SignalResult {
    const sum = market.yesPrice + market.noPrice;
    const spread = Math.abs(sum - 1.0);

    let adjustment = 0;
    let reasoning = '';

    if (spread > 0.05) {
      // Large spread — market might be inefficient
      // Adjust towards the cheaper side
      if (sum < 1.0) {
        // Both sides are cheap — arbitrage-like opportunity
        adjustment = 0.02;
        reasoning = `Spread alto (soma=${sum.toFixed(3)}). Ambos os lados estão baratos.`;
      } else {
        // Both sides are expensive
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
  // Compare this market's volume to median — outliers may have more informed flow
  // ========================================
  private volumeSignificanceSignal(market: ParsedMarket, allMarkets?: ParsedMarket[]): SignalResult {
    let adjustment = 0;
    let reasoning = '';

    if (!allMarkets || allMarkets.length === 0) {
      return { name: 'Volume Significance', weight: 0.5, adjustment: 0, reasoning: 'Sem dados comparativos.' };
    }

    const volumes = allMarkets.map(m => m.volume).sort((a, b) => a - b);
    const medianVolume = volumes[Math.floor(volumes.length / 2)];
    const ratio = medianVolume > 0 ? market.volume / medianVolume : 1;

    if (ratio > 10) {
      // Top-volume market — very well-priced
      adjustment = 0;
      reasoning = `Volume ${ratio.toFixed(0)}x acima da mediana. Mercado muito líquido e eficiente.`;
    } else if (ratio < 0.1) {
      // Very low volume — higher chance of mispricing, but lower confidence
      adjustment = 0.015 * (0.5 - market.yesPrice);
      reasoning = `Volume ${ratio.toFixed(2)}x abaixo da mediana. Possível mispricing, mas baixa confiança.`;
    } else {
      reasoning = `Volume normal (${ratio.toFixed(1)}x da mediana).`;
    }

    return { name: 'Volume Significance', weight: 1.0, adjustment, reasoning };
  }

  // ========================================
  // SIGNAL 6: Liquidity Mean Reversion
  // Low-liquidity markets with prices away from 50% are prime targets
  // for mispricing — they have fewer participants maintaining efficiency
  // ========================================
  private liquidityMeanReversionSignal(market: ParsedMarket): SignalResult {
    let adjustment = 0;
    let reasoning = '';

    const distFrom50 = Math.abs(market.yesPrice - 0.5);
    const direction = Math.sign(0.5 - market.yesPrice); // Push towards 50%

    if (market.liquidity < 15000 && distFrom50 > 0.1) {
      // Low liquidity + price away from 50% → strong mean reversion signal
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
  // CONFIDENCE CALCULATOR
  // ========================================
  private calculateConfidence(signals: SignalResult[], market: ParsedMarket): number {
    let confidence = 0.5; // Start at 50%

    // Higher liquidity → more confidence in our estimate
    if (market.liquidity > 50000) confidence += 0.15;
    else if (market.liquidity > 10000) confidence += 0.10;
    else if (market.liquidity < 1000) confidence -= 0.15;

    // Higher volume → more confidence
    if (market.volume > 100000) confidence += 0.10;
    else if (market.volume < 5000) confidence -= 0.10;

    // Signal agreement → more confidence
    const adjustmentSigns = signals.map(s => Math.sign(s.adjustment)).filter(s => s !== 0);
    if (adjustmentSigns.length > 0) {
      const allSameSign = adjustmentSigns.every(s => s === adjustmentSigns[0]);
      if (allSameSign) confidence += 0.10;
    }

    return Math.max(0.1, Math.min(0.9, confidence));
  }
}
