"""
Backtesting engine — measures strategy performance on historical resolved markets.

Metrics:
  Brier Score   : (1/N) Σ (p_true_i - outcome_i)²   [lower is better, 0 is perfect]
  Skill Score   : 1 - (BS_strategy / BS_baseline)     [positive = beats market]
  Win Rate      : fraction of trades where outcome matches predicted side
  Mean EV       : average EV per trade
  Total Return  : sum of (outcome - stake) / stake per trade
  Max Drawdown  : maximum peak-to-trough loss in cumulative PnL

Baseline is the MARKET PRICE itself — not 0.5 (that's the naive baseline).
Using the market as baseline is the standard in forecasting literature
(Brier 1950, Gneiting & Raftery 2007).

Walk-forward split:
  train_ratio=0.6 means first 60% of data by date is "training",
  last 40% is "test". Only test-period metrics count for the verdict.

No lookahead bias:
  - Prices are looked up via price_recorder.get_price_at(as_of=signal_date)
  - Consensus probability is recorded at match time, not resolution time
  - All outcomes come from poly_resolutions which is only populated post-close
"""

import logging
import sqlite3
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from strategy import Signal

log = logging.getLogger(__name__)

TAKER_FEE = 0.02
KELLY_FRACTION = 0.25   # Quarter-Kelly for position sizing
MAX_POSITION_PCT = 0.05  # Max 5% of bankroll per trade
LINEAR_SLIPPAGE_PER_1K = 0.001  # 0.1% per $1000 traded (conservative estimate)


@dataclass
class TradeResult:
    market_id: str
    question: str
    side: str
    signal_date: str
    resolution_date: str
    market_price: float
    p_true: float
    outcome: float       # 1.0 if we were right, 0.0 if wrong
    stake: float
    pnl: float           # after fee + slippage
    ev_forecast: float   # EV we estimated at signal time
    strategy: str
    source: str


@dataclass
class BacktestResult:
    n_trades: int
    brier_score_strategy: float
    brier_score_baseline: float
    skill_score: float
    win_rate: float
    mean_ev: float
    total_pnl: float
    total_return: float
    max_drawdown: float
    trades: list[TradeResult] = field(default_factory=list)
    by_strategy: dict = field(default_factory=dict)
    by_source: dict = field(default_factory=dict)


def _slippage(stake: float) -> float:
    """Linear slippage model: 0.1% per $1000 notional."""
    return stake * LINEAR_SLIPPAGE_PER_1K * (stake / 1000)


def _compute_drawdown(pnl_series: list[float]) -> float:
    """Maximum peak-to-trough drawdown in absolute PnL."""
    if not pnl_series:
        return 0.0
    cumulative = np.cumsum(pnl_series)
    peak = np.maximum.accumulate(cumulative)
    drawdown = peak - cumulative
    return float(np.max(drawdown))


def _brier_score(predictions: list[float], outcomes: list[float]) -> float:
    """Brier Score = mean squared error of probability forecasts."""
    if not predictions:
        return 1.0  # worst possible
    preds = np.array(predictions)
    outs = np.array(outcomes)
    return float(np.mean((preds - outs) ** 2))


class Backtester:
    def __init__(self, conn: sqlite3.Connection, bankroll: float = 1000.0):
        self.conn = conn
        self.bankroll = bankroll

    def _get_outcome(self, market_id: str) -> Optional[float]:
        """Return 1.0 for YES resolution, 0.0 for NO, None if not resolved/invalid."""
        row = self.conn.execute(
            "SELECT outcome FROM poly_resolutions WHERE market_id = ?", (market_id,)
        ).fetchone()
        if not row:
            return None
        if row["outcome"] == "YES":
            return 1.0
        if row["outcome"] == "NO":
            return 0.0
        return None  # INVALID

    def _get_resolution_date(self, market_id: str) -> Optional[str]:
        row = self.conn.execute(
            "SELECT resolved_at FROM poly_resolutions WHERE market_id = ?", (market_id,)
        ).fetchone()
        return row["resolved_at"] if row else None

    def _stake_for_signal(self, signal: Signal, current_bankroll: float) -> float:
        """Quarter-Kelly position sizing with hard cap."""
        kelly_stake = signal.kelly_f * KELLY_FRACTION * current_bankroll
        max_stake = current_bankroll * MAX_POSITION_PCT
        return min(kelly_stake, max_stake)

    def run(self, signals: list[Signal], train_ratio: float = 0.6) -> BacktestResult:
        """
        Run backtest on all signals that have resolutions.
        Walk-forward: only signals from the test window are reported.
        """
        if not signals:
            log.warning("No signals to backtest")
            return BacktestResult(0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)

        # Attach resolution info to signals — only keep resolvable ones
        resolvable: list[tuple[Signal, float, str]] = []
        for sig in signals:
            outcome = self._get_outcome(sig.market_id)
            res_date = self._get_resolution_date(sig.market_id)
            if outcome is not None and res_date is not None:
                resolvable.append((sig, outcome, res_date))

        if not resolvable:
            log.warning("No signals have resolutions — cannot backtest")
            return BacktestResult(0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)

        # Sort chronologically by resolution date for walk-forward split
        resolvable.sort(key=lambda x: x[2])
        split_idx = int(len(resolvable) * train_ratio)
        test_set = resolvable[split_idx:]

        log.info("Backtest: %d total signals → %d resolvable → %d in test set",
                 len(signals), len(resolvable), len(test_set))

        trades: list[TradeResult] = []
        current_bankroll = self.bankroll

        for sig, outcome, res_date in test_set:
            # Outcome from BUY_YES perspective: YES resolution = win
            side_outcome = outcome if sig.side == "BUY_YES" else 1 - outcome

            stake = self._stake_for_signal(sig, current_bankroll)
            if stake < 1.0:
                continue

            slip = _slippage(stake)
            effective_stake = stake + slip

            # Gross profit if we win: stake × (1/price - 1) × (1 - fee)
            gross_payout = (1 / sig.market_price - 1) * (1 - TAKER_FEE)
            pnl = effective_stake * gross_payout * side_outcome - effective_stake * (1 - side_outcome)

            current_bankroll = max(current_bankroll + pnl, 1.0)  # never go below $1

            # Signal date = earliest price snapshot (approximation)
            price_row = self.conn.execute("""
                SELECT recorded_at FROM poly_prices WHERE market_id = ?
                ORDER BY recorded_at ASC LIMIT 1
            """, (sig.market_id,)).fetchone()
            signal_date = price_row["recorded_at"] if price_row else res_date

            trades.append(TradeResult(
                market_id=sig.market_id,
                question=sig.question,
                side=sig.side,
                signal_date=signal_date,
                resolution_date=res_date,
                market_price=sig.market_price,
                p_true=sig.p_true,
                outcome=side_outcome,
                stake=effective_stake,
                pnl=pnl,
                ev_forecast=sig.ev,
                strategy=sig.strategy,
                source=sig.source,
            ))

        if not trades:
            return BacktestResult(0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)

        # ── METRICS ──────────────────────────────────────────────────────
        strategy_preds = [t.p_true for t in trades]
        baseline_preds = [t.market_price for t in trades]
        outcomes = [t.outcome for t in trades]

        bs_strategy = _brier_score(strategy_preds, outcomes)
        bs_baseline = _brier_score(baseline_preds, outcomes)
        skill_score = 1 - (bs_strategy / bs_baseline) if bs_baseline > 0 else 0.0

        win_rate = float(np.mean([1 if t.outcome == 1.0 else 0 for t in trades]))
        mean_ev = float(np.mean([t.ev_forecast for t in trades]))
        total_pnl = float(sum(t.pnl for t in trades))
        total_return = total_pnl / self.bankroll
        max_drawdown = _compute_drawdown([t.pnl for t in trades])

        # Per-strategy breakdown
        by_strategy: dict[str, dict] = {}
        for t in trades:
            key = t.strategy
            by_strategy.setdefault(key, {"n": 0, "wins": 0, "pnl": 0.0})
            by_strategy[key]["n"] += 1
            by_strategy[key]["wins"] += int(t.outcome == 1.0)
            by_strategy[key]["pnl"] += t.pnl

        # Per-source breakdown
        by_source: dict[str, dict] = {}
        for t in trades:
            key = t.source
            by_source.setdefault(key, {"n": 0, "wins": 0, "pnl": 0.0})
            by_source[key]["n"] += 1
            by_source[key]["wins"] += int(t.outcome == 1.0)
            by_source[key]["pnl"] += t.pnl

        return BacktestResult(
            n_trades=len(trades),
            brier_score_strategy=bs_strategy,
            brier_score_baseline=bs_baseline,
            skill_score=skill_score,
            win_rate=win_rate,
            mean_ev=mean_ev,
            total_pnl=total_pnl,
            total_return=total_return,
            max_drawdown=max_drawdown,
            trades=trades,
            by_strategy=by_strategy,
            by_source=by_source,
        )
