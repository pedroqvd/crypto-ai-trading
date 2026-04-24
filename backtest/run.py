"""
Main entrypoint — runs the full pipeline end-to-end and outputs a verdict.

Usage:
    cd backtest
    python run.py [options]

Options:
    --db PATH               SQLite DB path (default: backtest.db)
    --bankroll FLOAT        Starting bankroll (default: 1000)
    --train-ratio FLOAT     Walk-forward split (default: 0.6)
    --skip-collect          Skip data collection (use existing DB)
    --skip-match            Skip question matching (use existing matched_pairs)
    --auto-threshold        Find the optimal similarity threshold automatically
    --skip-robustness       Skip robustness tests (faster, less reliable)
    --n-shuffle INT         Shuffle test iterations (default: 200)

Pipeline:
  1. Collect Polymarket markets + prices
  2. Snapshot Metaculus open questions (probability history)
  3. Snapshot Manifold open markets (probability history)
  4. Fetch Polymarket resolutions
  5. Semantic question matching (with date + entity filters)
  6. Validate match concordance — abort if < 70%
  7. Generate signals (consensus + negRisk)
  8. Backtest (walk-forward, realistic slippage)
  9. Robustness tests (threshold sensitivity, shuffle, ablation)
  10. Final verdict

NOTE on data volume:
  The system needs historical Metaculus probability snapshots collected BEFORE
  the Polymarket markets resolve. On first run there is no history, so the
  system will return 0 consensus signals (no pre-resolution snapshots exist yet).

  To build useful history:
    - Run `python price_recorder.py` as a daemon
    - Run this script daily: python run.py --skip-collect
  After 2-4 weeks, you'll have enough temporal data for a meaningful backtest.
"""

import argparse
import logging
import sys
import time

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("run")


def main() -> int:
    parser = argparse.ArgumentParser(description="Polymarket backtest pipeline v2")
    parser.add_argument("--db", default="backtest.db")
    parser.add_argument("--bankroll", type=float, default=1000.0)
    parser.add_argument("--train-ratio", type=float, default=0.6)
    parser.add_argument("--skip-collect", action="store_true")
    parser.add_argument("--skip-match", action="store_true")
    parser.add_argument("--auto-threshold", action="store_true")
    parser.add_argument("--skip-robustness", action="store_true")
    parser.add_argument("--n-shuffle", type=int, default=200)
    args = parser.parse_args()

    t0 = time.time()

    # ── 1. INIT DB ─────────────────────────────────────────────────────────
    log.info("Initialising database: %s", args.db)
    from data_collector import (
        init_db, PolymarketCollector, MetaculusCollector, ManifoldCollector
    )
    conn = init_db(args.db)

    # ── 2. COLLECT ─────────────────────────────────────────────────────────
    if not args.skip_collect:
        poly = PolymarketCollector(conn)
        meta = MetaculusCollector(conn)
        mani = ManifoldCollector(conn)

        log.info("─── Step 1: Polymarket markets ───")
        poly.fetch_markets(limit=500, closed=False)
        poly.fetch_markets(limit=500, closed=True)   # for resolutions

        log.info("─── Step 2: Metaculus open-question snapshots ───")
        meta.snapshot_open_questions(pages=30)

        log.info("─── Step 3: Manifold open-market snapshots ───")
        mani.snapshot_open_markets(limit=500)

        log.info("─── Step 4: Polymarket resolutions ───")
        poly.fetch_resolutions()
    else:
        log.info("Skipping collection (--skip-collect)")

    # ── 3. MATCHING ────────────────────────────────────────────────────────
    if not args.skip_match:
        from question_matcher import (
            match_polymarket_to_metaculus, match_polymarket_to_manifold,
            find_optimal_threshold, validate_match_quality, DEFAULT_THRESHOLD
        )

        if args.auto_threshold:
            log.info("─── Step 5: Auto-selecting similarity threshold ───")
            threshold_result = find_optimal_threshold(conn)
            selected_threshold = threshold_result["selected_threshold"]
            log.info("Selected threshold: %.2f", selected_threshold)
        else:
            log.info("─── Step 5: Question matching (threshold=%.2f) ───", DEFAULT_THRESHOLD)
            match_polymarket_to_metaculus(conn, threshold=DEFAULT_THRESHOLD)
            match_polymarket_to_manifold(conn, threshold=DEFAULT_THRESHOLD)

        # ── 4. CONCORDANCE CHECK ───────────────────────────────────────────
        log.info("─── Step 6: Match concordance validation ───")
        from question_matcher import validate_match_quality
        quality = validate_match_quality(conn)
        log.info("Match concordance: %s (valid=%s)", quality.get("concordance"), quality["valid"])

        if not quality["valid"]:
            log.error(
                "Match quality insufficient: %s. "
                "System cannot produce reliable signals. "
                "Increase threshold or collect more data.",
                quality["reason"]
            )
            if quality["n"] >= 30:
                # Enough data to know it's bad — hard stop
                _print_abort(quality)
                return 1
            else:
                log.warning("Too few verified pairs (%d) to assess quality — continuing", quality["n"])
    else:
        log.info("Skipping matching (--skip-match)")
        quality = {"concordance": None, "valid": None, "n": 0, "reason": "skipped"}

    # ── 5. SIGNALS ─────────────────────────────────────────────────────────
    log.info("─── Step 7: Generating signals ───")
    from strategy import generate_all_signals
    signals = generate_all_signals(conn)
    log.info("Signals generated: %d", len(signals))

    if not signals:
        _print_no_signals()
        return 1

    # ── 6. BACKTEST ────────────────────────────────────────────────────────
    log.info("─── Step 8: Backtesting ───")
    from backtest import Backtester
    backtester = Backtester(conn, bankroll=args.bankroll)
    result = backtester.run(signals, train_ratio=args.train_ratio, embargo_days=14)

    # ── 7. ROBUSTNESS ──────────────────────────────────────────────────────
    robustness = None
    if not args.skip_robustness:
        log.info("─── Step 9: Robustness tests ───")
        from robustness import run_all_robustness_tests, print_robustness_report
        robustness = run_all_robustness_tests(
            conn, signals, backtester,
            train_ratio=args.train_ratio,
            n_shuffle=args.n_shuffle,
        )
        print_robustness_report(robustness)
    else:
        log.info("Skipping robustness tests (--skip-robustness)")

    # ── 8. VERDICT ─────────────────────────────────────────────────────────
    log.info("─── Step 10: Final verdict ───")
    from validator import validate, print_report
    verdict_data = validate(
        result,
        robustness=robustness,
        match_quality=quality,
        bankroll=args.bankroll,
    )
    print_report(verdict_data)

    elapsed = time.time() - t0
    log.info("Pipeline complete in %.1fs", elapsed)

    return 0 if verdict_data["all_pass"] else 1


def _print_abort(quality: dict) -> None:
    print()
    print("=" * 60)
    print("  ❌  ABORTED — MATCH QUALITY INSUFFICIENT")
    print("=" * 60)
    print()
    print(f"  Concordance: {quality.get('concordance', 'N/A'):.0%}")
    print(f"  Verified pairs: {quality['n']}")
    print(f"  Required: ≥70% concordance with ≥30 pairs")
    print()
    print("  Semantic similarity alone does not guarantee that the")
    print("  matched questions resolve the same way. At this concordance")
    print("  level, consensus probabilities are worse than random for")
    print("  estimating P_true.")
    print()
    print("  Actions:")
    print("   1. Increase --similarity threshold (try 0.85)")
    print("   2. Collect more data (run price_recorder.py for 2+ weeks)")
    print("   3. Add manual review of the worst-concordance pairs")
    print("=" * 60)
    print()


def _print_no_signals() -> None:
    print()
    print("=" * 60)
    print("  ❌  EDGE NÃO COMPROVADO — NO SIGNALS GENERATED")
    print("=" * 60)
    print()
    print("  Zero signals passed all entry filters. Likely causes:")
    print()
    print("  a) No Metaculus prob snapshots before price dates:")
    print("     The system needs pre-resolution Metaculus history.")
    print("     Run `python price_recorder.py` daily for 2+ weeks.")
    print()
    print("  b) Entry filters too strict:")
    print("     MIN_EDGE=6%, MIN_FORECASTERS=20, MIN_DAYS=7")
    print("     All must be satisfied simultaneously.")
    print()
    print("  c) No matched pairs with neg_risk_group_id set:")
    print("     Polymarket may not return negRiskMarketID on this endpoint.")
    print("     Check the raw API response for your markets.")
    print("=" * 60)
    print()


if __name__ == "__main__":
    sys.exit(main())
