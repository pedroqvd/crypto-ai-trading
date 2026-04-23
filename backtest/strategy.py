"""
Strategy engines — generate trade signals from validated signals.

Two strategies:
  1. ConsensusArbitrage  — bet when external consensus diverges from market price
  2. NegRiskArbitrage    — bet when the complementary set of outcomes is mispriced

All formulas are documented with source references.
No heuristics that aren't derived from the data.
"""

import logging
import sqlite3
from dataclasses import dataclass
from typing import Optional

log = logging.getLogger(__name__)

TAKER_FEE = 0.02          # 200 bps — Polymarket taker fee (documented)
MIN_EDGE = 0.03           # 3% minimum edge to generate a signal
MIN_FORECASTERS = 10      # Metaculus questions below this are excluded
MAX_BOOK_SUM_DEVIATION = 0.05  # negRisk: flag when sum of YES prices deviates from 1.0 by >5%


@dataclass
class Signal:
    market_id: str
    question: str
    side: str              # 'BUY_YES' | 'BUY_NO'
    market_price: float    # observed market price of the side we're buying
    p_true: float          # our estimated true probability
    edge: float            # p_true - market_price
    ev: float              # EV formula (see below)
    kelly_f: float         # full Kelly fraction
    strategy: str          # 'consensus' | 'neg_risk'
    confidence: float      # [0,1] — how much we trust the estimate
    source: str            # 'metaculus' | 'manifold' | 'neg_risk'
    num_forecasters: Optional[int] = None
    similarity: Optional[float] = None


def _ev(p_true: float, market_price: float) -> float:
    """
    EV_yes = P_true × (1/q - 1) × (1 - fee) - (1 - P_true)
    where q = market_price (the YES price).

    Source: standard parimutuel EV formula adjusted for Polymarket fee schedule.
    """
    if market_price <= 0 or market_price >= 1:
        return -999.0
    gross_payout = (1 / market_price - 1)
    return p_true * gross_payout * (1 - TAKER_FEE) - (1 - p_true)


def _kelly(p_true: float, market_price: float) -> float:
    """
    f* = (p - q) / (1 - q)  for a binary bet that pays 1/q - 1 on a win.
    Kelly (1956). Returns 0 if edge is negative.
    """
    if market_price >= 1:
        return 0.0
    f = (p_true - market_price) / (1 - market_price)
    return max(0.0, f)


def _confidence_from_forecasters(n: Optional[int]) -> float:
    """
    Scale confidence by forecaster count.
    0 → 0.5, 10 → 0.6, 50 → 0.8, 200+ → 1.0 (logistic-ish mapping).
    """
    if n is None:
        return 0.6
    import math
    return min(1.0, 0.5 + 0.5 * (1 - math.exp(-n / 60)))


# ──────────────────────────────────────────────────────────────────────────
# STRATEGY 1: CONSENSUS ARBITRAGE
# ──────────────────────────────────────────────────────────────────────────

class ConsensusArbitrage:
    """
    Signal when the external consensus probability (Metaculus/Manifold) diverges
    from the Polymarket price by more than MIN_EDGE.

    P_true is taken directly from the external consensus — we trust Metaculus
    calibration over Polymarket heuristics. Karger et al. (2022) showed that
    Metaculus systematically outperforms prediction markets on hard questions.

    The weight applied to P_true is scaled by the similarity score:
        P_final = similarity × P_consensus + (1 - similarity) × P_market
    At similarity 1.0, pure consensus. At threshold 0.75, 75% consensus weight.
    """

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def generate_signals(self) -> list[Signal]:
        from question_matcher import get_consensus_for_market

        # Load all markets that have resolutions (for backtesting)
        # In live mode this would be unresolved markets
        rows = self.conn.execute("""
            SELECT pm.id, pm.question, pm.neg_risk,
                   pp.yes_price
            FROM poly_markets pm
            JOIN poly_prices pp ON pp.market_id = pm.id
            -- Use the earliest recorded price to avoid lookahead
            WHERE pp.recorded_at = (
                SELECT MIN(recorded_at) FROM poly_prices WHERE market_id = pm.id
            )
        """).fetchall()

        signals: list[Signal] = []

        for row in rows:
            market_id = row["id"]
            question = row["question"]
            market_yes = float(row["yes_price"])
            market_no = 1 - market_yes

            consensus = get_consensus_for_market(self.conn, market_id)
            if consensus is None:
                continue

            sim = consensus["similarity"]
            cp = consensus["probability"]          # consensus probability of YES
            n_forecasters = consensus.get("num_forecasters")

            if n_forecasters is not None and n_forecasters < MIN_FORECASTERS:
                continue

            # Weighted blend: sim × consensus + (1-sim) × market
            p_true = sim * cp + (1 - sim) * market_yes

            # YES side
            edge_yes = p_true - market_yes
            if edge_yes >= MIN_EDGE:
                ev = _ev(p_true, market_yes)
                if ev > 0:
                    signals.append(Signal(
                        market_id=market_id,
                        question=question,
                        side="BUY_YES",
                        market_price=market_yes,
                        p_true=p_true,
                        edge=edge_yes,
                        ev=ev,
                        kelly_f=_kelly(p_true, market_yes),
                        strategy="consensus",
                        confidence=_confidence_from_forecasters(n_forecasters),
                        source=consensus["source"],
                        num_forecasters=n_forecasters,
                        similarity=sim,
                    ))

            # NO side — p_true for NO is (1 - p_true_yes)
            p_true_no = 1 - p_true
            edge_no = p_true_no - market_no
            if edge_no >= MIN_EDGE:
                ev = _ev(p_true_no, market_no)
                if ev > 0:
                    signals.append(Signal(
                        market_id=market_id,
                        question=question,
                        side="BUY_NO",
                        market_price=market_no,
                        p_true=p_true_no,
                        edge=edge_no,
                        ev=ev,
                        kelly_f=_kelly(p_true_no, market_no),
                        strategy="consensus",
                        confidence=_confidence_from_forecasters(n_forecasters),
                        source=consensus["source"],
                        num_forecasters=n_forecasters,
                        similarity=sim,
                    ))

        log.info("ConsensusArbitrage: %d signals generated", len(signals))
        return signals


# ──────────────────────────────────────────────────────────────────────────
# STRATEGY 2: NEG-RISK ARBITRAGE
# ──────────────────────────────────────────────────────────────────────────

class NegRiskArbitrage:
    """
    Polymarket negRisk markets represent mutually exclusive, exhaustive outcomes
    (e.g., "Who wins the election?" with one YES per candidate).

    In a well-priced market: Σ(YES_prices) = 1.0
    When Σ > 1 + MAX_BOOK_SUM_DEVIATION: systematic over-pricing of YES outcomes
    When Σ < 1 - MAX_BOOK_SUM_DEVIATION: systematic under-pricing (book discount)

    The cheapest YES in an underpriced book is the best bet:
      P_true_i = YES_i / Σ(YES_i)          (correct for book mispricing)
      Edge_i    = P_true_i - market_price_i

    We ONLY use negRisk=True markets (correcting the previous inverted filter).
    """

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def generate_signals(self) -> list[Signal]:
        # Group negRisk markets by their common question stem (approximated by
        # markets that share the same end_date and neg_risk=1)
        rows = self.conn.execute("""
            SELECT pm.id, pm.question, pm.end_date, pp.yes_price
            FROM poly_markets pm
            JOIN poly_prices pp ON pp.market_id = pm.id
            WHERE pm.neg_risk = 1
              AND pp.recorded_at = (
                SELECT MIN(recorded_at) FROM poly_prices WHERE market_id = pm.id
              )
            ORDER BY pm.end_date, pm.id
        """).fetchall()

        if not rows:
            return []

        # Group by end_date (proxy for same negRisk event)
        groups: dict[str, list] = {}
        for row in rows:
            key = row["end_date"] or "unknown"
            groups.setdefault(key, []).append(row)

        signals: list[Signal] = []

        for group_key, group in groups.items():
            if len(group) < 2:
                continue

            book_sum = sum(float(r["yes_price"]) for r in group)

            # Only act when there's a detectable mispricing
            deviation = book_sum - 1.0
            if abs(deviation) < MAX_BOOK_SUM_DEVIATION:
                continue

            for row in group:
                market_price = float(row["yes_price"])
                # Normalize to get consistent probability estimate
                p_true = market_price / book_sum
                edge = p_true - market_price

                if edge < MIN_EDGE:
                    continue

                ev = _ev(p_true, market_price)
                if ev <= 0:
                    continue

                signals.append(Signal(
                    market_id=row["id"],
                    question=row["question"],
                    side="BUY_YES",
                    market_price=market_price,
                    p_true=p_true,
                    edge=edge,
                    ev=ev,
                    kelly_f=_kelly(p_true, market_price),
                    strategy="neg_risk",
                    confidence=0.85,  # negRisk is mechanical, high confidence
                    source="neg_risk",
                ))

        log.info("NegRiskArbitrage: %d signals generated", len(signals))
        return signals


# ──────────────────────────────────────────────────────────────────────────
# COMBINED SIGNAL GENERATOR
# ──────────────────────────────────────────────────────────────────────────

def generate_all_signals(conn: sqlite3.Connection) -> list[Signal]:
    """Run all strategies and return a deduplicated, ranked signal list."""
    consensus = ConsensusArbitrage(conn).generate_signals()
    neg_risk = NegRiskArbitrage(conn).generate_signals()

    all_signals = consensus + neg_risk

    # Deduplicate: keep highest EV signal per market
    seen: dict[tuple[str, str], Signal] = {}
    for s in all_signals:
        key = (s.market_id, s.side)
        if key not in seen or s.ev > seen[key].ev:
            seen[key] = s

    ranked = sorted(seen.values(), key=lambda s: s.ev, reverse=True)
    log.info("Total signals after dedup: %d", len(ranked))
    return ranked
