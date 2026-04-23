"""
Data collection from Polymarket (Gamma API), Metaculus, and Manifold.
Stores everything in SQLite — no lookahead bias by recording fetch timestamps.
"""

import sqlite3
import time
import logging
from datetime import datetime, timezone
from typing import Optional
import requests

log = logging.getLogger(__name__)

GAMMA_BASE = "https://gamma-api.polymarket.com"
METACULUS_BASE = "https://www.metaculus.com/api2"
MANIFOLD_BASE = "https://api.manifold.markets/v0"

# ──────────────────────────────────────────────
# DATABASE
# ──────────────────────────────────────────────

def init_db(path: str = "backtest.db") -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS poly_markets (
            id              TEXT PRIMARY KEY,
            question        TEXT NOT NULL,
            end_date        TEXT,
            neg_risk        INTEGER DEFAULT 0,
            liquidity       REAL,
            volume          REAL,
            fetched_at      TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS poly_prices (
            market_id       TEXT NOT NULL,
            yes_price       REAL NOT NULL,
            no_price        REAL NOT NULL,
            recorded_at     TEXT NOT NULL,
            PRIMARY KEY (market_id, recorded_at)
        );

        CREATE TABLE IF NOT EXISTS poly_resolutions (
            market_id       TEXT PRIMARY KEY,
            outcome         TEXT NOT NULL,   -- 'YES' | 'NO' | 'INVALID'
            resolved_at     TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS metaculus_questions (
            id              INTEGER PRIMARY KEY,
            title           TEXT NOT NULL,
            community_prob  REAL,            -- latest community prediction [0,1]
            num_forecasters INTEGER,
            resolve_time    TEXT,
            resolution      REAL,            -- 1=yes 0=no NULL=unresolved
            fetched_at      TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS manifold_markets (
            id              TEXT PRIMARY KEY,
            question        TEXT NOT NULL,
            probability     REAL,
            is_resolved     INTEGER DEFAULT 0,
            resolution      TEXT,
            close_time      TEXT,
            fetched_at      TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS matched_pairs (
            poly_id         TEXT NOT NULL,
            source          TEXT NOT NULL,   -- 'metaculus' | 'manifold'
            source_id       TEXT NOT NULL,
            similarity      REAL NOT NULL,
            created_at      TEXT NOT NULL,
            PRIMARY KEY (poly_id, source, source_id)
        );
    """)
    conn.commit()
    return conn


# ──────────────────────────────────────────────
# HTTP HELPERS
# ──────────────────────────────────────────────

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "polymarket-backtest/1.0"})

def _get(url: str, params: Optional[dict] = None, retries: int = 3) -> Optional[dict]:
    for attempt in range(retries):
        try:
            r = SESSION.get(url, params=params, timeout=20)
            r.raise_for_status()
            return r.json()
        except requests.RequestException as e:
            wait = 2 ** attempt
            log.warning("GET %s failed (attempt %d/%d): %s — retrying in %ds", url, attempt + 1, retries, e, wait)
            time.sleep(wait)
    return None


# ──────────────────────────────────────────────
# POLYMARKET — GAMMA API
# ──────────────────────────────────────────────

class PolymarketCollector:
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def fetch_markets(
        self,
        limit: int = 500,
        min_liquidity: float = 5_000,
        min_volume: float = 10_000,
        closed: bool = False,
    ) -> int:
        """Fetch active or recently-closed markets and store them."""
        stored = 0
        offset = 0
        now = datetime.now(timezone.utc).isoformat()

        while True:
            params: dict = {
                "limit": min(limit, 100),
                "offset": offset,
                "active": str(not closed).lower(),
                "closed": str(closed).lower(),
                "order": "volume",
                "ascending": "false",
            }
            data = _get(f"{GAMMA_BASE}/markets", params=params)
            if not data:
                break

            markets = data if isinstance(data, list) else data.get("markets", [])
            if not markets:
                break

            for m in markets:
                liq = float(m.get("liquidity") or 0)
                vol = float(m.get("volume") or 0)
                if liq < min_liquidity or vol < min_volume:
                    continue

                yes_price = float(m.get("bestAsk") or m.get("lastTradePrice") or 0)
                no_price = round(1 - yes_price, 6)

                self.conn.execute("""
                    INSERT OR REPLACE INTO poly_markets
                        (id, question, end_date, neg_risk, liquidity, volume, fetched_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (
                    str(m["id"]),
                    m.get("question", ""),
                    m.get("endDate"),
                    1 if m.get("negRisk") else 0,
                    liq,
                    vol,
                    now,
                ))

                # Record price snapshot with fetch timestamp (no lookahead)
                if yes_price > 0:
                    self.conn.execute("""
                        INSERT OR IGNORE INTO poly_prices (market_id, yes_price, no_price, recorded_at)
                        VALUES (?, ?, ?, ?)
                    """, (str(m["id"]), yes_price, no_price, now))

                stored += 1

            self.conn.commit()
            if len(markets) < 100:
                break
            offset += 100

        log.info("Polymarket: stored %d markets (offset=%d)", stored, offset)
        return stored

    def fetch_resolutions(self) -> int:
        """Check stored markets for resolved status and record outcomes."""
        rows = self.conn.execute(
            "SELECT id FROM poly_markets WHERE id NOT IN (SELECT market_id FROM poly_resolutions)"
        ).fetchall()

        resolved = 0
        now = datetime.now(timezone.utc).isoformat()

        for row in rows:
            mid = row["id"]
            data = _get(f"{GAMMA_BASE}/markets/{mid}")
            if not data:
                continue

            # Resolved when one side is at 1.0 and closed is true
            if not data.get("closed"):
                continue

            last_price = float(data.get("lastTradePrice") or 0)
            if last_price >= 0.99:
                outcome = "YES"
            elif last_price <= 0.01:
                outcome = "NO"
            else:
                outcome = "INVALID"

            resolved_at = data.get("endDate") or now
            self.conn.execute("""
                INSERT OR IGNORE INTO poly_resolutions (market_id, outcome, resolved_at)
                VALUES (?, ?, ?)
            """, (mid, outcome, resolved_at))
            resolved += 1
            time.sleep(0.1)  # rate limit

        self.conn.commit()
        log.info("Polymarket: recorded %d resolutions", resolved)
        return resolved


# ──────────────────────────────────────────────
# METACULUS
# ──────────────────────────────────────────────

class MetaculusCollector:
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def fetch_questions(self, pages: int = 20) -> int:
        """Fetch binary questions with community predictions."""
        stored = 0
        next_url: Optional[str] = f"{METACULUS_BASE}/questions/"
        params = {
            "type": "forecast",
            "status": "resolved",
            "order_by": "-close_time",
            "limit": 100,
        }
        page = 0
        now = datetime.now(timezone.utc).isoformat()

        while next_url and page < pages:
            data = _get(next_url, params=(params if page == 0 else None))
            page += 1
            if not data:
                break

            for q in data.get("results", []):
                # Only binary questions (probability ∈ [0,1])
                pred = q.get("community_prediction", {})
                cp = pred.get("full", {}).get("q2") if isinstance(pred, dict) else None
                if cp is None:
                    continue

                # Resolution: 1=yes, 0=no, ambiguous→skip
                resolution = q.get("resolution")
                if resolution not in (0, 1, 0.0, 1.0):
                    resolution = None

                self.conn.execute("""
                    INSERT OR REPLACE INTO metaculus_questions
                        (id, title, community_prob, num_forecasters, resolve_time, resolution, fetched_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (
                    q["id"],
                    q.get("title", ""),
                    float(cp),
                    q.get("number_of_forecasters", 0),
                    q.get("close_time"),
                    float(resolution) if resolution is not None else None,
                    now,
                ))
                stored += 1

            self.conn.commit()
            next_url = data.get("next")
            if next_url:
                time.sleep(0.3)  # respectful rate limit

        log.info("Metaculus: stored %d questions", stored)
        return stored


# ──────────────────────────────────────────────
# MANIFOLD
# ──────────────────────────────────────────────

class ManifoldCollector:
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def fetch_markets(self, limit: int = 1000) -> int:
        """Fetch resolved binary markets from Manifold."""
        stored = 0
        before: Optional[str] = None
        now = datetime.now(timezone.utc).isoformat()
        fetched = 0

        while fetched < limit:
            params: dict = {
                "limit": 100,
                "isResolved": "true",
                "outcomeType": "BINARY",
                "sort": "liquidity",
                "order": "desc",
            }
            if before:
                params["before"] = before

            data = _get(f"{MANIFOLD_BASE}/markets", params=params)
            if not data or not isinstance(data, list):
                break

            for m in data:
                prob = m.get("probability")
                if prob is None:
                    continue
                self.conn.execute("""
                    INSERT OR REPLACE INTO manifold_markets
                        (id, question, probability, is_resolved, resolution, close_time, fetched_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (
                    m["id"],
                    m.get("question", ""),
                    float(prob),
                    1 if m.get("isResolved") else 0,
                    m.get("resolution"),
                    m.get("closeTime"),
                    now,
                ))
                stored += 1

            self.conn.commit()
            fetched += len(data)
            if len(data) < 100:
                break
            before = data[-1]["id"]
            time.sleep(0.2)

        log.info("Manifold: stored %d markets", stored)
        return stored
