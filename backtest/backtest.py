"""
Backtesting engine with execution realism:
  - order-book proxy (dynamic spread + depth)
  - partial fills and queue penalty
  - latency between signal and execution
  - non-linear impact/slippage
  - event-level exposure caps (correlation control)
"""

import logging
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional

import numpy as np

from strategy import Signal

log = logging.getLogger(__name__)

TAKER_FEE = 0.02
KELLY_FRACTION = 0.25
MAX_POSITION_PCT = 0.05
MAX_EVENT_EXPOSURE_PCT = 0.10


@dataclass
class TradeResult:
    market_id: str
    question: str
    side: str
    signal_date: str
    execution_date: str
    resolution_date: str
    market_price: float
    execution_price: float
    p_true: float
    outcome: float
    expected_win_prob: float
    requested_stake: float
    filled_stake: float
    fill_ratio: float
    slippage_paid: float
    pnl: float
    ev_forecast: float
    strategy: str
    source: str
    event_group_id: str


@dataclass
class BacktestResult:
    n_trades: int
    brier_score_strategy: float
    brier_score_baseline: float
    skill_score: float
    observed_wr: float
    expected_wr: float
    wr_excess: float
    mean_ev: float
    total_pnl: float
    total_return: float
    max_drawdown: float
    sharpe_proxy: float
    pnl_std: float
    pnl_skew: float
    pnl_p05: float
    mean_abs_error: float
    n_unfilled: int
    trades: list[TradeResult] = field(default_factory=list)
    by_strategy: dict = field(default_factory=dict)
    by_source: dict = field(default_factory=dict)


def _slippage(stake: float, liquidity: float) -> float:
    if liquidity <= 0:
        return stake * 0.02
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


def _parse_iso(ts: str) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except Exception:
        return None


def _to_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


class Backtester:
    def __init__(self, conn: sqlite3.Connection, bankroll: float = 1000.0, seed: int = 42):
        self.conn = conn
        self.bankroll = bankroll
        self.rng = np.random.default_rng(seed)

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

    def _simulate_execution(
        self,
        sig: Signal,
        requested_stake: float,
        latency_seconds: float,
        stress_mult: float,
    ) -> tuple[float, float, float, float]:
        """Worst-case taker execution over synthetic orderbook."""
        liq = max(1.0, float(sig.liquidity or 0))
        mid = min(max(float(sig.market_price), 0.01), 0.99)

        spread = max(0.002, min(0.03, 12 / np.sqrt(liq))) * stress_mult
        ask = min(0.999, mid + spread / 2)

        # depth proxy: only a fraction of reported liquidity is immediately hittable
        depth_total = liq * 0.14
        participation = requested_stake / liq
        queue_penalty = min(0.9, 0.20 + 0.9 * participation)
        latency_penalty = min(0.8, latency_seconds / 120)

        fill_prob = max(
            0.02,
            min(
                1.0,
                (depth_total / max(requested_stake, 1e-9))
                * (1 - 0.65 * queue_penalty)
                * (1 - 0.50 * latency_penalty),
            ),
        )
        if self.rng.random() > fill_prob:
            return 0.0, ask, 0.0, 0.0

        fill_ratio = min(1.0, depth_total / max(requested_stake, 1e-9))
        fill_ratio = max(0.05, fill_ratio * (1 - 0.35 * queue_penalty))
        filled_stake = requested_stake * fill_ratio

        impact = stress_mult * 0.20 * (max(filled_stake, 1.0) / liq) ** 1.35
        execution_price = min(0.999, ask * (1 + impact))
        slippage_paid = max(0.0, filled_stake * (execution_price - mid))
        return filled_stake, execution_price, min(1.0, fill_ratio), slippage_paid

    def run(
        self,
        signals: list[Signal],
        train_ratio: float = 0.6,
        outcome_override: Optional[dict[str, float]] = None,
        latency_signal_to_order_sec: float = 1.0,
        latency_order_to_fill_sec: float = 1.0,
        execution_stress_mult: float = 1.0,
    ) -> BacktestResult:
        _empty = BacktestResult(
            0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0
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

        resolvable.sort(key=lambda x: x[2])
        split_idx = int(len(resolvable) * train_ratio)
        test_set = resolvable[split_idx:]

        trades: list[TradeResult] = []
        current_bankroll = self.bankroll
        event_exposure: dict[str, float] = {}
        n_unfilled = 0
        execution_latency_sec = latency_signal_to_order_sec + latency_order_to_fill_sec

        for sig, raw_outcome, res_date in test_set:
            side_outcome = raw_outcome if sig.side == "BUY_YES" else (1 - raw_outcome)
            kelly_stake = sig.kelly_f * KELLY_FRACTION * current_bankroll
            requested_stake = min(kelly_stake, current_bankroll * MAX_POSITION_PCT)
            if requested_stake < 1.0:
                continue

            event_id = sig.event_group_id or sig.market_id
            event_used = event_exposure.get(event_id, 0.0)
            if event_used + requested_stake > self.bankroll * MAX_EVENT_EXPOSURE_PCT:
                continue

            filled, exec_px, fill_ratio, slippage_paid = self._simulate_execution(
                sig=sig,
                requested_stake=requested_stake,
                latency_seconds=execution_latency_sec,
                stress_mult=execution_stress_mult,
            )
            if filled < 1.0:
                n_unfilled += 1
                continue

            effective_stake = filled + _slippage(filled, sig.liquidity) * execution_stress_mult
            gross_payout = (1 / exec_px - 1) * (1 - TAKER_FEE)
            pnl = (effective_stake * gross_payout * side_outcome) - (effective_stake * (1 - side_outcome))

            current_bankroll = max(current_bankroll + pnl, 1.0)
            event_exposure[event_id] = event_used + filled

            signal_dt = _parse_iso(sig.price_date)
            execution_date = (
                _to_iso(signal_dt + timedelta(seconds=execution_latency_sec))
                if signal_dt is not None else sig.price_date
            )
            expected_win_prob = sig.market_price if sig.side == "BUY_YES" else (1 - sig.market_price)

            trades.append(TradeResult(
                market_id=sig.market_id,
                question=sig.question,
                side=sig.side,
                signal_date=sig.price_date,
                execution_date=execution_date,
                resolution_date=res_date,
                market_price=sig.market_price,
                execution_price=exec_px,
                p_true=sig.p_true,
                outcome=side_outcome,
                expected_win_prob=expected_win_prob,
                requested_stake=requested_stake,
                filled_stake=effective_stake,
                fill_ratio=fill_ratio,
                slippage_paid=slippage_paid,
                pnl=pnl,
                ev_forecast=sig.ev,
                strategy=sig.strategy,
                source=sig.source,
                event_group_id=event_id,
            ))

        if not trades:
            return _empty

        outcomes = [t.outcome for t in trades]
        strat_pred = [t.p_true for t in trades]
        base_pred = [t.expected_win_prob for t in trades]

        bs_strat = _brier_score(strat_pred, outcomes)
        bs_baseline = _brier_score(base_pred, outcomes)
        skill_score = 1 - (bs_strat / bs_baseline) if bs_baseline > 0 else 0.0

        observed_wr = float(np.mean([1 if t.outcome == 1.0 else 0 for t in trades]))
        expected_wr = float(np.mean([t.expected_win_prob for t in trades]))
        wr_excess = observed_wr - expected_wr

        pnl_arr = np.array([t.pnl for t in trades])
        mean_ev = float(np.mean([t.ev_forecast for t in trades]))
        total_pnl = float(np.sum(pnl_arr))
        total_return = total_pnl / self.bankroll
        max_drawdown = _compute_drawdown(list(pnl_arr))

        pnl_std = float(np.std(pnl_arr))
        pnl_skew = _skewness(pnl_arr)
        pnl_p05 = float(np.percentile(pnl_arr, 5))
        sharpe_proxy = (float(np.mean(pnl_arr)) / pnl_std * np.sqrt(len(trades))) if pnl_std > 0 else 0.0
        mean_abs_error = float(np.mean(np.abs(np.array(strat_pred) - np.array(outcomes))))

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
            n_unfilled=n_unfilled,
            trades=trades,
            by_strategy=by_strategy,
            by_source=by_source,
        )
