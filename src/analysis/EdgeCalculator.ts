// ================================================
// EDGE CALCULATOR — Mispricing Identification & EV
// ================================================

import { logger } from '../utils/Logger';
import { config } from '../engine/Config';

export interface EdgeAnalysis {
  marketId: string;
  question: string;

  // Prices
  marketPrice: number;           // P_implied (what market says)
  estimatedTrueProb: number;     // P_true (what we estimate)

  // Edge
  edge: number;                  // P_true - P_implied (raw)
  edgePercent: number;           // Edge as percentage

  // Expected Value
  ev: number;                    // EV per $1 bet
  evPercent: number;             // EV as percentage

  // Confidence in estimate
  confidence: number;            // 0-1

  // Market data needed for execution
  liquidity: number;             // Market liquidity (for Kelly cap)
  yesTokenId: string;            // CLOB token ID for YES side
  noTokenId: string;             // CLOB token ID for NO side
  negRisk: boolean;              // Negative risk market flag

  // Decision
  side: 'BUY_YES' | 'BUY_NO' | 'NO_TRADE';
  recommendedPrice: number;      // Limit order price
  reasoning: string;             // Human-readable explanation
}

// Polymarket fee: ~2% for takers (200 bps), makers can get rebates
const TAKER_FEE = 0.02;

export class EdgeCalculator {

  /**
   * Core formula: Calculate edge and expected value for a market
   * 
   * Edge = P_true - P_implied
   * 
   * EV (buying YES at price q):
   *   EV = P_true × (1/q - 1) × (1 - fee) - (1 - P_true)
   * 
   * EV (buying NO at price (1-q)):
   *   EV = (1 - P_true) × (1/(1-q) - 1) × (1 - fee) - P_true
   */
  calculateEdge(
    marketId: string,
    question: string,
    marketYesPrice: number,
    estimatedTrueProb: number,
    confidence: number,
    liquidity: number = 0,
    yesTokenId: string = '',
    noTokenId: string = '',
    negRisk: boolean = false
  ): EdgeAnalysis {
    // Clamp prices to valid range
    const yesPrice = Math.max(0.01, Math.min(0.99, marketYesPrice));
    const noPrice = 1 - yesPrice;
    const pTrue = Math.max(0.01, Math.min(0.99, estimatedTrueProb));

    // Calculate edge for YES side
    const yesEdge = pTrue - yesPrice;

    // Calculate edge for NO side
    const noEdge = (1 - pTrue) - noPrice;

    // Calculate EV for buying YES
    const evYes = pTrue * ((1 / yesPrice) - 1) * (1 - TAKER_FEE) - (1 - pTrue);

    // Calculate EV for buying NO
    const evNo = (1 - pTrue) * ((1 / noPrice) - 1) * (1 - TAKER_FEE) - pTrue;

    // Determine best side
    let side: 'BUY_YES' | 'BUY_NO' | 'NO_TRADE';
    let edge: number;
    let ev: number;
    let recommendedPrice: number;

    if (yesEdge > noEdge && yesEdge > config.minEdge && evYes > 0) {
      side = 'BUY_YES';
      edge = yesEdge;
      ev = evYes;
      recommendedPrice = yesPrice; // Buy at current price (or slightly below)
    } else if (noEdge > yesEdge && noEdge > config.minEdge && evNo > 0) {
      side = 'BUY_NO';
      edge = noEdge;
      ev = evNo;
      recommendedPrice = noPrice;
    } else {
      side = 'NO_TRADE';
      edge = Math.max(yesEdge, noEdge);
      ev = Math.max(evYes, evNo);
      recommendedPrice = 0;
    }

    // Adjust confidence — reduce if edge is marginal
    const adjustedConfidence = confidence * Math.min(1, Math.abs(edge) / config.minEdge);

    const reasoning = this.buildReasoning(
      question, side, edge, ev, yesPrice, pTrue, confidence
    );

    logger.debug('EdgeCalc', `${question.substring(0, 50)}... → Edge: ${(edge * 100).toFixed(1)}%, EV: ${(ev * 100).toFixed(1)}%, Side: ${side}`);

    return {
      marketId,
      question,
      marketPrice: yesPrice,
      estimatedTrueProb: pTrue,
      edge,
      edgePercent: edge * 100,
      ev,
      evPercent: ev * 100,
      confidence: adjustedConfidence,
      liquidity,
      yesTokenId,
      noTokenId,
      negRisk,
      side,
      recommendedPrice,
      reasoning,
    };
  }

  /**
   * Filter a list of edge analyses to only tradeable opportunities
   */
  filterTradeableOpportunities(analyses: EdgeAnalysis[]): EdgeAnalysis[] {
    return analyses
      .filter(a => a.side !== 'NO_TRADE')
      .filter(a => a.edge >= config.minEdge)
      .filter(a => a.ev > 0)
      .filter(a => a.confidence >= 0.3)
      .sort((a, b) => b.ev - a.ev); // Best EV first
  }

  private buildReasoning(
    question: string,
    side: string,
    edge: number,
    ev: number,
    marketPrice: number,
    pTrue: number,
    confidence: number
  ): string {
    if (side === 'NO_TRADE') {
      return `Sem edge suficiente em "${question}". ` +
        `Mkt: ${(marketPrice * 100).toFixed(0)}%, Est: ${(pTrue * 100).toFixed(0)}%, ` +
        `Edge: ${(edge * 100).toFixed(1)}% (mín: ${(config.minEdge * 100).toFixed(0)}%)`;
    }

    const sideStr = side === 'BUY_YES' ? 'SIM' : 'NÃO';
    return `Comprar ${sideStr} em "${question}". ` +
      `Mercado diz ${(marketPrice * 100).toFixed(0)}%, estimo ${(pTrue * 100).toFixed(0)}%. ` +
      `Edge: +${(edge * 100).toFixed(1)}%, EV: +${(ev * 100).toFixed(1)}%. ` +
      `Confiança: ${(confidence * 100).toFixed(0)}%.`;
  }
}
