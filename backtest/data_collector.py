"""
Data collection from Polymarket (Gamma API), Metaculus, and Manifold.

Key anti-lookahead design:
  - metaculus_prob_history: timestamped snapshots of community_prob for OPEN questions
  - get_prob_at(question_id, as_of): returns the latest prob strictly before as_of
  - Resolved questions are NEVER used as consensus signal sources
  - neg_risk_group_id: the shared event identifier for negRisk outcome sets
"""

import sqlite3
import time
import logging
from datetime import datetime, timezone
from typing import Optional
import requests

log = logging.getLogger(__name__)

GAMMA_BASE = "https://gamma-api.polymarket.com"
METACULUS_BASE = "https://www.metaculus.com/api"   # v3 API (v2 returns 403)
MANIFOLD_BASE = "https://api.manifold.markets/v0"


# ──────────────────────────────────────────────
# DATABASE
# ──────────────────────────────────────────────

def init_db(path: str = "backtest.db") -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS poly_markets (
            id                  TEXT PRIMARY KEY,
            question            TEXT NOT NULL,
            end_date            TEXT,
            neg_risk            INTEGER DEFAULT 0,
            neg_risk_group_id   TEXT,           -- shared ID for the negRisk event set
            liquidity           REAL,
            volume              REAL,
            fetched_at          TEXT NOT NULL
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

        -- Open-question snapshots only. Never store resolved-question final probs.
        CREATE TABLE IF NOT EXISTS metaculus_questions (
            id              INTEGER PRIMARY KEY,
            title           TEXT NOT NULL,
            resolve_time    TEXT,
            num_forecasters INTEGER,
            fetched_at      TEXT NOT NULL
        );

        -- Timestamped probability history — the ONLY valid consensus source.
        -- Each row is a snapshot of community_prob at recorded_at for an OPEN question.
        CREATE TABLE IF NOT EXISTS metaculus_prob_history (
            question_id     INTEGER NOT NULL,
            community_prob  REAL    NOT NULL,
            recorded_at     TEXT    NOT NULL,
            PRIMARY KEY (question_id, recorded_at)
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

        -- Timestamped Manifold probability history for open markets
        CREATE TABLE IF NOT EXISTS manifold_prob_history (
            market_id       TEXT NOT NULL,
            probability     REAL NOT NULL,
            recorded_at     TEXT NOT NULL,
            PRIMARY KEY (market_id, recorded_at)
        );

        CREATE TABLE IF NOT EXISTS matched_pairs (
            poly_id         TEXT NOT NULL,
            source          TEXT NOT NULL,
            source_id       TEXT NOT NULL,
            similarity      REAL NOT NULL,
            date_compatible INTEGER DEFAULT 0,
            entity_overlap  INTEGER DEFAULT 0,
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
SESSION.headers.update({"User-Agent": "polymarket-backtest/2.0"})

def _get(url: str, params: Optional[dict] = None, retries: int = 3) -> Optional[dict]:
    for attempt in range(retries):
        try:
            r = SESSION.get(url, params=params, timeout=20)
            r.raise_for_status()
            return r.json()
        except requests.RequestException as e:
            wait = 2 ** attempt
            log.warning("GET %s failed (attempt %d/%d): %s — retrying in %ds",
                        url, attempt + 1, retries, e, wait)
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

                # negRisk group: prefer negRiskMarketID, fall back to conditionId grouping
                neg_risk = 1 if m.get("negRisk") else 0
                neg_risk_group_id = (
                    m.get("negRiskMarketID") or
                    m.get("negRiskId") or
                    (m.get("conditionId") if neg_risk else None)
                )

                self.conn.execute("""
                    INSERT OR REPLACE INTO poly_markets
                        (id, question, end_date, neg_risk, neg_risk_group_id, liquidity, volume, fetched_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    str(m["id"]),
                    m.get("question", ""),
                    m.get("endDate"),
                    neg_risk,
                    neg_risk_group_id,
                    liq,
                    vol,
                    now,
                ))

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

        log.info("Polymarket: stored %d markets", stored)
        return stored

    def fetch_resolutions(self) -> int:
        rows = self.conn.execute(
            "SELECT id FROM poly_markets WHERE id NOT IN (SELECT market_id FROM poly_resolutions)"
        ).fetchall()

        resolved = 0
        now = datetime.now(timezone.utc).isoformat()

        for row in rows:
            mid = row["id"]
            data = _get(f"{GAMMA_BASE}/markets/{mid}")
            if not data or not data.get("closed"):
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
            time.sleep(0.1)

        self.conn.commit()
        log.info("Polymarket: recorded %d resolutions", resolved)
        return resolved


# ──────────────────────────────────────────────
# METACULUS — OPEN QUESTIONS ONLY
# ──────────────────────────────────────────────

class MetaculusCollector:
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def snapshot_open_questions(self, pages: int = 20) -> int:
        """
        Fetch OPEN binary questions and store a timestamped probability snapshot.

        CRITICAL: only open questions are stored. Resolved questions have community_prob
        that reflects near-resolution consensus — using that as P_true is lookahead.
        """
        next_url: Optional[str] = f"{METACULUS_BASE}/questions/"
        params = {
            "type": "binary",           # v3: "binary" (v2 used "forecast")
            "status": "open",           # OPEN ONLY — never resolved
            "order_by": "-activity",
            "limit": 100,
        }
        page = 0
        now = datetime.now(timezone.utc).isoformat()
        snapshots = 0

        while next_url and page < pages:
            data = _get(next_url, params=(params if page == 0 else None))
            page += 1
            if not data:
                break

            for q in data.get("results", []):
                # Extract community probability — handle v2 and v3 response shapes
                cp = None
                pred = q.get("community_prediction", {})
                if isinstance(pred, dict):
                    # v2: community_prediction.full.q2
                    cp = pred.get("full", {}).get("q2")
                    # v3 flat: community_prediction.q2
                    if cp is None:
                        cp = pred.get("q2")
                # v3 aggregations path
                if cp is None:
                    agg = q.get("aggregations", {})
                    latest = agg.get("recency_weighted", {}).get("latest") or {}
                    means = latest.get("means") or []
                    cp = means[0] if means else None
                if cp is None:
                    continue

                qid = q["id"]

                # Upsert question metadata (title, resolve_time, num_forecasters)
                self.conn.execute("""
                    INSERT OR REPLACE INTO metaculus_questions
                        (id, title, resolve_time, num_forecasters, fetched_at)
                    VALUES (?, ?, ?, ?, ?)
                """, (
                    qid,
                    q.get("title", ""),
                    q.get("resolve_time") or q.get("close_time"),
                    q.get("number_of_forecasters", 0),
                    now,
                ))

                # Append to probability history
                self.conn.execute("""
                    INSERT OR IGNORE INTO metaculus_prob_history (question_id, community_prob, recorded_at)
                    VALUES (?, ?, ?)
                """, (qid, float(cp), now))
                snapshots += 1

            self.conn.commit()
            next_url = data.get("next")
            if next_url:
                time.sleep(0.3)

        log.info("Metaculus: %d probability snapshots stored at %s", snapshots, now)
        return snapshots


# ──────────────────────────────────────────────
# MANIFOLD — OPEN MARKETS ONLY
# ──────────────────────────────────────────────

class ManifoldCollector:
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def snapshot_open_markets(self, limit: int = 500) -> int:
        """Fetch open Manifold markets and store timestamped probability snapshots."""
        now = datetime.now(timezone.utc).isoformat()
        before: Optional[str] = None
        snapshots = 0
        fetched = 0

        while fetched < limit:
            params: dict = {
                "limit": 100,
                "filter": "open",       # v0 API: "open" | "closed" | "resolved" | "all"
                "outcomeType": "BINARY",
                "sort": "liquidity",
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
                    VALUES (?, ?, ?, 0, NULL, ?, ?)
                """, (m["id"], m.get("question", ""), float(prob), m.get("closeTime"), now))

                self.conn.execute("""
                    INSERT OR IGNORE INTO manifold_prob_history (market_id, probability, recorded_at)
                    VALUES (?, ?, ?)
                """, (m["id"], float(prob), now))
                snapshots += 1

            self.conn.commit()
            fetched += len(data)
            if len(data) < 100:
                break
            before = data[-1]["id"]
            time.sleep(0.2)

        log.info("Manifold: %d open-market probability snapshots stored", snapshots)
        return snapshots


# ──────────────────────────────────────────────
# LOOKAHEAD-SAFE PROBABILITY LOOKUP
# ──────────────────────────────────────────────

def get_metaculus_prob_at(
    conn: sqlite3.Connection,
    question_id: int,
    as_of: str,
) -> Optional[float]:
    """
    Return the Metaculus community probability for question_id that was recorded
    STRICTLY BEFORE as_of. Returns None if no snapshot exists before that time.

    This is the only valid way to read consensus probability in the backtester.
    Never call this with as_of after the question's resolve_time.
    """
    row = conn.execute("""
        SELECT community_prob FROM metaculus_prob_history
        WHERE question_id = ? AND recorded_at < ?
        ORDER BY recorded_at DESC
        LIMIT 1
    """, (question_id, as_of)).fetchone()
    return float(row["community_prob"]) if row else None


def get_manifold_prob_at(
    conn: sqlite3.Connection,
    market_id: str,
    as_of: str,
) -> Optional[float]:
    """Return the Manifold probability recorded strictly before as_of."""
    row = conn.execute("""
        SELECT probability FROM manifold_prob_history
        WHERE market_id = ? AND recorded_at < ?
        ORDER BY recorded_at DESC
        LIMIT 1
    """, (market_id, as_of)).fetchone()
    return float(row["probability"]) if row else None
