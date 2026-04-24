"""
Snapshot daemon — runs on Fly.io alongside the Node.js bot.

Collects data at regular intervals without the heavy ML dependencies
(sentence-transformers, torch, numpy) that are only needed for backtesting.

Schedule:
  - Polymarket prices     : every 5 minutes
  - Metaculus snapshots   : every 4 hours
  - Manifold snapshots    : every 4 hours
  - Market list refresh   : every 24 hours

Usage:
    python snapshot_daemon.py [--db /data/backtest.db] [--price-interval 300]
"""

import argparse
import logging
import time

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("snapshot_daemon")

PRICE_INTERVAL   = 5  * 60       # 5 min
META_INTERVAL    = 4  * 60 * 60  # 4 h
MANI_INTERVAL    = 4  * 60 * 60  # 4 h
MARKET_INTERVAL  = 24 * 60 * 60  # 24 h


def run(db_path: str, price_interval: int) -> None:
    from data_collector import (
        init_db, PolymarketCollector, MetaculusCollector, ManifoldCollector
    )
    from price_recorder import snapshot_prices

    conn = init_db(db_path)
    poly = PolymarketCollector(conn)
    meta = MetaculusCollector(conn)
    mani = ManifoldCollector(conn)

    last_meta   = 0.0
    last_mani   = 0.0
    last_market = 0.0

    log.info("Snapshot daemon started (db=%s, price_interval=%ds)", db_path, price_interval)

    while True:
        now = time.time()

        # ── Polymarket prices (every price_interval seconds) ──────────────
        try:
            snapshot_prices(conn)
        except Exception as e:
            log.error("Price snapshot error: %s", e)

        # ── Metaculus (every 4 hours) ─────────────────────────────────────
        if now - last_meta >= META_INTERVAL:
            try:
                n = meta.snapshot_open_questions(pages=30)
                log.info("Metaculus: %d snapshots", n)
                last_meta = now
            except Exception as e:
                log.error("Metaculus snapshot error: %s", e)

        # ── Manifold (every 4 hours) ──────────────────────────────────────
        if now - last_mani >= MANI_INTERVAL:
            try:
                n = mani.snapshot_open_markets(limit=500)
                log.info("Manifold: %d snapshots", n)
                last_mani = now
            except Exception as e:
                log.error("Manifold snapshot error: %s", e)

        # ── Market list refresh (every 24 hours) ──────────────────────────
        if now - last_market >= MARKET_INTERVAL:
            try:
                poly.fetch_markets(limit=1000, closed=False)
                poly.fetch_markets(limit=500,  closed=True)
                poly.fetch_resolutions()
                log.info("Market list refreshed")
                last_market = now
            except Exception as e:
                log.error("Market refresh error: %s", e)

        time.sleep(price_interval)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Polymarket snapshot daemon")
    parser.add_argument("--db", default="/data/backtest.db", help="SQLite DB path")
    parser.add_argument("--price-interval", type=int, default=PRICE_INTERVAL,
                        help="Polymarket price snapshot interval in seconds")
    args = parser.parse_args()

    run(args.db, args.price_interval)
