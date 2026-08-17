"""Cross-encoder reranker. Lazy-loaded on first use so the watcher startup
stays fast and users who never opt-in pay nothing.

Design (v0.5.x ONNX path - replaces the FlagEmbedding/torch path):
- Opt-in via `rerank=True` on search_vault. Off by default.
- Backend: onnxruntime CPU, tokenizers (Rust), huggingface_hub for download.
  Drops ~2 GB of torch + transformers + FlagEmbedding from the [rerank] extra.
  Replaces them with ~60 MB of onnxruntime + tokenizers + hub.
- Model: `onnx-community/bge-reranker-v2-m3-ONNX` (community ONNX export of BAAI's
  reranker-v2-m3, multi-lingual, ~150 MB quantized). Override with
  `METALMIND_RERANKER_MODEL` if you want a different ONNX-exported repo.
- Overfetch strategy: caller asks for k, we ask the store for max(k*2, 10),
  re-score, return top k from the re-sorted list.
- Batch shape is the whole cost. Scoring is one ONNX call over a
  candidates x tokens tensor, linear in the first and worse than linear in
  the second; tokenizing is 13ms and threading is already saturated, so
  neither is a lever. At the default k of 5 the batch was 20x512 and took
  7.5s. It is now 10x256 and takes 1.3s, measured identical on 593 queries
  across the adversarial and LongMemEval benches.
- 256 tokens is the knee of the length curve, not the floor: hit@1 holds at
  62% down to 256 and then falls away (57% at 192, 55% at 128, which is what
  plain hybrid scores for 43ms). Chunks cap at 3500 chars, so nearly every
  pair truncates, and what survives is the title plus the opening - which is
  where the note's identity lives. Trading model size for length is the wrong
  direction: a strong model reading 256 tokens beats a small one reading 512
  at matched latency, and the smallest cross-encoders rank *worse* than not
  reranking at all.
- Failure mode: if the model can't load (no network, no disk, no ONNX deps
  installed), log once and return the embedder's ordering. Rerank must
  never be the reason recall fails.
"""

from __future__ import annotations

import logging
import math
import os
import sys
from typing import Any, Sequence

_log = logging.getLogger(__name__)

_SESSION: Any = None
_TOKENIZER: Any = None
_FAILED = False

DEFAULT_MODEL = os.environ.get("METALMIND_RERANKER_MODEL", "onnx-community/bge-reranker-v2-m3-ONNX")
DEFAULT_ONNX_FILE = os.environ.get("METALMIND_RERANKER_ONNX_FILE", "onnx/model_quantized.onnx")
DEFAULT_OVERFETCH = max(1, int(os.environ.get("METALMIND_RERANK_OVERFETCH", "2")))
DEFAULT_MAX_LENGTH = int(os.environ.get("METALMIND_RERANK_MAX_LEN", "256"))
DEFAULT_MIN_CANDIDATES = max(1, int(os.environ.get("METALMIND_RERANK_MIN_CANDIDATES", "10")))

RRF_K = 60
RERANK_ALPHA = min(
    1.0, max(0.0, float(os.environ.get("METALMIND_RERANK_ALPHA", "0.5")))
)


def is_dep_available() -> bool:
    """Are the optional ONNX-runtime deps importable in this process?

    Does NOT trigger a model download - just tells the CLI whether the
    package has been installed with the `[rerank]` extra. Used by the
    `/rerank/status` endpoint so `metalmind tap copper --rerank` can
    auto-install + restart the watcher on first use instead of asking the
    user to run a weird `uv tool install ...` command by hand.
    """
    import importlib.util

    return all(
        importlib.util.find_spec(name) is not None
        for name in ("onnxruntime", "tokenizers", "huggingface_hub")
    )


def _sigmoid(x: float) -> float:
    if x >= 0:
        ez = math.exp(-x)
        return 1.0 / (1.0 + ez)
    ez = math.exp(x)
    return ez / (1.0 + ez)


def _load() -> tuple[Any, Any] | None:
    """Import + construct session and tokenizer once, memoized. Returns None on failure."""
    global _SESSION, _TOKENIZER, _FAILED
    if _SESSION is not None and _TOKENIZER is not None:
        return _SESSION, _TOKENIZER
    if _FAILED:
        return None
    try:
        import onnxruntime
        from huggingface_hub import hf_hub_download
        from tokenizers import Tokenizer
    except ImportError as e:
        _FAILED = True
        print(
            f"metalmind: --rerank requested but ONNX deps missing ({e}). "
            "Install with `uv tool install metalmind-vault-rag[rerank]` or drop the flag.",
            file=sys.stderr,
        )
        return None

    flavor = (os.environ.get("METALMIND_FLAVOR") or "classic").lower()
    themed = flavor == "scadrial"
    lead = (
        "metalmind: lighting the duralumin - reranker warming up"
        if themed
        else "metalmind: reranker warming up"
    )
    print(
        f"{lead} (first call downloads ~150 MB ONNX model from '{DEFAULT_MODEL}')…",
        file=sys.stderr,
        flush=True,
    )

    try:
        model_path = hf_hub_download(repo_id=DEFAULT_MODEL, filename=DEFAULT_ONNX_FILE)
        tok_path = hf_hub_download(repo_id=DEFAULT_MODEL, filename="tokenizer.json")
    except Exception as e:  # pragma: no cover - network/disk issues
        _FAILED = True
        print(
            f"metalmind: reranker model '{DEFAULT_MODEL}' failed to download ({e!r}); "
            "falling back to embedder ordering.",
            file=sys.stderr,
        )
        return None

    try:
        tokenizer = Tokenizer.from_file(tok_path)
        tokenizer.enable_truncation(max_length=DEFAULT_MAX_LENGTH)
        tokenizer.enable_padding()
        sess_options = onnxruntime.SessionOptions()
        threads = int(os.environ.get("METALMIND_RERANK_THREADS", "0"))
        if threads > 0:
            sess_options.intra_op_num_threads = threads
        session = onnxruntime.InferenceSession(
            model_path,
            sess_options=sess_options,
            providers=["CPUExecutionProvider"],
        )
    except Exception as e:  # pragma: no cover - corrupt model / OOM
        _FAILED = True
        print(
            f"metalmind: reranker session/tokenizer init failed ({e!r}); "
            "falling back to embedder ordering.",
            file=sys.stderr,
        )
        return None

    _SESSION = session
    _TOKENIZER = tokenizer
    return _SESSION, _TOKENIZER


def overfetch_k(k: int) -> int:
    """How many raw hits to pull from the store when reranking is requested.

    The floor matters more than the multiplier at the default k of 5, where it
    is what actually sets the batch size, and cross-encoder cost is linear in
    that count. Ten is where the reranker's reach stops paying: on the
    adversarial bench only 2 of 93 queries have the wanted note deeper than
    rank 10 in the fused list, and 83 of the 85 findable ones sit inside rank
    8. The multiplier still governs larger k, so a caller asking for 20 gets
    40 candidates rather than the floor."""
    return max(k, k * DEFAULT_OVERFETCH, DEFAULT_MIN_CANDIDATES)


def _score_batch(session: Any, tokenizer: Any, pairs: list[tuple[str, str]]) -> list[float]:
    """Run a single batch of (query, doc) pairs through the cross-encoder."""
    import numpy as np

    encs = tokenizer.encode_batch(pairs)
    ids = np.array([enc.ids for enc in encs], dtype=np.int64)
    mask = np.array([enc.attention_mask for enc in encs], dtype=np.int64)

    inputs: dict[str, Any] = {"input_ids": ids, "attention_mask": mask}
    input_names = {i.name for i in session.get_inputs()}
    if "token_type_ids" in input_names:
        inputs["token_type_ids"] = np.zeros_like(ids)

    out = session.run(None, inputs)[0]
    flat = out.reshape(-1).tolist()
    return [_sigmoid(float(x)) for x in flat]


def _pair_text(hit: dict) -> str:
    """What the cross-encoder is asked to judge: the note's identity, then its
    chunk.

    Scoring the chunk alone hid the one thing that distinguishes a note from
    its siblings. On five traced regressions the token that identified the
    wanted note was missing from its chunk in four, and the worst case was a
    133-character fragment naming neither the street nor the town it was
    supposed to be about, scored against a query asking which house we
    abandoned. The title is where that identity lives, and BM25 was already
    matching on it, so this only shows the reranker what put the note in the
    candidate set in the first place."""
    stem = hit["file"].rsplit("/", 1)[-1]
    if stem.endswith(".md"):
        stem = stem[:-3]
    title = hit.get("title") or stem.replace("-", " ").replace("_", " ")
    return f"{title}\n\n{hit.get('text', '')}"


def rerank_hits(
    query: str,
    hits: Sequence[dict],
    k: int,
    penalties: dict[str, float] | None = None,
) -> list[dict]:
    """Re-score hits against the query with a cross-encoder, then truncate to k.

    Returns hits with their `score` field replaced by the reranker score
    and `prev_score` preserving the original embedder score for debug.
    On any failure (no model, model load error, empty hits), returns the
    original hits truncated to k.

    `penalties` maps file path → multiplier applied to the cross-encoder
    score before sorting. Applied only on the success path: the fallback
    returns the caller's original scores, which already carry any
    fusion-time penalties - applying them again would double-penalise.
    """
    if not hits:
        return []
    loaded = _load()
    if loaded is None:
        return list(hits)[:k]
    session, tokenizer = loaded

    try:
        pairs: list[tuple[str, str]] = [(query, _pair_text(h)) for h in hits]
        scores = _score_batch(session, tokenizer, pairs)
    except Exception as e:
        _log.warning("reranker scoring failed: %r; falling back", e)
        return list(hits)[:k]

    if penalties:
        scores = [s * penalties.get(h["file"], 1.0) for h, s in zip(hits, scores)]

    fusion_rank = {h["file"]: i + 1 for i, h in enumerate(hits)}
    by_score = sorted(range(len(hits)), key=lambda i: scores[i], reverse=True)
    cross_rank = {hits[i]["file"]: pos + 1 for pos, i in enumerate(by_score)}

    def fused(h: dict) -> float:
        return RERANK_ALPHA / (RRF_K + cross_rank[h["file"]]) + (
            1.0 - RERANK_ALPHA
        ) / (RRF_K + fusion_rank[h["file"]])

    out: list[dict] = []
    for h in sorted(hits, key=fused, reverse=True)[:k]:
        copy = dict(h)
        copy["prev_score"] = copy.get("score")
        copy["score"] = round(fused(h), 6)
        out.append(copy)
    return out
