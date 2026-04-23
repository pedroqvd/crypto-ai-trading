"""
Main entrypoint — runs the full backtesting pipeline end-to-end.

Usage:
    python run.py [options]

Options:
    --db PATH           SQLite database path (default: backtest.db)
    --bankroll FLOAT    Starting bankroll for backtest simulation (default: 1000)
    --train-ratio FLOAT Walk-forward train/test split (default: 0.6)
    --skip-collect      Skip data collection (use existing DB)
    --skip-match        Skip question matching (use existing matches)
    --collect-closed    Also collect recently-closed Polymarket markets

Steps:
  1. Collect markets/prices from Polymarket (Gamma API)
  2. Collect questions from Metaculus and Manifold
  3. Record resolutions for closed markets
  4. Run semantic matching (sentence-transformers)
  5. Generate trade signals (consensus + negRisk strategies)
  6. Backtest signals against resolved outcomes
  7. Validate and print verdict

Runtime: ~10–30 min on first run (embedding 1000s of questions).
         ~2–5 min on subsequent runs with --skip-collect --skip-match.
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
    parser = argparse.ArgumentParser(description="Polymarket backtest pipeline")
    parser.add_argument("--db", default="backtest.db", help="SQLite DB path")
    parser.add_argument("--bankroll", type=float, default=1000.0)
    parser.add_argument("--train-ratio", type=float, default=0.6)
    parser.add_argument("--skip-collect", action="store_true")
    parser.add_argument("--skip-match", action="store_true")
    parser.add_argument("--collect-closed", action="store_true")
    args = parser.parse_args()

    t0 = time.time()

    # ── 1. INIT DB ────────────────────────────────────────────────────────
    log.info("Initialising database: %s", args.db)
    from data_collector import init_db, PolymarketCollector, MetaculusCollector, ManifoldCollector
    conn = init_db(args.db)

    # ── 2. COLLECT DATA ───────────────────────────────────────────────────
    if not args.skip_collect:
        poly = PolymarketCollector(conn)
        meta = MetaculusCollector(conn)
        mani = ManifoldCollector(conn)

        log.info("─── Step 1/7: Fetching active Polymarket markets ───")
        n = poly.fetch_markets(limit=500)
        log.info("  Stored %d markets", n)

        if args.collect_closed:
            log.info("─── Step 1b: Fetching closed Polymarket markets ───")
            n = poly.fetch_markets(limit=500, closed=True)
            log.info("  Stored %d closed markets", n)

        log.info("─── Step 2/7: Fetching Metaculus questions ───")
        n = meta.fetch_questions(pages=30)
        log.info("  Stored %d questions", n)

        log.info("─── Step 3/7: Fetching Manifold markets ───")
        n = mani.fetch_markets(limit=1000)
        log.info("  Stored %d markets", n)

        log.info("─── Step 4/7: Fetching Polymarket resolutions ───")
        n = poly.fetch_resolutions()
        log.info("  Recorded %d resolutions", n)
    else:
        log.info("Skipping data collection (--skip-collect)")

    # ── 3. MATCH QUESTIONS ────────────────────────────────────────────────
    if not args.skip_match:
        from question_matcher import match_polymarket_to_metaculus, match_polymarket_to_manifold
        log.info("─── Step 5/7: Semantic question matching ───")
        n_meta = match_polymarket_to_metaculus(conn, threshold=0.75)
        n_mani = match_polymarket_to_manifold(conn, threshold=0.75)
        log.info("  New pairs: %d Metaculus, %d Manifold", n_meta, n_mani)
    else:
        log.info("Skipping question matching (--skip-match)")

    # ── 4. GENERATE SIGNALS ───────────────────────────────────────────────
    log.info("─── Step 6/7: Generating signals ───")
    from strategy import generate_all_signals
    signals = generate_all_signals(conn)

    if not signals:
        log.warning("No signals generated — nothing to backtest.")
        _print_no_data_verdict()
        return 1

    log.info("  %d signals generated", len(signals))

    # ── 5. BACKTEST ───────────────────────────────────────────────────────
    log.info("─── Step 7/7: Backtesting ───")
    from backtest import Backtester
    backtester = Backtester(conn, bankroll=args.bankroll)
    result = backtester.run(signals, train_ratio=args.train_ratio)

    # ── 6. VALIDATE AND PRINT ─────────────────────────────────────────────
    from validator import validate, print_report
    verdict_data = validate(result, bankroll=args.bankroll)
    print_report(verdict_data)

    elapsed = time.time() - t0
    log.info("Pipeline complete in %.1fs", elapsed)

    return 0 if verdict_data["all_pass"] else 1


def _print_no_data_verdict() -> None:
    width = 60
    print()
    print("=" * width)
    print("  ❌  SEM EDGE")
    print("=" * width)
    print()
    print("  Insufficient data to backtest.")
    print("  Possible causes:")
    print("   • No matched question pairs found (similarity < 0.75)")
    print("   • No Polymarket resolutions recorded")
    print("   • Minimum edge threshold too high (MIN_EDGE=3%)")
    print()
    print("  RECOMMENDATION:")
    print("   1. Run price_recorder.py as a daemon for 1-2 weeks")
    print("   2. Re-run with --collect-closed to get resolved markets")
    print("   3. Lower similarity threshold cautiously (floor: 0.65)")
    print("=" * width)
    print()


if __name__ == "__main__":
    sys.exit(main())
