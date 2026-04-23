"""
Auto-validation — converts BacktestResult into a binary verdict.

Criteria for EDGE VALIDADO (all must be satisfied):
  1. N ≥ 300 trades             [statistical significance]
  2. Skill Score > 0.05         [5% improvement over market baseline]
  3. Win Rate > 0.52            [edge above market noise, accounting for fees]
  4. Mean EV > 0                [positive expected value after fee/slippage]
  5. Max Drawdown < 30%         [risk-adjusted viability]

Any single failure → SEM EDGE.

The verdict is printed in a structured report and returned as a dict
for programmatic use. Nothing is written to the TypeScript bot — this
system is read-only analysis.
"""

import logging
from typing import Any

from backtest import BacktestResult

log = logging.getLogger(__name__)

# ── CRITERIA ──────────────────────────────────────────────────────────────
MIN_TRADES = 300
MIN_SKILL_SCORE = 0.05
MIN_WIN_RATE = 0.52
MIN_MEAN_EV = 0.0
MAX_DRAWDOWN_PCT = 0.30   # fraction of initial bankroll


def validate(result: BacktestResult, bankroll: float = 1000.0) -> dict[str, Any]:
    """
    Apply all validation criteria and return a structured verdict.
    """
    max_dd_pct = result.max_drawdown / bankroll if bankroll > 0 else 1.0

    checks: list[dict[str, Any]] = [
        {
            "name": "N trades ≥ 300",
            "pass": result.n_trades >= MIN_TRADES,
            "value": result.n_trades,
            "threshold": MIN_TRADES,
        },
        {
            "name": "Skill Score > 0.05",
            "pass": result.skill_score > MIN_SKILL_SCORE,
            "value": round(result.skill_score, 4),
            "threshold": MIN_SKILL_SCORE,
        },
        {
            "name": "Win Rate > 52%",
            "pass": result.win_rate > MIN_WIN_RATE,
            "value": round(result.win_rate, 4),
            "threshold": MIN_WIN_RATE,
        },
        {
            "name": "Mean EV > 0",
            "pass": result.mean_ev > MIN_MEAN_EV,
            "value": round(result.mean_ev, 4),
            "threshold": MIN_MEAN_EV,
        },
        {
            "name": "Max Drawdown < 30%",
            "pass": max_dd_pct < MAX_DRAWDOWN_PCT,
            "value": round(max_dd_pct, 4),
            "threshold": MAX_DRAWDOWN_PCT,
        },
    ]

    all_pass = all(c["pass"] for c in checks)
    verdict = "EDGE VALIDADO" if all_pass else "SEM EDGE"

    return {
        "verdict": verdict,
        "all_pass": all_pass,
        "checks": checks,
        "metrics": {
            "n_trades": result.n_trades,
            "brier_score_strategy": round(result.brier_score_strategy, 6),
            "brier_score_baseline": round(result.brier_score_baseline, 6),
            "skill_score": round(result.skill_score, 4),
            "win_rate": round(result.win_rate, 4),
            "mean_ev": round(result.mean_ev, 4),
            "total_pnl": round(result.total_pnl, 2),
            "total_return_pct": round(result.total_return * 100, 2),
            "max_drawdown": round(result.max_drawdown, 2),
            "max_drawdown_pct": round(max_dd_pct * 100, 2),
        },
        "by_strategy": {
            k: {
                "n": v["n"],
                "win_rate": round(v["wins"] / v["n"], 4) if v["n"] > 0 else 0,
                "total_pnl": round(v["pnl"], 2),
            }
            for k, v in result.by_strategy.items()
        },
        "by_source": {
            k: {
                "n": v["n"],
                "win_rate": round(v["wins"] / v["n"], 4) if v["n"] > 0 else 0,
                "total_pnl": round(v["pnl"], 2),
            }
            for k, v in result.by_source.items()
        },
    }


def print_report(verdict_data: dict[str, Any]) -> None:
    """Print a human-readable validation report to stdout."""
    verdict = verdict_data["verdict"]
    all_pass = verdict_data["all_pass"]
    m = verdict_data["metrics"]

    width = 60
    sep = "─" * width

    print()
    print("=" * width)
    if all_pass:
        print(f"  ✅  {verdict}")
    else:
        print(f"  ❌  {verdict}")
    print("=" * width)

    print()
    print("  CRITERIA")
    print(f"  {sep}")
    for c in verdict_data["checks"]:
        icon = "✓" if c["pass"] else "✗"
        print(f"  {icon}  {c['name']:<28}  {c['value']}  (threshold: {c['threshold']})")

    print()
    print("  METRICS (test window)")
    print(f"  {sep}")
    print(f"  Trades (N)         : {m['n_trades']}")
    print(f"  Brier Score (bot)  : {m['brier_score_strategy']}")
    print(f"  Brier Score (mkt)  : {m['brier_score_baseline']}")
    print(f"  Skill Score        : {m['skill_score']}")
    print(f"  Win Rate           : {m['win_rate']:.1%}")
    print(f"  Mean EV/trade      : {m['mean_ev']:.4f}")
    print(f"  Total PnL          : ${m['total_pnl']:,.2f}")
    print(f"  Total Return       : {m['total_return_pct']:.1f}%")
    print(f"  Max Drawdown       : ${m['max_drawdown']:,.2f} ({m['max_drawdown_pct']:.1f}%)")

    if verdict_data["by_strategy"]:
        print()
        print("  BY STRATEGY")
        print(f"  {sep}")
        for strat, d in verdict_data["by_strategy"].items():
            print(f"  {strat:<18}  N={d['n']:>4}  WR={d['win_rate']:.1%}  PnL=${d['total_pnl']:>8.2f}")

    if verdict_data["by_source"]:
        print()
        print("  BY SIGNAL SOURCE")
        print(f"  {sep}")
        for src, d in verdict_data["by_source"].items():
            print(f"  {src:<18}  N={d['n']:>4}  WR={d['win_rate']:.1%}  PnL=${d['total_pnl']:>8.2f}")

    print()
    if all_pass:
        print("  RECOMMENDATION: Strategies have demonstrated empirical edge.")
        print("  Proceed to paper trading with 0.1× Kelly for live validation.")
    else:
        failed = [c["name"] for c in verdict_data["checks"] if not c["pass"]]
        print(f"  RECOMMENDATION: No actionable edge detected.")
        print(f"  Failed criteria: {', '.join(failed)}")
        print("  Collect more data or revise strategy assumptions before trading.")
    print("=" * width)
    print()
