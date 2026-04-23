"""
Price recorder — periodically snapshots Polymarket prices into SQLite.

Run as a daemon during live trading to build a lookahead-free price history.
Each row's recorded_at is the wall-clock time of observation, NOT the market's
end_date, ensuring no future information leaks into backtests.

Usage:
    python price_recorder.py [--db backtest.db] [--interval 300]
"""

import argparse
import logging
import sqlite3
import time
from datetime import datetime, timezone
from typing import Optional

import requests

log = logging.getLogger(__name__)

GAMMA_BASE = "https://gamma-api.polymarket.com"
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "polymarket-backtest/1.0"})


def _get(url: str, params: Optional[dict] = None) -> Optional[dict]:
    try:
        r = SESSION.get(url, params=params, timeout=20)
        r.raise_for_status()
        return r.json()
    except requests.RequestException as e:
        log.warning("GET %s: %s", url, e)
        return None


def snapshot_prices(conn: sqlite3.Connection) -> int:
    """
    Pull current YES/NO prices for all tracked markets and write a timestamped row.
    Markets already resolved (in poly_resolutions) are skipped.
    """
    market_ids = conn.execute("""
        SELECT id FROM poly_markets
        WHERE id NOT IN (SELECT market_id FROM poly_resolutions)
    """).fetchall()

    if not market_ids:
        return 0

    now = datetime.now(timezone.utc).isoformat()
    recorded = 0
    ids = [r["id"] for r in market_ids]

    # Batch-fetch in pages of 100
    for i in range(0, len(ids), 100):
        batch = ids[i:i + 100]
        params = {"id": ",".join(batch)}
        data = _get(f"{GAMMA_BASE}/markets", params=params)
        if not data:
            continue

        markets = data if isinstance(data, list) else data.get("markets", [])
        for m in markets:
            yes_price = float(m.get("bestAsk") or m.get("lastTradePrice") or 0)
            if yes_price <= 0:
                continue
            no_price = round(1 - yes_price, 6)
            try:
                conn.execute("""
                    INSERT OR IGNORE INTO poly_prices (market_id, yes_price, no_price, recorded_at)
                    VALUES (?, ?, ?, ?)
                """, (str(m["id"]), yes_price, no_price, now))
                recorded += 1
            except sqlite3.Error as e:
                log.error("DB insert error: %s", e)

        time.sleep(0.2)

    conn.commit()
    log.info("Snapshot: recorded %d prices at %s", recorded, now)
    return recorded


def get_price_at(conn: sqlite3.Connection, market_id: str, as_of: str) -> Optional[float]:
    """
    Return the YES price for market_id that was observed no later than as_of.
    This is the lookahead-safe price lookup used by the backtester.
    """
    row = conn.execute("""
        SELECT yes_price FROM poly_prices
        WHERE market_id = ? AND recorded_at <= ?
        ORDER BY recorded_at DESC
        LIMIT 1
    """, (market_id, as_of)).fetchone()
    return float(row["yes_price"]) if row else None


def get_price_series(
    conn: sqlite3.Connection,
    market_id: str,
    start: Optional[str] = None,
    end: Optional[str] = None,
) -> list[dict]:
    """
    Return the full price series for a market within an optional time range.
    Each row: {recorded_at, yes_price, no_price}
    """
    query = "SELECT recorded_at, yes_price, no_price FROM poly_prices WHERE market_id = ?"
    params: list = [market_id]
    if start:
        query += " AND recorded_at >= ?"
        params.append(start)
    if end:
        query += " AND recorded_at <= ?"
        params.append(end)
    query += " ORDER BY recorded_at ASC"
    rows = conn.execute(query, params).fetchall()
    return [dict(r) for r in rows]


def run_daemon(db_path: str, interval_seconds: int) -> None:
    """Continuously snapshot prices at the given interval."""
    import sqlite3 as _sqlite3
    conn = _sqlite3.connect(db_path)
    conn.row_factory = _sqlite3.Row

    log.info("Price recorder daemon started (interval=%ds, db=%s)", interval_seconds, db_path)
    while True:
        try:
            snapshot_prices(conn)
        except Exception as e:
            log.error("Snapshot failed: %s", e)
        time.sleep(interval_seconds)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    parser = argparse.ArgumentParser(description="Polymarket price recorder daemon")
    parser.add_argument("--db", default="backtest.db", help="SQLite DB path")
    parser.add_argument("--interval", type=int, default=300, help="Snapshot interval in seconds")
    args = parser.parse_args()

    run_daemon(args.db, args.interval)
