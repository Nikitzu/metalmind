"""Pure search functions - shared by the MCP server, the HTTP server, and anything else that wants them. No MCP/HTTP coupling here."""
import os
import re
from pathlib import Path

from .calibration import (
    best_semantic_score,
    cached_bands,
    classify,
    confidence_enabled,
    embedder_id,
    sidecar_path,
)
from .core import (
    COLLECTION,
    VAULT,
    embed_query,
    embedding_backend,
    files_to_index,
    fts_conn,
    vector_store,
)
from .rerank import overfetch_k, rerank_hits

# RRF k=60 is the standard from Cormack/Clarke/Büttcher (SIGIR 2009); higher
# k flattens the fusion (all ranks contribute more equally), lower k amplifies
# top positions. 60 is well-tested across IR workloads - no reason to deviate
# without bench-driven evidence.
RRF_K = 60
SEARCH_MODES = ("hybrid", "semantic-only", "keyword-only")

# Documents that rank #1 in any source list get a small additive boost; #2-3
# get a smaller one. Pure RRF dilutes top hits when expanded queries don't
# agree with the original; this preserves the "everyone agrees" signal.
TOP_RANK_BONUS = {1: 0.05, 2: 0.02, 3: 0.02}

# Per-backend list weight inside fusion. Keyword (BM25) is more decisive
# than semantic on short factual queries with literal terms, which is the
# dominant query shape in vault recall. Without weighting, a wrong-but-
# plausible semantic #1 ties with the correct keyword #1 (each gets the
# same single-list bonus) and the tie-break is non-deterministic dict
# order. Tunable via env in case the workload skews semantic.
KEYWORD_WEIGHT = float(os.environ.get("METALMIND_RRF_KEYWORD_WEIGHT", "1.5"))
SEMANTIC_WEIGHT = float(os.environ.get("METALMIND_RRF_SEMANTIC_WEIGHT", "1.0"))

KEYWORD_WEIGHT_EXACT = float(
    os.environ.get("METALMIND_RRF_KEYWORD_WEIGHT_EXACT", "2.5")
)
ADAPTIVE_FUSION = os.environ.get("METALMIND_RRF_ADAPTIVE", "1") != "0"

_EXACT_SIGNALS = re.compile(
    "|".join(
        [
            r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
            r"\b\d{4,}\b",
            r"\b[A-Z]{2,}-\d+\b",
            r"\b[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]*[a-zA-Z][a-zA-Z0-9-]*)+\b",
            r"\S+@\S+\.\S+",
        ]
    ),
    re.IGNORECASE,
)


def _exact_signal(query: str) -> bool:
    """True when the query carries an exact-match token: UUID, numeric ID
    (4+ digits), ticket ID (RED-991), hostname/filename, or email."""
    return bool(_EXACT_SIGNALS.search(query))


def _fusion_weights(query: str) -> list[float]:
    """Per-list RRF weights as [semantic, keyword] for this query.

    Adaptive fusion (Dynamic Alpha Tuning, Hsu et al. 2025): queries
    carrying exact-match tokens are answered better by BM25 than by
    embeddings, which blur literal identifiers into their semantic
    neighbourhood - so the keyword leg gets KEYWORD_WEIGHT_EXACT instead
    of KEYWORD_WEIGHT. Disable with METALMIND_RRF_ADAPTIVE=0 for A/B
    benching against the fixed weights."""
    if ADAPTIVE_FUSION and _exact_signal(query):
        return [SEMANTIC_WEIGHT, KEYWORD_WEIGHT_EXACT]
    return [SEMANTIC_WEIGHT, KEYWORD_WEIGHT]

FOLDER_PENALTIES = {"Archive": 0.4, "Inbox": 0.7}

def _env_float(name: str, default: float, lo: float, hi: float) -> float:
    """Clamped env parse: a typo'd or hostile value ('abc', 'nan', 'inf')
    must not crash every consumer of this module at import time, or - for
    a penalty - invert the ranking it exists to enforce."""
    try:
        v = float(os.environ.get(name, default))
    except ValueError:
        return default
    if v != v:
        return default
    return min(max(v, lo), hi)


SUPERSEDE_PENALTY = _env_float("METALMIND_SUPERSEDE_PENALTY", 0.4, 0.0, 1.0)

_FRONTMATTER_RE = re.compile(r"\A---\n(.*?)\n---", re.DOTALL)
_SUPERSEDE_CACHE: dict[str, str] | None = None
_SUPERSEDE_KEY: tuple[int, float] | None = None


def _supersede_index() -> dict[str, str]:
    """Relative path → superseded_by stem for every superseded note (empty
    string when no successor is named). A note counts as superseded when it
    carries a `superseded_by:` field OR `status: superseded` - keying on the
    pointer field alone would be enough for scribe-written notes, but
    archiving rewrites `status:` to `archived` while leaving `superseded_by`
    intact, so either signal must qualify or `gold` on a superseded note
    silently un-supersedes it. Frontmatter is the source of truth - no index
    schema involvement, so a supersede takes effect on the next query
    without a reindex. Same process-lifetime, mtime-keyed cache discipline
    as `_backlink_index`, reading a bounded head per file and falling back to
    the whole file only when the closing fence is not in it."""
    global _SUPERSEDE_CACHE, _SUPERSEDE_KEY
    files = list(files_to_index())
    max_mtime = 0.0
    for p in files:
        try:
            m = p.stat().st_mtime
        except OSError:
            continue
        if m > max_mtime:
            max_mtime = m
    key = (len(files), max_mtime)
    if _SUPERSEDE_CACHE is not None and _SUPERSEDE_KEY == key:
        return _SUPERSEDE_CACHE

    smap: dict[str, str] = {}
    for p in files:
        try:
            with p.open("r", encoding="utf-8", errors="ignore") as fh:
                text = fh.read(8192)
                fm = _FRONTMATTER_RE.match(text)
                if text.startswith("---\n") and not fm:
                    text += fh.read()
                    fm = _FRONTMATTER_RE.match(text)
        except OSError:
            continue
        if not fm:
            continue
        block = fm.group(1)
        status = re.search(r"^status:[ \t]*(\S.*)$", block, re.MULTILINE)
        by = re.search(r"^superseded_by:[ \t]*(\S.*)$", block, re.MULTILINE)
        if not by and not (status and status.group(1).strip() == "superseded"):
            continue
        smap[str(p.relative_to(VAULT))] = by.group(1).strip().strip("'\"") if by else ""

    _SUPERSEDE_CACHE = smap
    _SUPERSEDE_KEY = key
    return smap


def _hit_penalties(hits: list[dict], smap: dict[str, str]) -> dict[str, float]:
    """Per-file multiplier map (folder x supersede) for the rerank path.
    The cross-encoder replaces the fused score, which would otherwise
    discard the fusion-time penalties and let a superseded note outrank
    its successor on pure text similarity - so `rerank_hits` re-applies
    these to the rescored values. Files at 1.0 are omitted."""
    out: dict[str, float] = {}
    for h in hits:
        mult = _folder_multiplier(h["file"])
        if h["file"] in smap:
            mult *= SUPERSEDE_PENALTY
        if mult != 1.0:
            out[h["file"]] = mult
    return out


def _annotate_superseded(hits: list[dict], smap: dict[str, str]) -> None:
    """Attach `superseded_by` to hits from superseded notes, in place.
    A dangling stem is passed through unmodified - resolution is the
    reader's (or a future doctor check's) problem, not recall's."""
    for h in hits:
        by = smap.get(h["file"])
        if by:
            h["superseded_by"] = by


def _enforce_supersede_order(hits: list[dict], smap: dict[str, str]) -> list[dict]:
    """Reorder so no note outranks the successor it names, scores untouched.

    The 0.4x penalty is a multiplier competing against score magnitude. That
    holds while scores come from RRF and stops holding when they come from a
    cross-encoder, which is confident and rewards exactly what a superseded note
    tends to be: the longer, more detailed, more on-topic document. Measured on
    the adversarial bench, reranking cost `competing-near-duplicates` 25 points
    of hit@1 and two of the six regressions were a superseded note winning.

    Raising the penalty until it survives that would bury superseded notes that
    are the only answer, so this is a constraint rather than a stronger knob.
    Only the pairs that violate it move; everything else keeps its order.

    A successor outside the candidate set is left alone. It cannot be promoted,
    and demoting its predecessor would remove a hit and offer nothing back.

    The pass repeats until stable, bounded by the hit count because two notes
    that supersede each other are writable by hand and would otherwise loop.
    """
    if not smap or len(hits) < 2:
        return hits

    out = list(hits)
    for _ in range(len(out)):
        moved = False
        for i, h in enumerate(out):
            successor = smap.get(h["file"])
            if not successor:
                continue
            j = next((n for n, x in enumerate(out) if Path(x["file"]).stem == successor), None)
            if j is not None and j > i:
                out[i], out[j] = out[j], out[i]
                moved = True
        if not moved:
            break
    return out


def _folder_multiplier(file: str) -> float:
    """Score multiplier for the fused RRF score, keyed on the top-level
    vault folder. Archived shipped plans and unsorted inbox clippings
    should not outrank in-flight notes of comparable relevance; a
    multiplicative penalty re-ranks them down without excluding them,
    so a decisively-matching archived note can still surface."""
    top = file.split("/", 1)[0]
    return FOLDER_PENALTIES.get(top, 1.0)


# How many candidates each backend produces before fusion. Larger overfetch
# means docs are more likely to appear in both lists, reducing single-list
# ties at the top.
# Chunks from one note compete for top-k slots individually now that identity
# includes position, where they used to collapse into a single hit. Left
# uncapped, a long note fills the list with itself and crowds out other notes.
# Measured on LongMemEval at 3000 sessions against the same index: uncapped and
# cap 3 give hit@5 66%, cap 2 gives 67%, cap 1 gives 69%, with hit@1 unmoved at
# 44% throughout. One chunk per note it is. 0 disables the cap.
MAX_CHUNKS_PER_FILE = int(os.environ.get("METALMIND_MAX_CHUNKS_PER_FILE", "1"))

CHUNK_IDENTITY = os.environ.get("METALMIND_CHUNK_IDENTITY", "1") != "0"

RRF_OVERFETCH = max(20, int(os.environ.get("METALMIND_RRF_OVERFETCH", "50")))

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
    """Cosine-similarity top-k from the active vector store. Returns
    {file, heading, score, text}. Score is similarity in [-1, 1] for
    both backends - see VectorStore protocol contract."""
    vec = embed_query([query])[0]
    hits = vector_store().query(vec, k)
    return [
        {
            "file": h.payload["file"],
            "heading": h.payload["heading"],
            "score": round(h.score, 4),
            "text": h.payload["text"],
            **(
                {"chunk_idx": h.payload["chunk_idx"]}
                if "chunk_idx" in h.payload
                else {}
            ),
        }
        for h in hits
    ]


# FTS5 has its own query syntax (quoted phrases, AND/OR/NEAR, prefix *).
# Raw user input like "what OR when" becomes an FTS5 operator mess.
# Tokenize defensively: lowercase, split on non-word chars, quote each token,
# join with OR. BM25's `rank` column naturally ranks docs that match more
# tokens higher, so OR gives recall without hurting precision ordering.
# (An AND conjunction over a paraphrased query like "what is Project Wingspan"
# excludes every doc that doesn't also contain "what" and "is" - empty result
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
    """BM25 over the FTS5 index. Returns {file, heading, score, text} -
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
            # Malformed query or FTS5 syntax error - return empty, let semantic
            # carry the search. Better than 500-ing a legitimate recall.
            return []
    return [
        {
            "file": row[0],
            "heading": row[1],
            "score": round(-float(row[4]), 4),  # flip so higher = better
            "text": row[3],
            "chunk_idx": row[2],
        }
        for row in rows
    ]


def _cap_per_file(hits: list[dict]) -> list[dict]:
    """Keep at most MAX_CHUNKS_PER_FILE hits per note, preserving order.

    Chunks of one note compete for slots individually now that identity includes
    position, so a long note otherwise fills the result set with itself. Callers
    must overfetch before capping, or a query that drops chunks returns fewer
    than k results."""
    if MAX_CHUNKS_PER_FILE <= 0:
        return hits
    per_file: dict[str, int] = {}
    kept: list[dict] = []
    for entry in hits:
        used = per_file.get(entry["file"], 0)
        if used >= MAX_CHUNKS_PER_FILE:
            continue
        per_file[entry["file"]] = used + 1
        kept.append(entry)
    return kept


def _rrf_merge(
    hit_lists: list[list[dict]],
    k: int,
    weights: list[float] | None = None,
    supersede_map: dict[str, str] | None = None,
    labels: list[str] | None = None,
) -> list[dict]:
    """Reciprocal Rank Fusion. Each hit list contributes weight/(RRF_K + rank)
    to each unique (file, heading) key. De-dup keeps the first-seen
    text/score. Ranks, not scores - no calibration between BM25 and cosine.

    Identity is (file, heading, chunk_idx). Heading alone was a proxy that held
    only while a section produced one chunk: beyond that, two different chunks
    collapsed into one hit keeping whichever list was read first.

    Position is used only when every hit carries one. FTS has always had a
    chunk_idx column while the vector payload gained it in format 2, so on an
    older index the keyword leg reports a position and the semantic leg does
    not. Keying on it there would split every hit the two retrievers agreed on,
    destroying the agreement signal fusion exists to capture. Falling back to
    heading is what lets a stale index keep answering as it always did.

    `METALMIND_CHUNK_IDENTITY=0` forces the heading key even when every hit
    carries a position, reproducing pre-format-2 identity. Fusion is the only
    thing it changes, so an existing index can answer under either setting and
    the two are directly comparable without a rebuild.

    `weights` (optional) is a per-list multiplier matching `hit_lists` order.
    Defaults to 1.0 per list. Used to bias fusion toward backends that are
    more decisive at hit@1 for the workload (e.g. BM25 for short factual
    queries).

    `labels` (optional) names each list, matching `hit_lists` order. When
    given, every merged hit carries `<label>_score` holding that list's raw
    score for the document, or None when the list did not return it. Fusion
    discards score magnitude by design, so these fields are the only way a
    caller can tell a confident match from the least-bad of a bad set. They
    do not affect ordering.

    Adds a top-rank bonus once per document, keyed on the best (lowest) rank
    the doc achieved across all source lists. Documents that rank #1 in any
    list get +0.05; ranks #2-3 get +0.02. Stops pure RRF from diluting hits
    that one retriever was certain about."""
    if weights is None:
        weights = [1.0] * len(hit_lists)
    if labels is None:
        labels = [""] * len(hit_lists)
    use_position = CHUNK_IDENTITY and all(
        "chunk_idx" in h for hits in hit_lists for h in hits
    )
    score_fields = {f"{label}_score": None for label in labels if label}
    merged: dict[tuple[str, str], dict] = {}
    for hits, weight, label in zip(hit_lists, weights, labels):
        for rank, h in enumerate(hits, 1):
            key = (
                (h["file"], h["heading"], h["chunk_idx"])
                if use_position
                else (h["file"], h["heading"])
            )
            if key not in merged:
                merged[key] = {**h, **score_fields, "rrf": 0.0, "top_rank": rank}
            else:
                if rank < merged[key]["top_rank"]:
                    merged[key]["top_rank"] = rank
            if label and merged[key][f"{label}_score"] is None:
                merged[key][f"{label}_score"] = h.get("score")
            merged[key]["rrf"] += weight / (RRF_K + rank)
    for entry in merged.values():
        bonus = TOP_RANK_BONUS.get(entry["top_rank"])
        if bonus:
            entry["rrf"] += bonus
        mult = _folder_multiplier(entry["file"])
        if supersede_map is not None and entry["file"] in supersede_map:
            mult *= SUPERSEDE_PENALTY
        entry["rrf"] *= mult
    ordered = _cap_per_file(sorted(merged.values(), key=lambda r: r["rrf"], reverse=True))
    # Rewrite score to RRF so downstream code sees a consistent field; keep
    # the original embedder/BM25 score under `prev_score` for debugging.
    out = []
    for h in ordered[:k]:
        copy = dict(h)
        copy["prev_score"] = copy.get("score")
        copy["score"] = round(h["rrf"], 4)
        copy.pop("rrf", None)
        copy.pop("top_rank", None)
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
    ordering. Opt-in - first call triggers a ~500 MB model download.
    """
    k = max(1, min(k, 20))
    fetch = overfetch_k(k) if rerank else k

    if mode not in SEARCH_MODES:
        mode = "hybrid"

    smap = _supersede_index()
    if mode == "semantic-only":
        hits = _cap_per_file(_semantic_search(query, max(fetch, RRF_OVERFETCH)))[:fetch]
    elif mode == "keyword-only":
        hits = _cap_per_file(_keyword_search(query, max(fetch, RRF_OVERFETCH)))[:fetch]
    else:
        # Hybrid: overfetch both legs deeply so RRF has enough cross-coverage
        # to break ties at the top. RRF_OVERFETCH (default 50) is independent
        # of `fetch` - even a non-rerank k=5 query pulls 50 candidates per
        # backend before fusion, then truncates to `fetch` after merging.
        leg_k = max(fetch, RRF_OVERFETCH)
        sem = _semantic_search(query, leg_k)
        kw = _keyword_search(query, leg_k)
        hits = _rrf_merge(
            [sem, kw],
            k=fetch,
            weights=_fusion_weights(query),
            supersede_map=smap,
            labels=["sem", "kw"],
        )

    _annotate_superseded(hits, smap)

    if rerank:
        hits = rerank_hits(query, hits, len(hits), penalties=_hit_penalties(hits, smap))
    return _enforce_supersede_order(hits, smap)[:k]


def attach_neighbors(hits: list[dict]) -> None:
    """Attach `neighbor_text` = {prev?, next?} to each hit in place.

    A hit carrying chunk_idx knows its own position. Otherwise it came from a
    format 1 index and the position is recovered by exact (file, text) match, as
    it always was. That fallback cannot survive overlapping chunks: two chunks
    sharing text would both match and `LIMIT 1` would pick one arbitrarily,
    which is a second reason chunk_idx belongs in the payload.

    A hit whose source file changed since indexing simply gets no neighbors.
    """
    with fts_conn() as conn:
        for h in hits:
            file = h.get("file")
            text = h.get("text")
            if not isinstance(file, str) or not isinstance(text, str):
                continue
            known = h.get("chunk_idx")
            if isinstance(known, int):
                idx = known
            else:
                row = conn.execute(
                    "SELECT chunk_idx FROM chunks WHERE file = ? AND text = ? LIMIT 1",
                    (file, text),
                ).fetchone()
                if row is None:
                    continue
                idx = int(row[0])
            neighbors: dict[str, str] = {}
            for label, delta in (("prev", -1), ("next", 1)):
                r = conn.execute(
                    "SELECT text FROM chunks WHERE file = ? AND chunk_idx = ?",
                    (file, idx + delta),
                ).fetchone()
                if r is not None:
                    neighbors[label] = r[0]
            if neighbors:
                h["neighbor_text"] = neighbors


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


def result_confidence(hits: list[dict]) -> str | None:
    """How much of this vault's own answerable distribution this result set
    reaches, or None when the vault has no bands to compare against.

    Advisory only. Nothing here reorders, filters or removes a hit. On an
    uncalibrated vault the caller sees no field at all rather than a warning,
    so behaviour is unchanged from before confidence existed."""
    if not confidence_enabled():
        return None
    backend = embedding_backend()
    bands = cached_bands(
        sidecar_path(COLLECTION),
        embedder_id(backend.model_id(), backend.dimension()),
    )
    if bands is None:
        return None
    return classify(best_semantic_score(hits), bands)
