// ================================================
// CORRELATION ANALYZER — Cross-Market Consistency
// ================================================
//
// Detects pricing inconsistencies between markets that
// belong to the same Polymarket event (e.g. "2024 US
// Presidential Election" → multiple candidate markets).
//
// Two types of inconsistency:
//
// 1. OVER-BOOK: sum of all YES prices > 1.0 + threshold
//    → The market is pricing outcomes too expensively.
//    → The most overpriced market is the best NO candidate.
//
// 2. UNDER-BOOK: sum of all YES prices < 1.0 - threshold
//    → The market is leaving free money on the table.
//    → Every outcome is cheap; the most likely YES is best.
//
// This mirrors how sharp bookmakers find value: compare
// implied probabilities across a set of mutually exclusive
// outcomes to find the mispriced one.
// ================================================

import { ParsedMarket, ParsedEvent } from '../services/GammaApiClient';
import { logger } from '../utils/Logger';

export type InconsistencyType = 'over_book' | 'under_book';

export interface CorrelationOpportunity {
  type: InconsistencyType;
  eventId: string;
  eventTitle: string;
  marketId: string;
  question: string;
  yesPrice: number;
  fairPrice: number;         // What the price "should" be for the book to sum to 1
  mispricing: number;        // yesPrice - fairPrice (positive = expensive, negative = cheap)
  bookSum: number;           // Sum of all YES prices in the event
  siblingCount: number;      // Number of markets in the same event
  recommendation: 'BUY_YES' | 'BUY_NO'; // Action to take to exploit the mispricing
}

// Only flag inconsistencies that exceed this threshold (10% reduces false-positive noise)
const BOOK_DEVIATION_THRESHOLD = 0.10;
// Require at least this many markets in an event before flagging (3+ = truly correlated set)
const MIN_MARKETS_IN_EVENT = 3;

export class CorrelationAnalyzer {

  /**
   * Find pricing inconsistencies across all events.
   * Returns opportunities sorted by absolute mispricing (largest first).
   */
  findInconsistencies(events: ParsedEvent[]): CorrelationOpportunity[] {
    const opportunities: CorrelationOpportunity[] = [];

    for (const event of events) {
      const eventOpps = this.analyzeEvent(event);
      opportunities.push(...eventOpps);
    }

    // Sort by absolute mispricing descending (biggest edge first)
    opportunities.sort((a, b) => Math.abs(b.mispricing) - Math.abs(a.mispricing));

    if (opportunities.length > 0) {
      logger.debug('Correlation',
        `Found ${opportunities.length} cross-market inconsistencies across ${events.length} events`
      );
    }

    return opportunities;
  }

  /**
   * Analyze a single event's markets for book inconsistencies.
   * Only applies when all markets are mutually exclusive binary outcomes
   * (e.g., "Will X win?", "Will Y win?", "Will Z win?").
   */
  private analyzeEvent(event: ParsedEvent): CorrelationOpportunity[] {
    // Exclude negRisk markets: their YES prices do not sum to 1 like standard mutually
    // exclusive binary outcomes, so the bookSum logic does not apply to them.
    const markets = event.markets.filter(m => m.active && !m.closed && !m.negRisk);
    if (markets.length < MIN_MARKETS_IN_EVENT) return [];

    // Require explicit, non-zero liquidity on every market to avoid including dead markets
    // that haven't been traded (their prices may be stale and distort the bookSum).
    const liquidMarkets = markets.filter(m => m.liquidity > 1_000);
    if (liquidMarkets.length < MIN_MARKETS_IN_EVENT) return [];

    // Only analyse events where markets look mutually exclusive:
    // Heuristic: all YES prices are in the contested range (2–90%)
    const allContested = liquidMarkets.every(m => m.yesPrice < 0.90 && m.yesPrice > 0.02);
    if (!allContested) return [];

    const bookSum = liquidMarkets.reduce((sum, m) => sum + m.yesPrice, 0);
    const deviation = bookSum - 1.0;

    // No meaningful inconsistency
    if (Math.abs(deviation) < BOOK_DEVIATION_THRESHOLD) return [];

    const type: InconsistencyType = deviation > 0 ? 'over_book' : 'under_book';
    const opportunities: CorrelationOpportunity[] = [];

    for (const market of liquidMarkets) {
      // Fair price = yesPrice / bookSum (normalise to sum to 1)
      const fairPrice = market.yesPrice / bookSum;
      const mispricing = market.yesPrice - fairPrice;

      // For over-book: mispricing > 0 means this market is overpriced → BUY_NO
      // For under-book: mispricing < 0 means this market is underpriced → BUY_YES
      const recommendation: 'BUY_YES' | 'BUY_NO' =
        mispricing > 0 ? 'BUY_NO' : 'BUY_YES';

      // Only include the most mispriced market per over/under direction
      opportunities.push({
        type,
        eventId: event.id,
        eventTitle: event.title,
        marketId: market.id,
        question: market.question,
        yesPrice: market.yesPrice,
        fairPrice,
        mispricing,
        bookSum,
        siblingCount: liquidMarkets.length,
        recommendation,
      });
    }

    // Return only the top mispriced market per event to avoid over-trading
    opportunities.sort((a, b) => Math.abs(b.mispricing) - Math.abs(a.mispricing));
    return opportunities.slice(0, 1);
  }

  /**
   * Convert a CorrelationOpportunity to a human-readable summary.
   */
  summarize(opp: CorrelationOpportunity): string {
    const bookPct = (opp.bookSum * 100).toFixed(1);
    const misPct = (Math.abs(opp.mispricing) * 100).toFixed(1);
    const action = opp.recommendation === 'BUY_NO' ? 'COMPRAR NÃO' : 'COMPRAR SIM';

    return (
      `[${opp.type === 'over_book' ? 'OVER' : 'UNDER'}-BOOK] ` +
      `Evento: "${opp.eventTitle}" (${opp.siblingCount} mercados, soma=${bookPct}%) — ` +
      `"${opp.question.substring(0, 50)}" ` +
      `mkt=${(opp.yesPrice * 100).toFixed(1)}% fair=${(opp.fairPrice * 100).toFixed(1)}% ` +
      `mispricing=${misPct}% → ${action}`
    );
  }
}
