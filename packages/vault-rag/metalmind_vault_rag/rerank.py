"""Cross-encoder reranker. Lazy-loaded on first use so the watcher startup
stays fast and users who never opt-in pay nothing.

Design:
- Opt-in via `rerank=True` on search_vault. Off by default.
- Model: `BAAI/bge-reranker-v2-m3` (multi-lingual, ~500 MB). First call
  downloads via HuggingFace; subsequent calls are sub-100 ms on CPU for
  small batches.
- Overfetch strategy: caller asks for k, we ask Qdrant for max(k*4, 20),
  re-score, return top k from the re-sorted list. Tune via env
  `METALMIND_RERANK_OVERFETCH` if needed.
- Failure mode: if the model can't load (no network, no disk, no
  FlagEmbedding installed), log once and return the embedder's ordering.
  Rerank must never be the reason recall fails.
"""

from __future__ import annotations

import logging
import os
import sys
from typing import Sequence

_log = logging.getLogger(__name__)

_RERANKER = None  # lazy — loaded on first call
_RERANKER_FAILED = False  # sticky after load failure, avoids retry spam

DEFAULT_MODEL = os.environ.get("METALMIND_RERANKER_MODEL", "BAAI/bge-reranker-v2-m3")
DEFAULT_OVERFETCH = max(1, int(os.environ.get("METALMIND_RERANK_OVERFETCH", "4")))


def _load_reranker():
    """Import + construct the reranker once, memoized. Returns None on failure."""
    global _RERANKER, _RERANKER_FAILED
    if _RERANKER is not None:
        return _RERANKER
    if _RERANKER_FAILED:
        return None
    try:
        # FlagEmbedding is a sibling project of BGE — stable cross-encoder
        # wrapper. Import lazily so users who don't opt into rerank don't
        # pay the import cost (pulls torch).
        from FlagEmbedding import FlagReranker  # type: ignore
    except ImportError:
        _RERANKER_FAILED = True
        print(
            "metalmind: --rerank requested but 'FlagEmbedding' is not installed. "
            "Install with `uv tool install metalmind-vault-rag[rerank]` or drop the flag.",
            file=sys.stderr,
        )
        return None
    flavor = (os.environ.get("METALMIND_FLAVOR") or "classic").lower()
    themed = flavor == "scadrial"
    lead = (
        "metalmind: lighting the duralumin — reranker warming up"
        if themed
        else "metalmind: reranker warming up"
    )
    print(
        f"{lead} (first call downloads ~500 MB for '{DEFAULT_MODEL}')…",
        file=sys.stderr,
        flush=True,
    )
    try:
        _RERANKER = FlagReranker(DEFAULT_MODEL, use_fp16=True)
        return _RERANKER
    except Exception as e:  # pragma: no cover — covers download/disk/OOM
        _RERANKER_FAILED = True
        print(
            f"metalmind: reranker model '{DEFAULT_MODEL}' failed to load ({e!r}); "
            "falling back to embedder ordering.",
            file=sys.stderr,
        )
        return None


def overfetch_k(k: int) -> int:
    """How many raw hits to pull from Qdrant when reranking is requested."""
    return max(k, k * DEFAULT_OVERFETCH, 20)


def rerank_hits(query: str, hits: Sequence[dict], k: int) -> list[dict]:
    """Re-score hits against the query with a cross-encoder, then truncate to k.

    Returns hits with their `score` field replaced by the reranker score
    and `prev_score` preserving the original embedder score for debug.
    On any failure (no model, model load error, empty hits), returns the
    original hits truncated to k.
    """
    if not hits:
        return []
    reranker = _load_reranker()
    if reranker is None:
        return list(hits)[:k]
    try:
        pairs = [[query, h.get("text", "")] for h in hits]
        scores = reranker.compute_score(pairs, normalize=True)
    except Exception as e:  # pragma: no cover
        _log.warning("reranker.compute_score failed: %r; falling back", e)
        return list(hits)[:k]

    # Ollama-style sorted pair — stable sort keeps embedder order on ties.
    scored = list(zip(hits, scores))
    scored.sort(key=lambda pair: pair[1], reverse=True)
    out: list[dict] = []
    for h, s in scored[:k]:
        copy = dict(h)
        copy["prev_score"] = copy.get("score")
        copy["score"] = round(float(s), 4)
        out.append(copy)
    return out
