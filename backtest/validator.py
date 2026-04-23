"""
Auto-validation — converts BacktestResult + robustness report into a binary verdict.

Criteria for EDGE NÃO COMPROVADO (ANY failure → invalid):
  C1. N trades ≥ 300
  C2. Skill Score > 0.05
  C3. EV > 0
  C4. Drawdown < 30% of bankroll
  C5. WR excess > 0.02   [observed_wr - expected_wr > 2pp — market-relative, not absolute]
  C6. Match concordance ≥ 70%   [empirical outcome agreement between platforms]
  C7. Shuffle test significant   [z-score > 2 — not a noise artifact]
  C8. Threshold stable           [skill doesn't collapse at stricter thresholds]

C1-C5 are primary metrics.
C6-C8 are integrity checks — a positive C1-C5 is meaningless if C6-C8 fail.

Calibration warning (not a hard criterion, but logged):
  mean_abs_error < 0.05 on N > 100 trades is suspicious — very accurate probability
  estimates can indicate lookahead bias.
"""

import logging
from typing import Any, Optional

from backtest import BacktestResult

log = logging.getLogger(__name__)

MIN_TRADES       = 300
MIN_SKILL_SCORE  = 0.05
MIN_EV           = 0.0
MAX_DRAWDOWN_PCT  = 0.30
MIN_WR_EXCESS    = 0.02   # observed_wr must exceed expected_wr by at least 2pp
MIN_CONCORDANCE  = 0.70
SUSPICIOUS_MAE_THRESHOLD = 0.05   # very low MAE → possible lookahead


def validate(
    result: BacktestResult,
    robustness: Optional[dict] = None,
    match_quality: Optional[dict] = None,
    bankroll: float = 1000.0,
) -> dict[str, Any]:

    max_dd_pct = result.max_drawdown / bankroll if bankroll > 0 else 1.0

    # ── PRIMARY CHECKS ────────────────────────────────────────────────────
    checks: list[dict[str, Any]] = [
        {
            "name": "N trades ≥ 300",
            "pass": result.n_trades >= MIN_TRADES,
            "value": result.n_trades,
            "threshold": MIN_TRADES,
            "group": "primary",
        },
        {
            "name": "Skill Score > 0.05",
            "pass": result.skill_score > MIN_SKILL_SCORE,
            "value": round(result.skill_score, 4),
            "threshold": MIN_SKILL_SCORE,
            "group": "primary",
        },
        {
            "name": "Mean EV > 0",
            "pass": result.mean_ev > MIN_EV,
            "value": round(result.mean_ev, 4),
            "threshold": MIN_EV,
            "group": "primary",
        },
        {
            "name": "Max Drawdown < 30%",
            "pass": max_dd_pct < MAX_DRAWDOWN_PCT,
            "value": round(max_dd_pct, 4),
            "threshold": MAX_DRAWDOWN_PCT,
            "group": "primary",
        },
        {
            "name": "WR excess > 2pp",
            "pass": result.wr_excess > MIN_WR_EXCESS,
            "value": round(result.wr_excess, 4),
            "threshold": MIN_WR_EXCESS,
            "group": "primary",
        },
    ]

    # ── INTEGRITY CHECKS ──────────────────────────────────────────────────
    concordance_val = match_quality.get("concordance") if match_quality else None
    concordance_pass = (
        concordance_val is not None and concordance_val >= MIN_CONCORDANCE
    )
    checks.append({
        "name": "Match concordance ≥ 70%",
        "pass": concordance_pass,
        "value": concordance_val,
        "threshold": MIN_CONCORDANCE,
        "group": "integrity",
    })

    shuffle_significant = (
        robustness.get("shuffle_test", {}).get("significant", False)
        if robustness else False
    )
    checks.append({
        "name": "Shuffle test significant (z>2)",
        "pass": shuffle_significant,
        "value": robustness.get("shuffle_test", {}).get("z_score") if robustness else None,
        "threshold": 2.0,
        "group": "integrity",
    })

    threshold_stable = (
        robustness.get("threshold_sensitivity", {}).get("stable", False)
        if robustness else False
    )
    checks.append({
        "name": "Threshold stability",
        "pass": threshold_stable,
        "value": "stable" if threshold_stable else "unstable",
        "threshold": "stable",
        "group": "integrity",
    })

    all_pass = all(c["pass"] for c in checks)

    # ── CALIBRATION WARNING ───────────────────────────────────────────────
    warnings = []
    if result.n_trades > 100 and result.mean_abs_error < SUSPICIOUS_MAE_THRESHOLD:
        warnings.append(
            f"SUSPICIOUS: mean_abs_error={result.mean_abs_error:.4f} < {SUSPICIOUS_MAE_THRESHOLD} "
            f"on {result.n_trades} trades. Extremely accurate probability estimates "
            "may indicate residual lookahead bias."
        )
    if result.pnl_skew < -1.0:
        warnings.append(
            f"Negative return skew ({result.pnl_skew:.2f}): "
            "tail losses larger than tail gains — risk of ruin under live trading."
        )

    return {
        "verdict": "EDGE VALIDADO" if all_pass else "EDGE NÃO COMPROVADO",
        "all_pass": all_pass,
        "checks": checks,
        "warnings": warnings,
        "metrics": {
            "n_trades": result.n_trades,
            "brier_strategy": round(result.brier_score_strategy, 6),
            "brier_baseline": round(result.brier_score_baseline, 6),
            "skill_score": round(result.skill_score, 4),
            "observed_wr": round(result.observed_wr, 4),
            "expected_wr": round(result.expected_wr, 4),
            "wr_excess": round(result.wr_excess, 4),
            "mean_ev": round(result.mean_ev, 4),
            "total_pnl": round(result.total_pnl, 2),
            "total_return_pct": round(result.total_return * 100, 2),
            "max_drawdown_pct": round(max_dd_pct * 100, 2),
            "sharpe_proxy": round(result.sharpe_proxy, 3),
            "pnl_std": round(result.pnl_std, 2),
            "pnl_skew": round(result.pnl_skew, 3),
            "pnl_p05": round(result.pnl_p05, 2),
            "mean_abs_error": round(result.mean_abs_error, 4),
        },
        "by_strategy": {
            k: {
                "n": v["n"],
                "win_rate": round(v["wins"] / v["n"], 4) if v["n"] > 0 else 0,
                "expected_wr": round(v["expected_wr"] / v["n"], 4) if v["n"] > 0 else 0,
                "total_pnl": round(v["pnl"], 2),
            }
            for k, v in result.by_strategy.items()
        },
        "by_source": {
            k: {
                "n": v["n"],
                "win_rate": round(v["wins"] / v["n"], 4) if v["n"] > 0 else 0,
                "expected_wr": round(v["expected_wr"] / v["n"], 4) if v["n"] > 0 else 0,
                "total_pnl": round(v["pnl"], 2),
            }
            for k, v in result.by_source.items()
        },
    }


def print_report(verdict_data: dict[str, Any]) -> None:
    width = 60
    sep = "─" * width
    verdict = verdict_data["verdict"]
    all_pass = verdict_data["all_pass"]
    m = verdict_data["metrics"]

    print()
    print("=" * width)
    print(f"  {'✅' if all_pass else '❌'}  {verdict}")
    print("=" * width)

    print()
    print("  PRIMARY CRITERIA")
    print(f"  {sep}")
    for c in [c for c in verdict_data["checks"] if c["group"] == "primary"]:
        icon = "✓" if c["pass"] else "✗"
        print(f"  {icon}  {c['name']:<30}  {c['value']}  (need {c['threshold']})")

    print()
    print("  INTEGRITY CHECKS")
    print(f"  {sep}")
    for c in [c for c in verdict_data["checks"] if c["group"] == "integrity"]:
        icon = "✓" if c["pass"] else "✗"
        print(f"  {icon}  {c['name']:<30}  {c['value']}")

    print()
    print("  METRICS (test window)")
    print(f"  {sep}")
    print(f"  Trades (N)         : {m['n_trades']}")
    print(f"  Brier (bot/mkt)    : {m['brier_strategy']} / {m['brier_baseline']}")
    print(f"  Skill Score        : {m['skill_score']:+.4f}")
    print(f"  WR observed/expect : {m['observed_wr']:.1%} / {m['expected_wr']:.1%}  "
          f"(excess: {m['wr_excess']:+.1%})")
    print(f"  Mean EV/trade      : {m['mean_ev']:+.4f}")
    print(f"  Total PnL          : ${m['total_pnl']:,.2f}  ({m['total_return_pct']:+.1f}%)")
    print(f"  Max Drawdown       : {m['max_drawdown_pct']:.1f}%")
    print(f"  Sharpe proxy       : {m['sharpe_proxy']:+.3f}")
    print(f"  PnL std / skew     : {m['pnl_std']:.2f} / {m['pnl_skew']:.3f}")
    print(f"  PnL 5th percentile : ${m['pnl_p05']:.2f}")
    print(f"  Mean |p_true-out|  : {m['mean_abs_error']:.4f}")

    if verdict_data.get("by_strategy"):
        print()
        print("  BY STRATEGY")
        print(f"  {sep}")
        for name, d in verdict_data["by_strategy"].items():
            wr_ex = d["win_rate"] - d["expected_wr"]
            print(f"  {name:<20}  N={d['n']:>4}  "
                  f"WR={d['win_rate']:.1%}(exp {d['expected_wr']:.1%}, +{wr_ex:.1%})  "
                  f"PnL=${d['total_pnl']:>8.2f}")

    if verdict_data.get("warnings"):
        print()
        print("  ⚠  WARNINGS")
        print(f"  {sep}")
        for w in verdict_data["warnings"]:
            print(f"  {w}")

    print()
    if all_pass:
        print("  RECOMMENDATION: Criteria met. Proceed to paper trading")
        print("  with 0.10× Kelly. Monitor live calibration weekly.")
    else:
        failed = [c["name"] for c in verdict_data["checks"] if not c["pass"]]
        print("  RECOMMENDATION: EDGE NÃO COMPROVADO.")
        print(f"  Failed: {', '.join(failed)}")
        print("  Do not trade. Collect more data and re-validate.")
    print("=" * width)
    print()
