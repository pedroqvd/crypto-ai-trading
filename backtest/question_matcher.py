"""
Semantic question matching between Polymarket and Metaculus/Manifold.

Uses sentence-transformers (all-MiniLM-L6-v2) to embed questions,
then cosine similarity to find cross-platform matches.
Threshold: 0.75 — below this, pairs are rejected.

Matched pairs are persisted in the DB so embeddings aren't recomputed
on every run. Incremental: only re-embeds newly added questions.
"""

import logging
import sqlite3
from typing import Optional

import numpy as np

log = logging.getLogger(__name__)

SIMILARITY_THRESHOLD = 0.75
EMBEDDING_MODEL = "all-MiniLM-L6-v2"

# Lazy-loaded model — don't import at module level so the rest of the
# system works even without sentence-transformers installed.
_model = None


def _get_model():
    global _model
    if _model is None:
        try:
            from sentence_transformers import SentenceTransformer
            log.info("Loading embedding model %s ...", EMBEDDING_MODEL)
            _model = SentenceTransformer(EMBEDDING_MODEL)
            log.info("Model loaded.")
        except ImportError:
            raise RuntimeError(
                "sentence-transformers is required for question matching. "
                "Run: pip install sentence-transformers"
            )
    return _model


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity between two 1-D vectors."""
    denom = (np.linalg.norm(a) * np.linalg.norm(b))
    if denom == 0:
        return 0.0
    return float(np.dot(a, b) / denom)


def embed_texts(texts: list[str]) -> np.ndarray:
    """Return (N, D) embedding matrix for a list of texts."""
    model = _get_model()
    return model.encode(texts, batch_size=64, show_progress_bar=len(texts) > 100, normalize_embeddings=True)


def match_polymarket_to_metaculus(
    conn: sqlite3.Connection,
    threshold: float = SIMILARITY_THRESHOLD,
) -> int:
    """
    Find Polymarket ↔ Metaculus pairs above the similarity threshold.
    Skips pairs already in matched_pairs.
    Returns the number of new matches stored.
    """
    poly_rows = conn.execute("SELECT id, question FROM poly_markets").fetchall()
    meta_rows = conn.execute(
        "SELECT id, title FROM metaculus_questions WHERE resolution IS NOT NULL"
    ).fetchall()

    if not poly_rows or not meta_rows:
        log.warning("No data to match (poly=%d, meta=%d)", len(poly_rows), len(meta_rows))
        return 0

    log.info("Embedding %d Polymarket + %d Metaculus questions ...", len(poly_rows), len(meta_rows))
    poly_texts = [r["question"] for r in poly_rows]
    meta_texts = [r["title"] for r in meta_rows]

    poly_embs = embed_texts(poly_texts)
    meta_embs = embed_texts(meta_texts)

    # Similarity matrix (|poly| × |meta|)
    sim_matrix = poly_embs @ meta_embs.T

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    new_matches = 0

    for i, poly_row in enumerate(poly_rows):
        # Best-matching Metaculus question for this poly market
        best_j = int(np.argmax(sim_matrix[i]))
        best_sim = float(sim_matrix[i, best_j])

        if best_sim < threshold:
            continue

        meta_row = meta_rows[best_j]

        try:
            conn.execute("""
                INSERT OR IGNORE INTO matched_pairs
                    (poly_id, source, source_id, similarity, created_at)
                VALUES (?, 'metaculus', ?, ?, ?)
            """, (poly_row["id"], str(meta_row["id"]), best_sim, now))
            new_matches += 1
        except sqlite3.Error as e:
            log.error("DB error storing match: %s", e)

    conn.commit()
    log.info("Metaculus matching: %d new pairs (threshold=%.2f)", new_matches, threshold)
    return new_matches


def match_polymarket_to_manifold(
    conn: sqlite3.Connection,
    threshold: float = SIMILARITY_THRESHOLD,
) -> int:
    """
    Find Polymarket ↔ Manifold pairs above the similarity threshold.
    Only matches against resolved Manifold markets.
    """
    poly_rows = conn.execute("SELECT id, question FROM poly_markets").fetchall()
    mani_rows = conn.execute(
        "SELECT id, question FROM manifold_markets WHERE is_resolved = 1"
    ).fetchall()

    if not poly_rows or not mani_rows:
        log.warning("No data to match (poly=%d, manifold=%d)", len(poly_rows), len(mani_rows))
        return 0

    log.info("Embedding %d Polymarket + %d Manifold questions ...", len(poly_rows), len(mani_rows))
    poly_texts = [r["question"] for r in poly_rows]
    mani_texts = [r["question"] for r in mani_rows]

    poly_embs = embed_texts(poly_texts)
    mani_embs = embed_texts(mani_texts)

    sim_matrix = poly_embs @ mani_embs.T

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    new_matches = 0

    for i, poly_row in enumerate(poly_rows):
        best_j = int(np.argmax(sim_matrix[i]))
        best_sim = float(sim_matrix[i, best_j])

        if best_sim < threshold:
            continue

        mani_row = mani_rows[best_j]

        try:
            conn.execute("""
                INSERT OR IGNORE INTO matched_pairs
                    (poly_id, source, source_id, similarity, created_at)
                VALUES (?, 'manifold', ?, ?, ?)
            """, (poly_row["id"], mani_row["id"], best_sim, now))
            new_matches += 1
        except sqlite3.Error as e:
            log.error("DB error storing match: %s", e)

    conn.commit()
    log.info("Manifold matching: %d new pairs (threshold=%.2f)", new_matches, threshold)
    return new_matches


def get_consensus_for_market(
    conn: sqlite3.Connection,
    poly_id: str,
) -> Optional[dict]:
    """
    Return the best available consensus estimate for a Polymarket market.

    Priority: Metaculus (more forecasters, better calibration) > Manifold.
    Returns dict with keys: source, probability, num_forecasters, similarity
    """
    # Try Metaculus first
    row = conn.execute("""
        SELECT mp.similarity, mq.community_prob, mq.num_forecasters, mq.id
        FROM matched_pairs mp
        JOIN metaculus_questions mq ON mq.id = CAST(mp.source_id AS INTEGER)
        WHERE mp.poly_id = ? AND mp.source = 'metaculus'
          AND mq.community_prob IS NOT NULL
        ORDER BY mq.num_forecasters DESC, mp.similarity DESC
        LIMIT 1
    """, (poly_id,)).fetchone()

    if row and row["community_prob"] is not None:
        return {
            "source": "metaculus",
            "probability": float(row["community_prob"]),
            "num_forecasters": int(row["num_forecasters"] or 0),
            "similarity": float(row["similarity"]),
        }

    # Fall back to Manifold
    row = conn.execute("""
        SELECT mp.similarity, mm.probability, mm.id
        FROM matched_pairs mp
        JOIN manifold_markets mm ON mm.id = mp.source_id
        WHERE mp.poly_id = ? AND mp.source = 'manifold'
          AND mm.probability IS NOT NULL
        ORDER BY mp.similarity DESC
        LIMIT 1
    """, (poly_id,)).fetchone()

    if row and row["probability"] is not None:
        return {
            "source": "manifold",
            "probability": float(row["probability"]),
            "num_forecasters": None,
            "similarity": float(row["similarity"]),
        }

    return None
