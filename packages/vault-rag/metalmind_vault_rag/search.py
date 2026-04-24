"""Pure search functions — shared by the MCP server, the HTTP server, and anything else that wants them. No MCP/HTTP coupling here."""
import re
from pathlib import Path

from .core import COLLECTION, VAULT, embed, files_to_index, fts_conn, qdrant
from .rerank import overfetch_k, rerank_hits

# RRF k=60 is the standard from Cormack/Clarke/Büttcher (SIGIR 2009); higher
# k flattens the fusion (all ranks contribute more equally), lower k amplifies
# top positions. 60 is well-tested across IR workloads — no reason to deviate
# without bench-driven evidence.
RRF_K = 60
SEARCH_MODES = ("hybrid", "semantic-only", "keyword-only")

WIKILINK = re.compile(r"\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]")


def parse_links(text: str) -> list[str]:
    return list({m.group(1).strip() for m in WIKILINK.finditer(text)})


def file_index() -> dict[str, Path]:
    return {p.stem: p for p in files_to_index()}


_BACKLINK_CACHE: dict[str, list[str]] | None = None
_BACKLINK_KEY: tuple[int, float] | None = None


def _backlink_index() -> dict[str, list[str]]:
    """Process-lifetime backlink map: stem → [stems that link to it].
    Rebuilt when file count or max mtime changes; O(1) on cache hit.
    The watcher process reuses this across every recall; MCP one-shots pay
    the same one-time walk cost as before."""
    global _BACKLINK_CACHE, _BACKLINK_KEY
    index = file_index()
    max_mtime = 0.0
    for p in index.values():
        try:
            m = p.stat().st_mtime
        except OSError:
            continue
        if m > max_mtime:
            max_mtime = m
    key = (len(index), max_mtime)
    if _BACKLINK_CACHE is not None and _BACKLINK_KEY == key:
        return _BACKLINK_CACHE

    backlinks: dict[str, list[str]] = {}
    for stem, p in index.items():
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for linked_stem in parse_links(text):
            if linked_stem in index and linked_stem != stem:
                backlinks.setdefault(linked_stem, []).append(stem)

    _BACKLINK_CACHE = backlinks
    _BACKLINK_KEY = key
    return backlinks


def _semantic_search(query: str, k: int) -> list[dict]:
    """Qdrant cosine-similarity top-k. Returns {file, heading, score, text}."""
    vec = embed([query])[0]
    c = qdrant()
    results = c.query_points(collection_name=COLLECTION, query=vec, limit=k).points
    return [
        {
            "file": r.payload["file"],
            "heading": r.payload["heading"],
            "score": round(r.score, 4),
            "text": r.payload["text"],
        }
        for r in results
    ]


# FTS5 has its own query syntax (quoted phrases, AND/OR/NEAR, prefix *).
# Raw user input like "what OR when" becomes an FTS5 operator mess.
# Tokenize defensively: lowercase, split on non-word chars, quote each token,
# join with OR. BM25's `rank` column naturally ranks docs that match more
# tokens higher, so OR gives recall without hurting precision ordering.
# (An AND conjunction over a paraphrased query like "what is Project Wingspan"
# excludes every doc that doesn't also contain "what" and "is" — empty result
# even when the topical doc exists. OR avoids that failure mode.)
_FTS_WORD = re.compile(r"[A-Za-z0-9]+")


def _fts_query_expr(query: str) -> str | None:
    tokens = _FTS_WORD.findall(query.lower())
    if not tokens:
        return None
    # Prefix-match each token (`postgres*`) so stems match their roots even
    # when porter tokenizer diverges between query and doc. OR across tokens
    # for recall; rank column handles precision.
    return " OR ".join(f'"{t}"*' for t in tokens)


def _keyword_search(query: str, k: int) -> list[dict]:
    """BM25 over the FTS5 index. Returns {file, heading, score, text} —
    `score` is BM25 (more-negative = better in SQLite; we flip sign so
    higher-is-better matches semantic's convention)."""
    expr = _fts_query_expr(query)
    if not expr:
        return []
    with fts_conn() as conn:
        try:
            cur = conn.execute(
                "SELECT file, heading, chunk_idx, text, rank FROM chunks "
                "WHERE chunks MATCH ? ORDER BY rank LIMIT ?",
                (expr, k),
            )
            rows = cur.fetchall()
        except Exception:
            # Malformed query or FTS5 syntax error — return empty, let semantic
            # carry the search. Better than 500-ing a legitimate recall.
            return []
    return [
        {
            "file": row[0],
            "heading": row[1],
            "score": round(-float(row[4]), 4),  # flip so higher = better
            "text": row[3],
        }
        for row in rows
    ]


def _rrf_merge(hit_lists: list[list[dict]], k: int) -> list[dict]:
    """Reciprocal Rank Fusion. Each hit list contributes 1/(RRF_K + rank) to
    each unique (file, heading) key. De-dup keeps the first-seen text/score.
    Ranks, not scores — no calibration between BM25 and cosine."""
    merged: dict[tuple[str, str], dict] = {}
    for hits in hit_lists:
        for rank, h in enumerate(hits, 1):
            key = (h["file"], h["heading"])
            if key not in merged:
                merged[key] = {**h, "rrf": 0.0}
            merged[key]["rrf"] += 1.0 / (RRF_K + rank)
    ordered = sorted(merged.values(), key=lambda r: r["rrf"], reverse=True)
    # Rewrite score to RRF so downstream code sees a consistent field; keep
    # the original embedder/BM25 score under `prev_score` for debugging.
    out = []
    for h in ordered[:k]:
        copy = dict(h)
        copy["prev_score"] = copy.get("score")
        copy["score"] = round(h["rrf"], 4)
        copy.pop("rrf", None)
        out.append(copy)
    return out


def search_vault(
    query: str,
    k: int = 5,
    rerank: bool = False,
    mode: str = "hybrid",
) -> list[dict]:
    """Search the vault. Returns list of {file, heading, score, text}.

    `mode` selects the retriever strategy:
      - `hybrid` (default): run semantic + keyword, merge via RRF.
      - `semantic-only`: Qdrant cosine similarity only (legacy behavior).
      - `keyword-only`: FTS5 BM25 only.

    `rerank=True` pulls a larger top-N from the chosen strategy, re-scores
    with a cross-encoder (see rerank.py), and returns the top-k from the new
    ordering. Opt-in — first call triggers a ~500 MB model download.
    """
    k = max(1, min(k, 20))
    fetch = overfetch_k(k) if rerank else k

    if mode not in SEARCH_MODES:
        mode = "hybrid"

    if mode == "semantic-only":
        hits = _semantic_search(query, fetch)
    elif mode == "keyword-only":
        hits = _keyword_search(query, fetch)
    else:
        # Hybrid: overfetch both legs so RRF has enough candidates. Using
        # `fetch` (already overfetched if rerank) on each leg is intentional
        # — doubles the candidate pool the cross-encoder rescores.
        sem = _semantic_search(query, fetch)
        kw = _keyword_search(query, fetch)
        hits = _rrf_merge([sem, kw], k=fetch)

    if rerank:
        return rerank_hits(query, hits, k)
    return hits[:k]


def related_notes(file: str) -> dict:
    """Return forward links and backlinks for a note."""
    index = file_index()
    target = Path(file)
    if target.suffix == ".md" and not target.is_absolute():
        path = VAULT / target
    else:
        stem = target.stem or str(target)
        if stem not in index:
            return {"error": f"note not found: {file}", "forward": [], "backlinks": []}
        path = index[stem]

    if not path.exists():
        return {"error": f"note not found: {file}", "forward": [], "backlinks": []}

    text = path.read_text(encoding="utf-8", errors="ignore")
    forward_stems = parse_links(text)
    forward = [
        {"stem": s, "path": str(index[s].relative_to(VAULT))}
        for s in forward_stems
        if s in index
    ]
    missing_forward = [s for s in forward_stems if s not in index]

    target_stem = path.stem
    backlink_map = _backlink_index()
    backlinks = [
        {"stem": s, "path": str(index[s].relative_to(VAULT))}
        for s in backlink_map.get(target_stem, [])
        if s in index
    ]

    return {
        "file": str(path.relative_to(VAULT)),
        "forward": forward,
        "backlinks": backlinks,
        "missing_forward": missing_forward,
    }


def expand_search(query: str, k: int = 5) -> dict:
    """search_vault + wikilinks discovered in source files."""
    k = max(1, min(k, 10))
    hits = search_vault(query, k=k)
    index = file_index()
    expansions: list[dict] = []
    seen: set[str] = set()

    for h in hits:
        f = h["file"]
        if f in seen:
            continue
        seen.add(f)
        path = VAULT / f
        if not path.exists():
            continue
        links = parse_links(path.read_text(encoding="utf-8", errors="ignore"))
        resolved = [
            {"stem": s, "path": str(index[s].relative_to(VAULT))}
            for s in links
            if s in index
        ]
        if resolved:
            expansions.append({"from": f, "links": resolved})

    return {"hits": hits, "expansions": expansions}
