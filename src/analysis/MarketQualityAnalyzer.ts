// ================================================
// MARKET QUALITY ANALYZER
// Scores markets 0–100 across 5 dimensions.
// Trades below MIN_SCORE are rejected before
// Kelly sizing, saving compute and protecting P&L.
//
// Dimensions:
//   1. Liquidity quality     (0–25)
//   2. Price range           (0–20)
//   3. Question clarity      (0–20)
//   4. Resolution proximity  (0–20)
//   5. Market activity       (0–15)
// ================================================

import { ParsedMarket } from '../services/GammaApiClient';

export interface QualityScore {
  total: number;          // 0–100
  liquidity: number;      // 0–25
  priceRange: number;     // 0–20
  clarity: number;        // 0–20
  resolution: number;     // 0–20
  activity: number;       // 0–15
  flags: string[];        // human-readable disqualifying notes
}

// Minimum acceptable total score to trade a market
export const MIN_QUALITY_SCORE = 40;

// Vague resolution language — deduct clarity score
const VAGUE_TERMS = [
  'approximately', 'roughly', 'about', 'unclear', 'ambiguous',
  'subject to', 'discretion', 'interpretation', 'as determined',
  'officially declared', 'widely reported', 'major outlet',
];

// Strong resolution anchors — boost clarity score
const CLEAR_TERMS = [
  'exceed', 'above', 'below', 'reach', 'less than', 'more than',
  'official', 'reported by', 'announces', 'certifies', 'confirmed by',
  'epa', 'cdc', 'fda', 'fed', 'sec', 'congress', 'supreme court',
  'election', 'vote', 'win', 'elected', 'appointed',
];

export class MarketQualityAnalyzer {
  score(market: ParsedMarket): QualityScore {
    const flags: string[] = [];

    const liquidity = this.scoreLiquidity(market, flags);
    const priceRange = this.scorePriceRange(market, flags);
    const clarity = this.scoreClarity(market, flags);
    const resolution = this.scoreResolution(market, flags);
    const activity = this.scoreActivity(market, flags);

    const total = liquidity + priceRange + clarity + resolution + activity;

    return { total, liquidity, priceRange, clarity, resolution, activity, flags };
  }

  passes(market: ParsedMarket, minScore = MIN_QUALITY_SCORE): boolean {
    return this.score(market).total >= minScore;
  }

  // ── DIMENSION 1: LIQUIDITY QUALITY (0–25) ──────────────────────────────
  private scoreLiquidity(market: ParsedMarket, flags: string[]): number {
    const liq = market.liquidity;

    if (liq >= 200_000) return 25;
    if (liq >= 100_000) return 22;
    if (liq >= 50_000)  return 18;
    if (liq >= 20_000)  return 13;
    if (liq >= 10_000)  return 8;
    if (liq >= 5_000)   return 4;

    flags.push(`Low liquidity ($${(liq / 1000).toFixed(0)}K)`);
    return 0;
  }

  // ── DIMENSION 2: PRICE RANGE (0–20) ────────────────────────────────────
  // Reject near-certain outcomes (>95% / <5%) — little room for edge.
  // Best range: 15%–85% where mispricing is most likely.
  private scorePriceRange(market: ParsedMarket, flags: string[]): number {
    const p = market.yesPrice;

    if (p >= 0.97 || p <= 0.03) {
      flags.push(`Extreme price (${(p * 100).toFixed(0)}%) — near certainty`);
      return 0;
    }
    if (p >= 0.90 || p <= 0.10) {
      flags.push(`High-certainty price (${(p * 100).toFixed(0)}%)`);
      return 5;
    }
    if (p >= 0.80 || p <= 0.20) return 12;
    if (p >= 0.70 || p <= 0.30) return 17;
    return 20; // 30%–70% range: maximum uncertainty, most potential
  }

  // ── DIMENSION 3: QUESTION CLARITY (0–20) ───────────────────────────────
  private scoreClarity(market: ParsedMarket, flags: string[]): number {
    const q = market.question.toLowerCase();
    let score = 10;

    const vagueCount = VAGUE_TERMS.filter(t => q.includes(t)).length;
    const clearCount = CLEAR_TERMS.filter(t => q.includes(t)).length;

    score -= vagueCount * 3;
    score += clearCount * 2;

    // Questions with a specific number or year anchor score better
    if (/\b(20\d\d|\d+%|\$\d+|\d+ million|\d+ billion)\b/.test(q)) score += 4;

    // Very short questions are often vague; very long ones are often complex
    if (market.question.length < 20) {
      score -= 5;
      flags.push('Very short question text');
    } else if (market.question.length > 300) {
      score -= 3;
    }

    if (score <= 3) flags.push(`Low clarity question: "${market.question.substring(0, 60)}..."`);

    return Math.max(0, Math.min(20, score));
  }

  // ── DIMENSION 4: RESOLUTION PROXIMITY (0–20) ───────────────────────────
  // Markets that resolve in reasonable time windows score better.
  // Markets already past their end date get 0.
  private scoreResolution(market: ParsedMarket, flags: string[]): number {
    if (!market.endDate) return 8; // unknown — neutral score

    const now = Date.now();
    const end = new Date(market.endDate).getTime();
    const daysLeft = (end - now) / 86_400_000;

    if (daysLeft < 0) {
      flags.push('Market past resolution date');
      return 0;
    }
    if (daysLeft < 1)   return 8;   // too imminent — price already determined
    if (daysLeft < 7)   return 18;
    if (daysLeft < 30)  return 20;  // 1-4 weeks: sweet spot
    if (daysLeft < 90)  return 17;
    if (daysLeft < 180) return 13;
    if (daysLeft < 365) return 9;

    flags.push(`Long time to resolution (${Math.round(daysLeft)} days)`);
    return 5; // > 1 year: hard to forecast reliably
  }

  // ── DIMENSION 5: MARKET ACTIVITY (0–15) ────────────────────────────────
  private scoreActivity(market: ParsedMarket, flags: string[]): number {
    const volLiq = market.liquidity > 0 ? market.volume / market.liquidity : 0;

    if (volLiq >= 20)  return 15;
    if (volLiq >= 10)  return 12;
    if (volLiq >= 5)   return 9;
    if (volLiq >= 2)   return 6;
    if (volLiq >= 0.5) return 3;

    flags.push(`Very low activity (vol/liq=${volLiq.toFixed(2)}x)`);
    return 0;
  }
}
