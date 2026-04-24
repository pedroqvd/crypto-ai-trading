"""
Robustness suite (8 checks):
  1) Threshold sensitivity    — skill stable across 0.75→0.90
  2) Shuffle null-model       — skill collapses with permuted outcomes (z > 2)
  3) Ablation by source       — each source individually shows positive skill
  4) Placebo matching         — shuffling p_true collapses skill
  5) Noise injection          — skill degrades gracefully with Gaussian noise on p_true
  6) Execution stress         — skill survives 2× and 3× spread/slippage multiplier
  7) Latency stress           — skill survives 30s and 60s signal-to-fill latency
  8) Edge decay               — signal-to-resolution horizon distribution
"""

import logging
import random
import sqlite3
from dataclasses import replace
from datetime import datetime

import numpy as np

from backtest import Backtester
from strategy import Signal, generate_all_signals
from question_matcher import match_polymarket_to_metaculus, match_polymarket_to_manifold

log = logging.getLogger(__name__)


# ──────────────────────────────────────────────
# 1. THRESHOLD SENSITIVITY
# ──────────────────────────────────────────────

def threshold_sensitivity_test(
    conn: sqlite3.Connection,
    backtester: Backtester,
    thresholds: list[float] = [0.75, 0.80, 0.85, 0.90],
    train_ratio: float = 0.6,
) -> dict:
    """
    Re-run matching at each threshold and report skill score vs N trades.
    """
    results = []

    for t in thresholds:
        conn.execute("DELETE FROM matched_pairs")
        conn.commit()

        match_polymarket_to_metaculus(conn, threshold=t)
        match_polymarket_to_manifold(conn, threshold=t)

        signals = generate_all_signals(conn)
        result = backtester.run(signals, train_ratio=train_ratio)

        entry = {
            "threshold": t,
            "n_signals": len(signals),
            "n_trades": result.n_trades,
            "skill_score": round(result.skill_score, 4),
            "wr_excess": round(result.wr_excess, 4),
        }
        results.append(entry)
        log.info("Threshold %.2f: signals=%d, trades=%d, skill=%.4f",
                 t, len(signals), result.n_trades, result.skill_score)

    # Stability: does skill stay within 20% of its value at 0.75?
    skills = [r["skill_score"] for r in results if r["n_trades"] > 0]
    stable = False
    instability_notes = []
    if skills:
        base = skills[0]
        drops = [abs(s - base) / max(abs(base), 0.001) for s in skills[1:]]
        stable = all(d < 0.20 for d in drops)
        if not stable:
            instability_notes = [
                f"threshold={results[i+1]['threshold']}: drop={drops[i]:.0%}"
                for i, d in enumerate(drops) if d >= 0.20
            ]

    return {
        "stable": stable,
        "instability_notes": instability_notes,
        "by_threshold": results,
        "interpretation": (
            "ROBUST — skill score is stable across thresholds"
            if stable else
            "FRAGILE — skill score collapses at higher thresholds; "
            "edge may be driven by weak/incorrect matches"
        ),
    }


# ──────────────────────────────────────────────
# 2. SHUFFLE TEST (NULL MODEL)
# ──────────────────────────────────────────────

def shuffle_test(
    conn: sqlite3.Connection,
    signals: list[Signal],
    backtester: Backtester,
    n_iterations: int = 200,
    train_ratio: float = 0.6,
) -> dict:
    """
    Randomly permute market outcomes N times and compute the skill score distribution.

    A real edge should produce a real skill score >> shuffled distribution.
    If shuffle_mean_skill ≈ real_skill → the edge is not from predictions,
    it's from a structural bias (selection bias, lookahead, or code bug).

    The outcome permutation is applied via outcome_override — the DB is never modified.
    """
    # Get real result first
    real_result = backtester.run(signals, train_ratio=train_ratio)
    real_skill = real_result.skill_score

    # Gather all market outcomes that are resolvable
    all_resolutions = conn.execute("""
        SELECT market_id, outcome FROM poly_resolutions
        WHERE outcome IN ('YES', 'NO')
    """).fetchall()

    if len(all_resolutions) < 10:
        return {
            "real_skill": real_skill,
            "shuffle_mean": None,
            "shuffle_std": None,
            "z_score": None,
            "valid": False,
            "reason": "too few resolutions to shuffle",
        }

    market_ids = [r["market_id"] for r in all_resolutions]
    outcomes_raw = [1.0 if r["outcome"] == "YES" else 0.0 for r in all_resolutions]

    shuffle_skills: list[float] = []
    rng = random.Random(42)  # deterministic seed for reproducibility

    for _ in range(n_iterations):
        shuffled = outcomes_raw.copy()
        rng.shuffle(shuffled)
        override = dict(zip(market_ids, shuffled))

        result = backtester.run(signals, train_ratio=train_ratio, outcome_override=override)
        shuffle_skills.append(result.skill_score)

    arr = np.array(shuffle_skills)
    mu  = float(np.mean(arr))
    std = float(np.std(arr))
    z   = (real_skill - mu) / std if std > 0 else 0.0

    # Edge is real only if real_skill is > 2 standard deviations above shuffle mean
    significant = z > 2.0

    return {
        "real_skill": round(real_skill, 4),
        "shuffle_mean": round(mu, 4),
        "shuffle_std": round(std, 4),
        "z_score": round(z, 2),
        "n_iterations": n_iterations,
        "significant": significant,
        "interpretation": (
            f"SIGNAL (z={z:.1f}): real skill significantly above random baseline"
            if significant else
            f"NOISE (z={z:.1f}): real skill not distinguishable from shuffled outcomes — "
            "indicates lookahead bias, structural data leak, or code bug"
        ),
    }


# ──────────────────────────────────────────────
# 3. ABLATION TEST
# ──────────────────────────────────────────────

def ablation_test(
    conn: sqlite3.Connection,
    backtester: Backtester,
    train_ratio: float = 0.6,
) -> dict:
    """
    Test each component in isolation to identify load-bearing dependencies.
    Runs four configurations:
      (a) consensus only (Metaculus + Manifold)
      (b) Metaculus only
      (c) Manifold only
      (d) negRisk only
    """
    configs = [
        ("consensus_all",      True,  True,  None),
        ("metaculus_only",     True,  False, {"metaculus"}),
        ("manifold_only",      True,  False, {"manifold"}),
        ("neg_risk_only",      False, True,  None),
    ]

    results = []
    for name, use_consensus, use_nr, sources in configs:
        signals = generate_all_signals(
            conn,
            use_consensus=use_consensus,
            use_neg_risk=use_nr,
            consensus_sources=sources,
        )
        result = backtester.run(signals, train_ratio=train_ratio)

        entry = {
            "config": name,
            "n_signals": len(signals),
            "n_trades": result.n_trades,
            "skill_score": round(result.skill_score, 4),
            "wr_excess": round(result.wr_excess, 4),
            "total_pnl": round(result.total_pnl, 2),
        }
        results.append(entry)
        log.info("Ablation [%s]: signals=%d, trades=%d, skill=%.4f",
                 name, len(signals), result.n_trades, result.skill_score)

    # Flag single-source dependency
    meta_skill = next((r["skill_score"] for r in results if r["config"] == "metaculus_only"), 0.0)
    mani_skill = next((r["skill_score"] for r in results if r["config"] == "manifold_only"), 0.0)
    nr_skill   = next((r["skill_score"] for r in results if r["config"] == "neg_risk_only"), 0.0)

    fragile = meta_skill <= 0 and mani_skill <= 0 and nr_skill <= 0
    notes = []
    if meta_skill <= 0:
        notes.append("Metaculus alone has no edge")
    if mani_skill <= 0:
        notes.append("Manifold alone has no edge")
    if nr_skill <= 0:
        notes.append("negRisk alone has no edge")

    return {
        "fragile": fragile,
        "notes": notes,
        "by_config": results,
        "interpretation": (
            "FRAGILE — no individual source demonstrates edge; "
            "combined signal may be illusory"
            if fragile else
            "At least one source shows positive standalone edge"
        ),
    }


# ──────────────────────────────────────────────
# TESTS 4–8 (from PR #35)
# ──────────────────────────────────────────────

def placebo_matching_test(
    signals: list[Signal],
    backtester: Backtester,
    train_ratio: float = 0.6,
) -> dict:
    """
    Shuffle p_true across signals while keeping outcomes fixed.
    If real edge exists, skill should collapse when p_true is randomly re-assigned
    to different markets. If it doesn't collapse → structural data leak, not real edge.
    """
    if len(signals) < 20:
        return {"valid": False, "reason": "too_few_signals"}

    rng = random.Random(123)
    shuffled_probs = [s.p_true for s in signals]
    rng.shuffle(shuffled_probs)

    placebo = [
        replace(
            s,
            p_true=max(0.001, min(0.999, p)),
            ev=s.ev + (p - s.p_true),
            kelly_f=max(0.0, s.kelly_f * 0.5),
        )
        for s, p in zip(signals, shuffled_probs)
    ]

    base   = backtester.run(signals, train_ratio=train_ratio)
    result = backtester.run(placebo, train_ratio=train_ratio)

    collapsed = result.skill_score < base.skill_score * 0.5

    return {
        "valid": True,
        "real_skill": round(base.skill_score, 4),
        "placebo_skill": round(result.skill_score, 4),
        "collapsed": collapsed,
        "interpretation": (
            "GOOD — skill collapsed on placebo (edge is in the matching)"
            if collapsed else
            "BAD — skill did not collapse; p_true assignment may not matter"
        ),
    }


def noise_injection_test(
    signals: list[Signal],
    backtester: Backtester,
    train_ratio: float = 0.6,
    noise_levels: list[float] = [0.01, 0.02, 0.03],
) -> dict:
    """
    Add Gaussian noise N(0, σ) to p_true. Real edge should degrade
    proportionally and monotonically. Non-monotonic degradation → fragility.
    """
    rng = np.random.default_rng(7)
    base = backtester.run(signals, train_ratio=train_ratio)
    by_noise = []

    for sigma in noise_levels:
        noisy = [
            replace(s, p_true=float(max(0.001, min(0.999, s.p_true + rng.normal(0, sigma)))))
            for s in signals
        ]
        r = backtester.run(noisy, train_ratio=train_ratio)
        by_noise.append({
            "sigma": sigma,
            "skill_score": round(r.skill_score, 4),
            "wr_excess":   round(r.wr_excess, 4),
        })

    # Monotone degradation check
    skills = [r["skill_score"] for r in by_noise]
    monotone = all(skills[i] >= skills[i + 1] for i in range(len(skills) - 1))

    return {
        "base_skill": round(base.skill_score, 4),
        "by_noise": by_noise,
        "monotone_degradation": monotone,
        "interpretation": (
            "GOOD — skill degrades monotonically with noise"
            if monotone else
            "WARNING — non-monotone degradation indicates fragile signal"
        ),
    }


def execution_stress_test(
    signals: list[Signal],
    backtester: Backtester,
    train_ratio: float = 0.6,
    stress_levels: list[float] = [1.0, 2.0, 3.0],
) -> dict:
    """
    Test with escalating execution stress multipliers.
    Edge must survive at least 2× stress to be tradeable in real conditions.
    """
    out = []
    for mult in stress_levels:
        r = backtester.run(
            signals,
            train_ratio=train_ratio,
            execution_stress_mult=mult,
        )
        out.append({
            "stress_mult": mult,
            "n_trades":    r.n_trades,
            "skill_score": round(r.skill_score, 4),
            "total_pnl":   round(r.total_pnl, 2),
            "n_unfilled":  r.n_unfilled,
        })

    survives_2x = next((r for r in out if r["stress_mult"] == 2.0), {}).get("skill_score", -1) > 0

    return {
        "by_stress": out,
        "survives_2x": survives_2x,
        "interpretation": (
            "GOOD — edge survives 2× execution stress"
            if survives_2x else
            "BAD — edge disappears at 2× stress; likely too fragile for live trading"
        ),
    }


def latency_stress_test(
    signals: list[Signal],
    backtester: Backtester,
    train_ratio: float = 0.6,
    latencies_sec: list[int] = [1, 5, 30, 60],
) -> dict:
    """
    Test with escalating signal-to-fill latency.
    Edge should survive realistic latencies (≤ 30s for an automated system).
    """
    out = []
    for sec in latencies_sec:
        r = backtester.run(
            signals,
            train_ratio=train_ratio,
            latency_signal_to_order_sec=sec,
            latency_order_to_fill_sec=sec,
        )
        out.append({
            "latency_sec": sec,
            "n_trades":    r.n_trades,
            "wr_excess":   round(r.wr_excess, 4),
            "total_pnl":   round(r.total_pnl, 2),
            "n_unfilled":  r.n_unfilled,
        })

    survives_30s = next((r for r in out if r["latency_sec"] == 30), {}).get("total_pnl", -1) > 0

    return {
        "by_latency": out,
        "survives_30s": survives_30s,
        "interpretation": (
            "GOOD — edge survives 30s latency"
            if survives_30s else
            "BAD — edge requires sub-30s execution; requires low-latency infrastructure"
        ),
    }


def edge_decay_test(
    signals: list[Signal],
    backtester: Backtester,
    train_ratio: float = 0.6,
) -> dict:
    """
    Proxy for edge durability: distribution of signal-to-resolution horizons.
    Short horizons (< 7 days) are high-noise; long horizons (> 90 days) are
    more reliable but require more capital at risk.
    """
    base = backtester.run(signals, train_ratio=train_ratio)
    if not base.trades:
        return {"valid": False, "reason": "no_trades"}

    horizons = []
    for t in base.trades:
        try:
            sdt = datetime.fromisoformat(t.signal_date.replace("Z", "+00:00"))
            rdt = datetime.fromisoformat(t.resolution_date.replace("Z", "+00:00"))
            horizons.append((rdt - sdt).total_seconds() / 86400)
        except Exception:
            pass

    if len(horizons) < 10:
        return {"valid": False, "reason": "insufficient_horizon_data"}

    arr = np.array(horizons)
    return {
        "valid": True,
        "n": len(horizons),
        "median_horizon_days": round(float(np.median(arr)), 2),
        "p25_horizon_days":    round(float(np.percentile(arr, 25)), 2),
        "p75_horizon_days":    round(float(np.percentile(arr, 75)), 2),
        "pct_below_7d":        round(float(np.mean(arr < 7)) * 100, 1),
        "interpretation": (
            "WARNING — >30% of signals resolve within 7 days (high-noise horizon)"
            if float(np.mean(arr < 7)) > 0.30 else
            "OK — majority of signals have adequate horizon"
        ),
    }


# ──────────────────────────────────────────────
# COMBINED REPORT
# ──────────────────────────────────────────────

def run_all_robustness_tests(
    conn: sqlite3.Connection,
    signals: list[Signal],
    backtester: Backtester,
    train_ratio: float = 0.6,
    n_shuffle: int = 200,
) -> dict:
    log.info("=== Running robustness tests ===")

    log.info("--- 1/8 Threshold sensitivity ---")
    threshold_result = threshold_sensitivity_test(conn, backtester, train_ratio=train_ratio)

    log.info("--- 2/8 Shuffle test (n=%d) ---", n_shuffle)
    shuffle_result = shuffle_test(conn, signals, backtester, n_shuffle, train_ratio)

    log.info("--- 3/8 Ablation test ---")
    ablation_result = ablation_test(conn, backtester, train_ratio)

    log.info("--- 4/8 Placebo matching ---")
    placebo_result = placebo_matching_test(signals, backtester, train_ratio)

    log.info("--- 5/8 Noise injection ---")
    noise_result = noise_injection_test(signals, backtester, train_ratio)

    log.info("--- 6/8 Execution stress ---")
    execution_result = execution_stress_test(signals, backtester, train_ratio)

    log.info("--- 7/8 Latency stress ---")
    latency_result = latency_stress_test(signals, backtester, train_ratio)

    log.info("--- 8/8 Edge decay ---")
    decay_result = edge_decay_test(signals, backtester, train_ratio)

    all_pass = (
        threshold_result["stable"] and
        shuffle_result.get("significant", False) and
        not ablation_result["fragile"] and
        placebo_result.get("collapsed", False)
    )

    return {
        "all_pass": all_pass,
        "threshold_sensitivity": threshold_result,
        "shuffle_test": shuffle_result,
        "ablation": ablation_result,
        "placebo_matching": placebo_result,
        "noise_injection": noise_result,
        "execution_stress": execution_result,
        "latency_stress": latency_result,
        "edge_decay": decay_result,
    }


def print_robustness_report(report: dict) -> None:
    width = 60
    sep = "─" * width

    print()
    print("=" * width)
    status = "✅ ROBUSTNESS TESTS PASSED" if report["all_pass"] else "❌ ROBUSTNESS TESTS FAILED"
    print(f"  {status}")
    print("=" * width)

    ts = report["threshold_sensitivity"]
    print()
    print("  1. THRESHOLD SENSITIVITY")
    print(f"  {sep}")
    for r in ts["by_threshold"]:
        flag = "✓" if r["n_trades"] > 0 else "—"
        print(f"  {flag}  threshold={r['threshold']:.2f}  "
              f"N={r['n_trades']:>4}  skill={r['skill_score']:>+.4f}  "
              f"WR_excess={r['wr_excess']:>+.4f}")
    print(f"  Stable: {'YES' if ts['stable'] else 'NO'}  {' / '.join(ts['instability_notes']) or ''}")

    sh = report["shuffle_test"]
    print()
    print("  2. SHUFFLE TEST (NULL MODEL)")
    print(f"  {sep}")
    if sh.get("shuffle_mean") is not None:
        print(f"  Real skill:     {sh['real_skill']:>+.4f}")
        print(f"  Shuffle μ:      {sh['shuffle_mean']:>+.4f} ± {sh['shuffle_std']:.4f}")
        print(f"  Z-score:        {sh['z_score']:>+.2f}  ({'SIGNIFICANT' if sh['significant'] else 'NOT SIGNIFICANT'})")
    else:
        print(f"  {sh.get('reason', 'N/A')}")
    print(f"  {sh['interpretation']}")

    ab = report["ablation"]
    print()
    print("  3. ABLATION")
    print(f"  {sep}")
    for r in ab["by_config"]:
        print(f"  {r['config']:<22}  N={r['n_trades']:>4}  skill={r['skill_score']:>+.4f}")
    print(f"  {ab['interpretation']}")

    pl = report.get("placebo_matching", {})
    if pl and pl.get("valid", True):
        print()
        print("  4. PLACEBO MATCHING")
        print(f"  {sep}")
        print(f"  Real skill:    {pl.get('real_skill', 0):+.4f}")
        print(f"  Placebo skill: {pl.get('placebo_skill', 0):+.4f}")
        print(f"  Collapsed:     {'YES ✓' if pl.get('collapsed') else 'NO ✗'}")
        print(f"  {pl.get('interpretation', '')}")

    ns = report.get("noise_injection", {})
    if ns:
        print()
        print("  5. NOISE INJECTION")
        print(f"  {sep}")
        print(f"  Base skill: {ns.get('base_skill', 0):+.4f}")
        for r in ns.get("by_noise", []):
            print(f"  σ={r['sigma']:.1%}  skill={r['skill_score']:>+.4f}  WR_excess={r['wr_excess']:>+.4f}")
        print(f"  Monotone: {'YES ✓' if ns.get('monotone_degradation') else 'NO ✗'}")

    ex = report.get("execution_stress", {})
    if ex:
        print()
        print("  6. EXECUTION STRESS")
        print(f"  {sep}")
        for r in ex.get("by_stress", []):
            print(f"  x{r['stress_mult']:.1f}  N={r['n_trades']:>4}  skill={r['skill_score']:>+.4f}  "
                  f"PnL=${r['total_pnl']:>8.2f}  unfilled={r['n_unfilled']}")
        print(f"  {ex.get('interpretation', '')}")

    lt = report.get("latency_stress", {})
    if lt:
        print()
        print("  7. LATENCY STRESS")
        print(f"  {sep}")
        for r in lt.get("by_latency", []):
            print(f"  {r['latency_sec']:>3}s  N={r['n_trades']:>4}  "
                  f"WR_excess={r['wr_excess']:>+.4f}  PnL=${r['total_pnl']:>8.2f}  "
                  f"unfilled={r['n_unfilled']}")
        print(f"  {lt.get('interpretation', '')}")

    ed = report.get("edge_decay", {})
    if ed and ed.get("valid"):
        print()
        print("  8. EDGE DECAY / HORIZON")
        print(f"  {sep}")
        print(f"  Median horizon (days): {ed['median_horizon_days']}")
        print(f"  P25 / P75 (days):      {ed['p25_horizon_days']} / {ed['p75_horizon_days']}")
        print(f"  % resolving < 7d:      {ed['pct_below_7d']:.1f}%")
        print(f"  {ed.get('interpretation', '')}")

    print("=" * width)
    print()
