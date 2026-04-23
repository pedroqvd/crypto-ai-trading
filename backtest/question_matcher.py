"""
Semantic question matching: Polymarket ↔ Metaculus / Manifold.

Matching pipeline per pair:
  1. Embedding cosine similarity ≥ threshold (sentence-transformers)
  2. Date compatibility: |end_date - resolve_time| ≤ 45 days
  3. Entity overlap: ≥ 1 shared capitalized token or year

A pair passes only if ALL three conditions hold.

Empirical concordance validation:
  For matched pairs where both sides are resolved, compare binary outcomes.
  Concordance < 70% → threshold too low, system is invalid.
  Concordance < 60% → equivalent to random matching.

Dynamic threshold selection:
  Tests 0.75 / 0.80 / 0.85 / 0.90, picks the lowest threshold
  that achieves concordance ≥ 0.70 with N ≥ 30 verifiable pairs.
"""

import logging
import re
import sqlite3
from datetime import datetime, timezone
from typing import Optional

import numpy as np

log = logging.getLogger(__name__)

EMBEDDING_MODEL = "all-MiniLM-L6-v2"
DEFAULT_THRESHOLD = 0.80        # conservative starting point
MAX_DATE_DELTA_DAYS = 45        # resolution dates must be within 45 days
MIN_CONCORDANCE = 0.70          # below this → system is invalid
MIN_CONCORDANCE_N = 30          # minimum resolved pairs to trust concordance estimate

_model = None


def _get_model():
    global _model
    if _model is None:
        try:
            from sentence_transformers import SentenceTransformer
            log.info("Loading embedding model %s ...", EMBEDDING_MODEL)
            _model = SentenceTransformer(EMBEDDING_MODEL)
        except ImportError:
            raise RuntimeError(
                "sentence-transformers required. Run: pip install sentence-transformers"
            )
    return _model


def embed_texts(texts: list[str]) -> np.ndarray:
    model = _get_model()
    return model.encode(
        texts, batch_size=64,
        show_progress_bar=len(texts) > 100,
        normalize_embeddings=True,
    )


# ──────────────────────────────────────────────
# FILTER 1: DATE COMPATIBILITY
# ──────────────────────────────────────────────

def _parse_date(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    s = s.rstrip("Z")
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(s.replace("+00:00", ""), fmt.replace("%z", ""))
            return dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def dates_compatible(poly_end_date: Optional[str], meta_resolve_time: Optional[str]) -> bool:
    """True if dates are within MAX_DATE_DELTA_DAYS, or if either is missing."""
    if not poly_end_date or not meta_resolve_time:
        return True  # can't check; allow but flag later
    a = _parse_date(poly_end_date)
    b = _parse_date(meta_resolve_time)
    if a is None or b is None:
        return True
    return abs((a - b).days) <= MAX_DATE_DELTA_DAYS


# ──────────────────────────────────────────────
# FILTER 2: ENTITY OVERLAP
# ──────────────────────────────────────────────

# Tokens that are semantically loaded in prediction-market questions but
# not distinctive entities (they appear in almost every question).
_STOP = {
    "Will", "The", "By", "In", "On", "At", "To", "For", "Of", "And", "Or",
    "Be", "Is", "Are", "Was", "Were", "Have", "Has", "Do", "Did",
    "Win", "Lose", "Get", "Happen", "Occur", "Pass", "Fail",
    "Yes", "No", "New", "First", "Next", "Last", "More", "Most",
}

def _key_tokens(text: str) -> set[str]:
    """
    Extract distinctive tokens: capitalized words and 4-digit years.
    Filters out stop words.
    """
    caps = set(re.findall(r'\b[A-Z][a-zA-Z]{1,}', text))
    years = set(re.findall(r'\b(19|20)\d{2}\b', text))
    return (caps - _STOP) | years


def entities_compatible(poly_q: str, meta_q: str, min_overlap: int = 1) -> bool:
    """
    True if the two questions share at least min_overlap key tokens.
    If either question has no key tokens, returns True (can't reject).
    """
    pt = _key_tokens(poly_q)
    mt = _key_tokens(meta_q)
    if not pt or not mt:
        return True
    return len(pt & mt) >= min_overlap


# ──────────────────────────────────────────────
# CORE MATCHING
# ──────────────────────────────────────────────

def _run_matching(
    conn: sqlite3.Connection,
    source: str,           # 'metaculus' | 'manifold'
    threshold: float,
    poly_rows: list,
    ext_rows: list,
    ext_questions: list[str],
    ext_resolve_times: list[Optional[str]],
) -> int:
    """Inner loop: embed, filter, store. Returns new pairs added."""
    if not poly_rows or not ext_rows:
        return 0

    poly_texts = [r["question"] for r in poly_rows]
    poly_embs = embed_texts(poly_texts)
    ext_embs = embed_texts(ext_questions)

    sim_matrix = poly_embs @ ext_embs.T

    now = datetime.now(timezone.utc).isoformat()
    added = 0

    for i, poly_row in enumerate(poly_rows):
        best_j = int(np.argmax(sim_matrix[i]))
        best_sim = float(sim_matrix[i, best_j])

        if best_sim < threshold:
            continue

        ext_row = ext_rows[best_j]
        ext_resolve = ext_resolve_times[best_j]

        # Date check
        date_ok = dates_compatible(poly_row["end_date"], ext_resolve)
        if not date_ok:
            continue

        # Entity check
        entity_ok = entities_compatible(poly_row["question"], ext_questions[best_j])
        if not entity_ok:
            continue

        source_id = str(ext_row["id"])
        try:
            conn.execute("""
                INSERT OR IGNORE INTO matched_pairs
                    (poly_id, source, source_id, similarity, date_compatible, entity_overlap, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (poly_row["id"], source, source_id, best_sim, int(date_ok), int(entity_ok), now))
            added += 1
        except sqlite3.Error as e:
            log.error("DB error: %s", e)

    conn.commit()
    return added


def match_polymarket_to_metaculus(
    conn: sqlite3.Connection,
    threshold: float = DEFAULT_THRESHOLD,
) -> int:
    poly_rows = conn.execute("SELECT id, question, end_date FROM poly_markets").fetchall()
    meta_rows = conn.execute(
        "SELECT id, title, resolve_time FROM metaculus_questions"
    ).fetchall()

    log.info("Matching %d poly ↔ %d metaculus questions (threshold=%.2f)",
             len(poly_rows), len(meta_rows), threshold)

    added = _run_matching(
        conn, "metaculus", threshold,
        poly_rows, meta_rows,
        [r["title"] for r in meta_rows],
        [r["resolve_time"] for r in meta_rows],
    )
    log.info("Metaculus: %d new pairs", added)
    return added


def match_polymarket_to_manifold(
    conn: sqlite3.Connection,
    threshold: float = DEFAULT_THRESHOLD,
) -> int:
    poly_rows = conn.execute("SELECT id, question, end_date FROM poly_markets").fetchall()
    mani_rows = conn.execute(
        "SELECT id, question, close_time FROM manifold_markets"
    ).fetchall()

    log.info("Matching %d poly ↔ %d manifold questions (threshold=%.2f)",
             len(poly_rows), len(mani_rows), threshold)

    added = _run_matching(
        conn, "manifold", threshold,
        poly_rows, mani_rows,
        [r["question"] for r in mani_rows],
        [r["close_time"] for r in mani_rows],
    )
    log.info("Manifold: %d new pairs", added)
    return added


# ──────────────────────────────────────────────
# CONCORDANCE VALIDATION
# ──────────────────────────────────────────────

def validate_match_quality(conn: sqlite3.Connection) -> dict:
    """
    For matched pairs where BOTH sides have known binary outcomes,
    compute the fraction where outcomes agree.

    Concordance < MIN_CONCORDANCE → matching quality insufficient for trading.
    This is the empirical check that semantic similarity actually implies
    outcome equivalence.
    """
    rows = conn.execute("""
        SELECT
            mp.similarity,
            mp.source,
            pr.outcome  AS poly_outcome,
            mq.resolution AS meta_resolution
        FROM matched_pairs mp
        JOIN poly_resolutions pr ON pr.market_id = mp.poly_id
        JOIN metaculus_questions mq ON mq.id = CAST(mp.source_id AS INTEGER)
        WHERE mp.source = 'metaculus'
          AND mq.resolution IS NOT NULL
          AND pr.outcome IN ('YES', 'NO')
    """).fetchall()

    if not rows:
        log.warning("No verifiable matched pairs (both resolved) — cannot compute concordance")
        return {"n": 0, "concordance": None, "valid": False, "reason": "no_resolved_pairs"}

    concordant = 0
    for r in rows:
        poly_yes = (r["poly_outcome"] == "YES")
        meta_yes = (float(r["meta_resolution"]) == 1.0)
        if poly_yes == meta_yes:
            concordant += 1

    n = len(rows)
    concordance = concordant / n
    valid = (n >= MIN_CONCORDANCE_N) and (concordance >= MIN_CONCORDANCE)

    log.info("Match quality: concordance=%.2f (%d/%d pairs), valid=%s",
             concordance, concordant, n, valid)

    reason = "ok"
    if n < MIN_CONCORDANCE_N:
        reason = f"insufficient_pairs (need {MIN_CONCORDANCE_N}, have {n})"
    elif concordance < MIN_CONCORDANCE:
        reason = f"concordance_too_low ({concordance:.2f} < {MIN_CONCORDANCE})"

    return {
        "n": n,
        "concordant": concordant,
        "concordance": round(concordance, 4),
        "valid": valid,
        "reason": reason,
    }


# ──────────────────────────────────────────────
# DYNAMIC THRESHOLD SELECTION
# ──────────────────────────────────────────────

def find_optimal_threshold(conn: sqlite3.Connection) -> dict:
    """
    Test thresholds [0.75, 0.80, 0.85, 0.90] and pick the LOWEST that achieves
    concordance ≥ MIN_CONCORDANCE with N ≥ MIN_CONCORDANCE_N resolved pairs.

    Returns the selected threshold and per-threshold diagnostics.
    """
    thresholds = [0.75, 0.80, 0.85, 0.90]
    results = []
    selected = None

    for t in thresholds:
        # Clear existing pairs and re-run at this threshold
        conn.execute("DELETE FROM matched_pairs")
        conn.commit()

        match_polymarket_to_metaculus(conn, threshold=t)
        match_polymarket_to_manifold(conn, threshold=t)

        n_pairs = conn.execute("SELECT COUNT(*) FROM matched_pairs").fetchone()[0]
        quality = validate_match_quality(conn)

        result = {
            "threshold": t,
            "n_pairs": n_pairs,
            "n_verifiable": quality["n"],
            "concordance": quality["concordance"],
            "valid": quality["valid"],
        }
        results.append(result)
        log.info("Threshold %.2f: %d pairs, concordance=%s, valid=%s",
                 t, n_pairs, quality["concordance"], quality["valid"])

        if quality["valid"] and selected is None:
            selected = t

    if selected is None:
        # No threshold achieved concordance — use the highest one and warn
        selected = 0.90
        log.warning(
            "No threshold achieved %.0f%% concordance with N≥%d. "
            "Using %.2f but system confidence is LOW.",
            MIN_CONCORDANCE * 100, MIN_CONCORDANCE_N, selected,
        )

    # Re-run final matching at selected threshold
    conn.execute("DELETE FROM matched_pairs")
    conn.commit()
    match_polymarket_to_metaculus(conn, threshold=selected)
    match_polymarket_to_manifold(conn, threshold=selected)

    return {"selected_threshold": selected, "by_threshold": results}


# ──────────────────────────────────────────────
# LOOKAHEAD-SAFE CONSENSUS LOOKUP
# ──────────────────────────────────────────────

def get_consensus_for_market(
    conn: sqlite3.Connection,
    poly_id: str,
    as_of: str,             # earliest price snapshot timestamp for this market
) -> Optional[dict]:
    """
    Return the best available consensus probability that was known BEFORE as_of.

    Priority: Metaculus > Manifold.
    Returns None if no pre-as_of snapshot exists — caller must skip this signal.
    """
    from data_collector import get_metaculus_prob_at, get_manifold_prob_at

    # Metaculus first
    row = conn.execute("""
        SELECT mp.similarity, mp.source_id, mq.num_forecasters
        FROM matched_pairs mp
        JOIN metaculus_questions mq ON mq.id = CAST(mp.source_id AS INTEGER)
        WHERE mp.poly_id = ? AND mp.source = 'metaculus'
        ORDER BY mq.num_forecasters DESC, mp.similarity DESC
        LIMIT 1
    """, (poly_id,)).fetchone()

    if row:
        qid = int(row["source_id"])
        prob = get_metaculus_prob_at(conn, qid, as_of)
        if prob is not None:
            return {
                "source": "metaculus",
                "probability": prob,
                "num_forecasters": int(row["num_forecasters"] or 0),
                "similarity": float(row["similarity"]),
            }

    # Manifold fallback
    row = conn.execute("""
        SELECT mp.similarity, mp.source_id
        FROM matched_pairs mp
        WHERE mp.poly_id = ? AND mp.source = 'manifold'
        ORDER BY mp.similarity DESC
        LIMIT 1
    """, (poly_id,)).fetchone()

    if row:
        prob = get_manifold_prob_at(conn, row["source_id"], as_of)
        if prob is not None:
            return {
                "source": "manifold",
                "probability": prob,
                "num_forecasters": None,
                "similarity": float(row["similarity"]),
            }

    return None
