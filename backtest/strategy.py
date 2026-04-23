"""
Strategy engines — generate signals from empirically validated inputs only.

ConsensusArbitrage:
  edge = cp - market_price
  No blending. cp comes from get_consensus_for_market() which uses
  a lookahead-safe prob snapshot strictly before the price observation date.

  Entry filters (ALL must pass):
    |edge| > MIN_EDGE (6%)
    N_forecasters ≥ 20 (Metaculus) / unfiltered for Manifold (no N available)
    days_to_resolution > 7 (avoid near-expiry pricing noise)
    market liquidity ≥ 5000
    consensus snapshot exists before price_date (no lookahead)

NegRiskArbitrage:
  Groups markets by neg_risk_group_id (NOT end_date — end_date conflates events).
  book_sum < 1 - TAKER_FEE → underpriced book → buy the SINGLE cheapest YES only.
  book_sum > 1 + TAKER_FEE → overpriced book → buy NO on the most expensive YES only.
  Never generate multiple correlated signals for the same event.
"""

import logging
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

log = logging.getLogger(__name__)

TAKER_FEE      = 0.02
MIN_EDGE       = 0.06    # 6% minimum — increased from 3% after audit
MIN_FORECASTERS = 20     # Metaculus only; Manifold has no reliable N
MIN_LIQUIDITY  = 5_000
MIN_DAYS_TO_RESOLUTION = 7


@dataclass
class Signal:
    market_id: str
    question: str
    side: str              # 'BUY_YES' | 'BUY_NO'
    market_price: float
    p_true: float          # direct consensus prob, no blending
    edge: float            # p_true - market_price
    ev: float
    kelly_f: float
    strategy: str          # 'consensus' | 'neg_risk'
    confidence: float      # based on N_forecasters, not similarity
    source: str
    liquidity: float = 0.0
    num_forecasters: Optional[int] = None
    price_date: str = ""   # timestamp of the price snapshot used


def _ev(p_true: float, market_price: float) -> float:
    """EV per unit stake for a binary bet at market_price."""
    if market_price <= 0 or market_price >= 1:
        return -999.0
    return p_true * (1 / market_price - 1) * (1 - TAKER_FEE) - (1 - p_true)


def _kelly(p_true: float, market_price: float) -> float:
    """Full Kelly fraction. f* = (p - q) / (1 - q). Kelly (1956)."""
    if market_price >= 1:
        return 0.0
    return max(0.0, (p_true - market_price) / (1 - market_price))


def _confidence(n_forecasters: Optional[int]) -> float:
    """
    Data-driven confidence based on forecaster count only.
    formula: min(1.0, N / 100)
    0 → 0.0, 20 → 0.20, 100 → 1.0.
    Not calibrated as a probability — used for sorting only.
    """
    if n_forecasters is None:
        return 0.3   # Manifold: lower default, no N available
    return min(1.0, n_forecasters / 100)


def _days_to_resolution(end_date: Optional[str]) -> Optional[float]:
    if not end_date:
        return None
    try:
        end = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        return (end - now).total_seconds() / 86400
    except Exception:
        return None


# ──────────────────────────────────────────────────────────────────────────
# STRATEGY 1: CONSENSUS ARBITRAGE
# ──────────────────────────────────────────────────────────────────────────

class ConsensusArbitrage:
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def generate_signals(self) -> list[Signal]:
        from question_matcher import get_consensus_for_market

        # Use the EARLIEST recorded price for each market (anti-lookahead).
        rows = self.conn.execute("""
            SELECT
                pm.id, pm.question, pm.end_date, pm.liquidity,
                pp.yes_price, pp.recorded_at AS price_date
            FROM poly_markets pm
            JOIN poly_prices pp ON pp.market_id = pm.id
            WHERE pp.recorded_at = (
                SELECT MIN(recorded_at) FROM poly_prices WHERE market_id = pm.id
            )
            AND pm.liquidity >= ?
        """, (MIN_LIQUIDITY,)).fetchall()

        signals: list[Signal] = []

        for row in rows:
            market_id   = row["id"]
            question    = row["question"]
            market_yes  = float(row["yes_price"])
            price_date  = row["price_date"]
            liquidity   = float(row["liquidity"] or 0)

            # Days-to-resolution filter
            days = _days_to_resolution(row["end_date"])
            if days is not None and days < MIN_DAYS_TO_RESOLUTION:
                continue

            # Consensus from snapshot strictly before price_date (no lookahead)
            consensus = get_consensus_for_market(self.conn, market_id, price_date)
            if consensus is None:
                # No pre-price snapshot available → cannot trade without lookahead
                continue

            cp              = consensus["probability"]  # raw consensus, no blending
            n_forecasters   = consensus.get("num_forecasters")
            source          = consensus["source"]

            # Forecaster count filter (Metaculus only)
            if source == "metaculus" and n_forecasters is not None:
                if n_forecasters < MIN_FORECASTERS:
                    continue

            # ── YES side ──────────────────────────────────────────────────
            edge_yes = cp - market_yes
            if edge_yes >= MIN_EDGE:
                ev = _ev(cp, market_yes)
                if ev > 0:
                    signals.append(Signal(
                        market_id=market_id,
                        question=question,
                        side="BUY_YES",
                        market_price=market_yes,
                        p_true=cp,
                        edge=edge_yes,
                        ev=ev,
                        kelly_f=_kelly(cp, market_yes),
                        strategy="consensus",
                        confidence=_confidence(n_forecasters),
                        source=source,
                        liquidity=liquidity,
                        num_forecasters=n_forecasters,
                        price_date=price_date,
                    ))

            # ── NO side: consensus NO probability = 1 - cp ────────────────
            cp_no      = 1 - cp
            market_no  = 1 - market_yes
            edge_no    = cp_no - market_no
            if edge_no >= MIN_EDGE:
                ev = _ev(cp_no, market_no)
                if ev > 0:
                    signals.append(Signal(
                        market_id=market_id,
                        question=question,
                        side="BUY_NO",
                        market_price=market_no,
                        p_true=cp_no,
                        edge=edge_no,
                        ev=ev,
                        kelly_f=_kelly(cp_no, market_no),
                        strategy="consensus",
                        confidence=_confidence(n_forecasters),
                        source=source,
                        liquidity=liquidity,
                        num_forecasters=n_forecasters,
                        price_date=price_date,
                    ))

        log.info("ConsensusArbitrage: %d signals", len(signals))
        return signals


# ──────────────────────────────────────────────────────────────────────────
# STRATEGY 2: NEGRISK ARBITRAGE
# ──────────────────────────────────────────────────────────────────────────

class NegRiskArbitrage:
    """
    Groups markets by neg_risk_group_id — the actual Polymarket event identifier,
    NOT end_date (which can alias unrelated events).

    A negRisk group is mutually exclusive and exhaustive: exactly one outcome
    resolves YES, rest resolve NO. Sum of YES prices should equal 1.0.

    Underpriced book (sum < 1 - TAKER_FEE):
      → Buy YES on the SINGLE cheapest outcome (highest normalized edge).
      → One signal per group maximum.

    Overpriced book (sum > 1 + TAKER_FEE):
      → Buy NO on the SINGLE most expensive YES (highest raw price / most overpriced).
      → One signal per group maximum.
      → The NO side of outcome i has price ≈ 1 - YES_i and pays off if i does NOT win.

    Rationale for single signal per group:
      Multiple outcomes in the same negRisk event are perfectly correlated
      (exactly one wins). Kelly criterion requires independent bets. Betting
      all outcomes simultaneously is equivalent to buying the entire book at
      a discounted/premium price — which is a different and riskier trade.
    """

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def generate_signals(self) -> list[Signal]:
        rows = self.conn.execute("""
            SELECT
                pm.id, pm.question, pm.end_date, pm.liquidity,
                pm.neg_risk_group_id,
                pp.yes_price, pp.recorded_at AS price_date
            FROM poly_markets pm
            JOIN poly_prices pp ON pp.market_id = pm.id
            WHERE pm.neg_risk = 1
              AND pm.neg_risk_group_id IS NOT NULL
              AND pm.liquidity >= ?
              AND pp.recorded_at = (
                  SELECT MIN(recorded_at) FROM poly_prices WHERE market_id = pm.id
              )
            ORDER BY pm.neg_risk_group_id, pm.id
        """, (MIN_LIQUIDITY,)).fetchall()

        if not rows:
            return []

        # Group by the actual event identifier
        groups: dict[str, list] = {}
        for row in rows:
            key = row["neg_risk_group_id"]
            groups.setdefault(key, []).append(row)

        signals: list[Signal] = []

        for group_id, group in groups.items():
            if len(group) < 2:
                continue

            book_sum = sum(float(r["yes_price"]) for r in group)
            deviation = book_sum - 1.0

            # Underpriced: sum < 1 - fee → buy cheapest YES
            if deviation < -(TAKER_FEE):
                # Sort by YES price ascending — cheapest is highest relative edge
                cheapest = min(group, key=lambda r: float(r["yes_price"]))
                market_price = float(cheapest["yes_price"])
                # Normalized probability: market_price / book_sum
                p_true = market_price / book_sum
                edge = p_true - market_price

                if edge >= MIN_EDGE:
                    ev = _ev(p_true, market_price)
                    if ev > 0:
                        signals.append(Signal(
                            market_id=cheapest["id"],
                            question=cheapest["question"],
                            side="BUY_YES",
                            market_price=market_price,
                            p_true=p_true,
                            edge=edge,
                            ev=ev,
                            kelly_f=_kelly(p_true, market_price),
                            strategy="neg_risk",
                            confidence=0.75,
                            source="neg_risk",
                            liquidity=float(cheapest["liquidity"] or 0),
                            price_date=cheapest["price_date"],
                        ))

            # Overpriced: sum > 1 + fee → buy NO on most expensive YES
            elif deviation > TAKER_FEE:
                most_expensive = max(group, key=lambda r: float(r["yes_price"]))
                yes_price = float(most_expensive["yes_price"])
                # NO price ≈ 1 - yes_price (binary market)
                no_price = 1 - yes_price
                # True NO probability: (1 - yes_price/book_sum)
                p_true_no = 1 - (yes_price / book_sum)
                edge = p_true_no - no_price

                if edge >= MIN_EDGE:
                    ev = _ev(p_true_no, no_price)
                    if ev > 0:
                        signals.append(Signal(
                            market_id=most_expensive["id"],
                            question=most_expensive["question"],
                            side="BUY_NO",
                            market_price=no_price,
                            p_true=p_true_no,
                            edge=edge,
                            ev=ev,
                            kelly_f=_kelly(p_true_no, no_price),
                            strategy="neg_risk",
                            confidence=0.75,
                            source="neg_risk",
                            liquidity=float(most_expensive["liquidity"] or 0),
                            price_date=most_expensive["price_date"],
                        ))

        log.info("NegRiskArbitrage: %d signals (%d groups)", len(signals), len(groups))
        return signals


# ──────────────────────────────────────────────────────────────────────────
# COMBINED — with source filtering for ablation tests
# ──────────────────────────────────────────────────────────────────────────

def generate_all_signals(
    conn: sqlite3.Connection,
    use_consensus: bool = True,
    use_neg_risk: bool = True,
    consensus_sources: Optional[set[str]] = None,   # None = all sources
) -> list[Signal]:
    """
    Generate and deduplicate signals from all enabled strategies.
    consensus_sources: restrict to {'metaculus'} or {'manifold'} for ablation.
    """
    all_signals: list[Signal] = []

    if use_consensus:
        raw = ConsensusArbitrage(conn).generate_signals()
        if consensus_sources:
            raw = [s for s in raw if s.source in consensus_sources]
        all_signals.extend(raw)

    if use_neg_risk:
        all_signals.extend(NegRiskArbitrage(conn).generate_signals())

    # One signal per (market, side) — keep highest EV
    seen: dict[tuple[str, str], Signal] = {}
    for s in all_signals:
        key = (s.market_id, s.side)
        if key not in seen or s.ev > seen[key].ev:
            seen[key] = s

    ranked = sorted(seen.values(), key=lambda s: s.ev, reverse=True)
    log.info("Total signals after dedup: %d", len(ranked))
    return ranked
