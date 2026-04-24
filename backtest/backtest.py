"""
Backtesting engine with execution realism:
  - order-book proxy (dynamic spread + depth)
  - partial fills and queue penalty
  - latency between signal and execution
  - non-linear price impact / slippage
  - event-level exposure caps (correlation control)

Slippage model:
    Spread estimated from liquidity: max(0.2%, min(3%, 12/sqrt(liq)))
    Depth proxy: 14% of reported liquidity is immediately hittable
    Fill probability reduced by queue penalty (participation rate) and latency
    Non-linear impact: (stake/liquidity)^0.6 × stress_mult

WR criterion:
    real_wr > expected_wr + 0.03
    where expected_wr = mean(market_price) for that side

outcome_override: dict[market_id → float] — used by shuffle test without DB modification.
"""

import logging
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional

import numpy as np

from strategy import Signal

log = logging.getLogger(__name__)

TAKER_FEE            = 0.02
KELLY_FRACTION       = 0.25
MAX_POSITION_PCT     = 0.05
MAX_EVENT_EXPOSURE_PCT = 0.10   # max fraction of bankroll per event group


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
    skill_score_ci: tuple[float, float]   # (2.5th, 97.5th) bootstrap percentiles
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
    n_embargo_excluded: int               # signals dropped by the embargo filter
    trades: list[TradeResult] = field(default_factory=list)
    by_strategy: dict = field(default_factory=dict)
    by_source: dict = field(default_factory=dict)


# ──────────────────────────────────────────────
# HELPERS
# ──────────────────────────────────────────────

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
    mu, std = np.mean(x), np.std(x)
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


# ──────────────────────────────────────────────
# BACKTESTER
# ──────────────────────────────────────────────

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
        """
        Simulate taker order execution against a synthetic order book.

        Returns: (filled_stake, execution_price, slippage_paid, fill_ratio)
        Returns (0, ask, 0, 0) if the order goes unfilled.

        Model assumptions:
          - Spread: 12/sqrt(liq) bps, clamped to [0.2%, 3%]
          - Hittable depth: 14% of reported liquidity
          - Fill probability decays with participation rate and latency
          - Non-linear price impact: (stake/liq)^0.6
        """
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

        # Non-linear impact: larger orders relative to liquidity → more slippage
        impact = (requested_stake / liq) ** 0.6 * stress_mult
        execution_price = min(0.999, ask + impact * 0.5)

        filled_stake = requested_stake * fill_ratio
        slippage_paid = filled_stake * (execution_price - mid)

        return filled_stake, execution_price, slippage_paid, fill_ratio

    def run(
        self,
        signals: list[Signal],
        train_ratio: float = 0.6,
        outcome_override: Optional[dict[str, float]] = None,
        execution_stress_mult: float = 1.0,
        latency_signal_to_order_sec: int = 5,
        latency_order_to_fill_sec: int = 10,
        embargo_days: int = 14,
    ) -> BacktestResult:
        _empty = BacktestResult(
            0, 1.0, 1.0, 0.0, (0.0, 0.0), 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0, 0
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

        # Embargo: drop test signals whose signal_date falls within embargo_days
        # of the latest signal_date in the training set. Prevents near-boundary
        # signals from carrying train-period information into the test evaluation.
        n_embargo_excluded = 0
        if embargo_days > 0 and split_idx > 0:
            train_dates = [_parse_iso(item[0].price_date) for item in resolvable[:split_idx]]
            train_dates = [d for d in train_dates if d is not None]
            if train_dates:
                cutoff = max(train_dates) + timedelta(days=embargo_days)
                before = len(test_set)
                test_set = [
                    item for item in test_set
                    if (_parse_iso(item[0].price_date) or cutoff) > cutoff
                ]
                n_embargo_excluded = before - len(test_set)
                if n_embargo_excluded:
                    log.info(
                        "Embargo (%dd): excluded %d test signals too close to train boundary",
                        embargo_days, n_embargo_excluded,
                    )

        log.info(
            "Backtest: %d signals → %d resolvable → %d in test set (train_ratio=%.1f, embargo=%dd)",
            len(signals), len(resolvable), len(test_set), train_ratio, embargo_days,
        )

        trades: list[TradeResult] = []
        n_unfilled = 0
        current_bankroll = self.bankroll
        total_latency = latency_signal_to_order_sec + latency_order_to_fill_sec

        # Event-level exposure tracking: how much is already deployed per event group
        event_exposure: dict[str, float] = {}

        for sig, raw_outcome, res_date in test_set:
            # Event-level exposure cap
            group = sig.event_group_id or sig.market_id
            group_exposure = event_exposure.get(group, 0.0)
            max_group = current_bankroll * MAX_EVENT_EXPOSURE_PCT
            if group_exposure >= max_group:
                continue

            # Kelly position sizing
            kelly_stake = sig.kelly_f * KELLY_FRACTION * current_bankroll
            requested_stake = min(
                kelly_stake,
                current_bankroll * MAX_POSITION_PCT,
                max_group - group_exposure,   # respect event cap
            )
            if requested_stake < 1.0:
                continue

            # Execution simulation
            filled_stake, exec_price, slippage_paid, fill_ratio = self._simulate_execution(
                sig, requested_stake, total_latency, execution_stress_mult
            )

            if filled_stake < 0.5:
                n_unfilled += 1
                continue

            # Compute execution timestamp
            signal_dt = _parse_iso(sig.price_date)
            exec_dt = (
                signal_dt + timedelta(seconds=total_latency)
                if signal_dt else None
            )
            exec_date = _to_iso(exec_dt) if exec_dt else sig.price_date

            # Outcome from our side's perspective
            side_outcome = raw_outcome if sig.side == "BUY_YES" else (1 - raw_outcome)

            # PnL using actual execution price (not market price)
            gross_payout = (1 / exec_price - 1) * (1 - TAKER_FEE)
            pnl = (
                filled_stake * gross_payout * side_outcome
                - filled_stake * (1 - side_outcome)
            )

            current_bankroll = max(current_bankroll + pnl, 1.0)
            event_exposure[group] = group_exposure + filled_stake

            expected_win_prob = (
                sig.market_price if sig.side == "BUY_YES" else 1 - sig.market_price
            )

            trades.append(TradeResult(
                market_id=sig.market_id,
                question=sig.question,
                side=sig.side,
                signal_date=sig.price_date,
                execution_date=exec_date,
                resolution_date=res_date,
                market_price=sig.market_price,
                execution_price=exec_price,
                p_true=sig.p_true,
                outcome=side_outcome,
                expected_win_prob=expected_win_prob,
                requested_stake=requested_stake,
                filled_stake=filled_stake,
                fill_ratio=fill_ratio,
                slippage_paid=slippage_paid,
                pnl=pnl,
                ev_forecast=sig.ev,
                strategy=sig.strategy,
                source=sig.source,
                event_group_id=group,
            ))

        if not trades:
            return _empty

        # ── BRIER / SKILL ──────────────────────────────────────────────────
        outcomes    = [t.outcome for t in trades]
        strat_pred  = [t.p_true for t in trades]
        base_pred   = [t.expected_win_prob for t in trades]

        bs_strat    = _brier_score(strat_pred, outcomes)
        bs_baseline = _brier_score(base_pred, outcomes)
        skill_score = 1 - (bs_strat / bs_baseline) if bs_baseline > 0 else 0.0

        # ── WIN RATE ───────────────────────────────────────────────────────
        observed_wr = float(np.mean([1 if t.outcome == 1.0 else 0 for t in trades]))
        expected_wr = float(np.mean([t.expected_win_prob for t in trades]))
        wr_excess   = observed_wr - expected_wr

        # ── PnL METRICS ───────────────────────────────────────────────────
        pnl_arr      = np.array([t.pnl for t in trades])
        mean_ev      = float(np.mean([t.ev_forecast for t in trades]))
        total_pnl    = float(np.sum(pnl_arr))
        total_return = total_pnl / self.bankroll
        max_drawdown = _compute_drawdown(list(pnl_arr))
        pnl_std      = float(np.std(pnl_arr))
        pnl_skew     = _skewness(pnl_arr)
        pnl_p05      = float(np.percentile(pnl_arr, 5))
        sharpe_proxy = (
            float(np.mean(pnl_arr)) / pnl_std * np.sqrt(len(trades))
            if pnl_std > 0 else 0.0
        )

        mean_abs_error = float(
            np.mean(np.abs(np.array(strat_pred) - np.array(outcomes)))
        )

        # ── BOOTSTRAP CI ON SKILL SCORE ───────────────────────────────────
        # 1000 resamples with replacement; gives 95% CI for skill score.
        # CI lower bound < 0.02 is a hard failure in the validator.
        skill_score_ci: tuple[float, float] = (0.0, 0.0)
        if len(trades) >= 20:
            boot_skills: list[float] = []
            for _ in range(1000):
                idx = self.rng.integers(0, len(trades), size=len(trades))
                bt = [trades[i] for i in idx]
                bs_s = _brier_score([t.p_true for t in bt], [t.outcome for t in bt])
                bs_b = _brier_score([t.expected_win_prob for t in bt], [t.outcome for t in bt])
                boot_skills.append(1.0 - bs_s / bs_b if bs_b > 0 else 0.0)
            arr_boot = np.array(boot_skills)
            skill_score_ci = (
                float(np.percentile(arr_boot, 2.5)),
                float(np.percentile(arr_boot, 97.5)),
            )

        # ── BREAKDOWNS ────────────────────────────────────────────────────
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
            skill_score_ci=skill_score_ci,
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
            n_embargo_excluded=n_embargo_excluded,
            trades=trades,
            by_strategy=by_strategy,
            by_source=by_source,
        )
