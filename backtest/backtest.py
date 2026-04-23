"""
Backtesting engine.

Slippage model (corrected):
    slippage_pct = max(0.01, 0.02 * stake / liquidity)
    This is 2% of the stake-to-liquidity ratio, floored at 1%.
    At stake=$100, liquidity=$10k: 2% × (100/10000) = 0.2% slippage → $0.20.
    At stake=$1000, liquidity=$5k: 2% × (1000/5000) = 0.4% → $4.00.
    Realistic for thin prediction market books.

WR criterion (corrected):
    real_wr > expected_wr + 0.02
    where expected_wr = mean(market_price for BUY_YES signals)
                      = mean(1 - market_price for BUY_NO signals)
    Win rate only meaningful relative to the implied probability, not a fixed 52%.

Added metrics:
    Sharpe ratio (proxy): mean_pnl_per_trade / std_pnl_per_trade × sqrt(N)
    Calibration: mean absolute error |p_true - outcome| — detects lookahead if very low
    Return distribution: mean, std, skewness, 5th percentile

outcome_override: dict[market_id → float] — used by shuffle test to inject
    permuted outcomes without modifying the DB.
"""

import logging
import sqlite3
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from strategy import Signal

log = logging.getLogger(__name__)

TAKER_FEE       = 0.02
KELLY_FRACTION  = 0.25
MAX_POSITION_PCT = 0.05


@dataclass
class TradeResult:
    market_id: str
    question: str
    side: str
    signal_date: str
    resolution_date: str
    market_price: float
    p_true: float
    outcome: float
    expected_win_prob: float   # market_price (for WR comparison)
    stake: float
    pnl: float
    ev_forecast: float
    strategy: str
    source: str


@dataclass
class BacktestResult:
    n_trades: int
    brier_score_strategy: float
    brier_score_baseline: float
    skill_score: float
    # WR metrics
    observed_wr: float
    expected_wr: float          # mean(market_price) — the correct baseline
    wr_excess: float            # observed_wr - expected_wr
    # PnL metrics
    mean_ev: float
    total_pnl: float
    total_return: float
    max_drawdown: float
    sharpe_proxy: float         # mean_pnl / std_pnl × sqrt(N)
    # Distribution
    pnl_std: float
    pnl_skew: float
    pnl_p05: float              # 5th percentile (tail risk)
    # Calibration sanity check
    mean_abs_error: float       # |p_true - outcome|, suspiciously low → lookahead
    trades: list[TradeResult] = field(default_factory=list)
    by_strategy: dict = field(default_factory=dict)
    by_source: dict = field(default_factory=dict)


# ──────────────────────────────────────────────
# HELPERS
# ──────────────────────────────────────────────

def _slippage(stake: float, liquidity: float) -> float:
    """Realistic slippage: 2% × (stake/liquidity), floored at 1%."""
    if liquidity <= 0:
        return stake * 0.02   # assume worst-case 2% if no data
    return stake * max(0.01, 0.02 * stake / liquidity)


def _brier_score(preds: list[float], outcomes: list[float]) -> float:
    if not preds:
        return 1.0
    return float(np.mean((np.array(preds) - np.array(outcomes)) ** 2))


def _compute_drawdown(pnl_series: list[float]) -> float:
    if not pnl_series:
        return 0.0
    cum = np.cumsum(pnl_series)
    peak = np.maximum.accumulate(cum)
    return float(np.max(peak - cum))


def _skewness(x: np.ndarray) -> float:
    if len(x) < 3:
        return 0.0
    mu = np.mean(x)
    std = np.std(x)
    if std == 0:
        return 0.0
    return float(np.mean(((x - mu) / std) ** 3))


# ──────────────────────────────────────────────
# BACKTESTER
# ──────────────────────────────────────────────

class Backtester:
    def __init__(self, conn: sqlite3.Connection, bankroll: float = 1000.0):
        self.conn = conn
        self.bankroll = bankroll

    def _get_outcome(
        self,
        market_id: str,
        outcome_override: Optional[dict[str, float]],
    ) -> Optional[float]:
        if outcome_override is not None:
            return outcome_override.get(market_id)

        row = self.conn.execute(
            "SELECT outcome FROM poly_resolutions WHERE market_id = ?", (market_id,)
        ).fetchone()
        if not row:
            return None
        if row["outcome"] == "YES":
            return 1.0
        if row["outcome"] == "NO":
            return 0.0
        return None

    def _get_resolution_date(self, market_id: str) -> Optional[str]:
        row = self.conn.execute(
            "SELECT resolved_at FROM poly_resolutions WHERE market_id = ?", (market_id,)
        ).fetchone()
        return row["resolved_at"] if row else None

    def run(
        self,
        signals: list[Signal],
        train_ratio: float = 0.6,
        outcome_override: Optional[dict[str, float]] = None,
    ) -> BacktestResult:
        _empty = BacktestResult(
            0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0
        )

        if not signals:
            return _empty

        resolvable: list[tuple[Signal, float, str]] = []
        for sig in signals:
            outcome = self._get_outcome(sig.market_id, outcome_override)
            res_date = self._get_resolution_date(sig.market_id)
            if outcome is not None and res_date is not None:
                resolvable.append((sig, outcome, res_date))

        if not resolvable:
            log.warning("No resolvable signals — cannot backtest")
            return _empty

        # Walk-forward: sort by resolution date, test on last (1-train_ratio) fraction
        resolvable.sort(key=lambda x: x[2])
        split_idx = int(len(resolvable) * train_ratio)
        test_set = resolvable[split_idx:]

        log.info("Backtest: %d signals → %d resolvable → %d in test set (train_ratio=%.1f)",
                 len(signals), len(resolvable), len(test_set), train_ratio)

        trades: list[TradeResult] = []
        current_bankroll = self.bankroll

        for sig, raw_outcome, res_date in test_set:
            # Convert to side-appropriate outcome
            side_outcome = raw_outcome if sig.side == "BUY_YES" else (1 - raw_outcome)

            kelly_stake = sig.kelly_f * KELLY_FRACTION * current_bankroll
            stake = min(kelly_stake, current_bankroll * MAX_POSITION_PCT)
            if stake < 1.0:
                continue

            slip = _slippage(stake, sig.liquidity)
            effective_stake = stake + slip

            gross_payout = (1 / sig.market_price - 1) * (1 - TAKER_FEE)
            pnl = (effective_stake * gross_payout * side_outcome
                   - effective_stake * (1 - side_outcome))

            current_bankroll = max(current_bankroll + pnl, 1.0)

            # expected_win_prob: what the market implies for our side
            expected_win_prob = (sig.market_price if sig.side == "BUY_YES"
                                 else 1 - sig.market_price)

            trades.append(TradeResult(
                market_id=sig.market_id,
                question=sig.question,
                side=sig.side,
                signal_date=sig.price_date,
                resolution_date=res_date,
                market_price=sig.market_price,
                p_true=sig.p_true,
                outcome=side_outcome,
                expected_win_prob=expected_win_prob,
                stake=effective_stake,
                pnl=pnl,
                ev_forecast=sig.ev,
                strategy=sig.strategy,
                source=sig.source,
            ))

        if not trades:
            return _empty

        # ── BRIER / SKILL ──────────────────────────────────────────────────
        outcomes   = [t.outcome for t in trades]
        strat_pred = [t.p_true for t in trades]
        base_pred  = [t.expected_win_prob for t in trades]

        bs_strat    = _brier_score(strat_pred, outcomes)
        bs_baseline = _brier_score(base_pred, outcomes)
        skill_score = 1 - (bs_strat / bs_baseline) if bs_baseline > 0 else 0.0

        # ── WIN RATE (corrected) ───────────────────────────────────────────
        observed_wr = float(np.mean([1 if t.outcome == 1.0 else 0 for t in trades]))
        expected_wr = float(np.mean([t.expected_win_prob for t in trades]))
        wr_excess   = observed_wr - expected_wr

        # ── PnL METRICS ───────────────────────────────────────────────────
        pnl_arr     = np.array([t.pnl for t in trades])
        mean_ev     = float(np.mean([t.ev_forecast for t in trades]))
        total_pnl   = float(np.sum(pnl_arr))
        total_return = total_pnl / self.bankroll
        max_drawdown = _compute_drawdown(list(pnl_arr))

        pnl_std  = float(np.std(pnl_arr))
        pnl_skew = _skewness(pnl_arr)
        pnl_p05  = float(np.percentile(pnl_arr, 5))

        # Sharpe proxy: mean / std × sqrt(N)
        sharpe_proxy = (
            (float(np.mean(pnl_arr)) / pnl_std * np.sqrt(len(trades)))
            if pnl_std > 0 else 0.0
        )

        # Calibration sanity: if MAE < 0.05 on N > 100 trades → suspicious lookahead
        mean_abs_error = float(np.mean(np.abs(np.array(strat_pred) - np.array(outcomes))))

        # ── PER-STRATEGY / SOURCE BREAKDOWN ───────────────────────────────
        by_strategy: dict[str, dict] = {}
        by_source: dict[str, dict] = {}

        for t in trades:
            for key, d in [(t.strategy, by_strategy), (t.source, by_source)]:
                d.setdefault(key, {"n": 0, "wins": 0, "pnl": 0.0, "expected_wr": 0.0})
                d[key]["n"] += 1
                d[key]["wins"] += int(t.outcome == 1.0)
                d[key]["pnl"] += t.pnl
                d[key]["expected_wr"] += t.expected_win_prob

        return BacktestResult(
            n_trades=len(trades),
            brier_score_strategy=bs_strat,
            brier_score_baseline=bs_baseline,
            skill_score=skill_score,
            observed_wr=observed_wr,
            expected_wr=expected_wr,
            wr_excess=wr_excess,
            mean_ev=mean_ev,
            total_pnl=total_pnl,
            total_return=total_return,
            max_drawdown=max_drawdown,
            sharpe_proxy=sharpe_proxy,
            pnl_std=pnl_std,
            pnl_skew=pnl_skew,
            pnl_p05=pnl_p05,
            mean_abs_error=mean_abs_error,
            trades=trades,
            by_strategy=by_strategy,
            by_source=by_source,
        )
