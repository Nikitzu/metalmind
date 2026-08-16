"""fastembed-backed EmbeddingBackend. Runs an ONNX embedding model
in-process - no daemon, no HTTP. The default since v0.5.0.

Default model is BAAI/bge-small-en-v1.5 (384-dim, ~30 MB). First call
auto-downloads the ONNX weights to ~/.metalmind/cache/fastembed/ and
caches them across processes; subsequent calls reuse the disk cache
without network access. fastembed's own default lives in the system
temp dir, which macOS purges periodically - that leaves a snapshot
directory with the model file missing and recall failing with
NO_SUCHFILE until the cache is cleared. A home-dir cache is durable.
Override the location via FASTEMBED_CACHE_PATH and the model via
VAULT_EMBED_MODEL. The dimension follows the model, read from fastembed's
own catalogue, so changing models needs no second variable. VAULT_EMBED_DIM
remains for models fastembed does not list, and is refused when it
contradicts one it does.

The TextEmbedding model is held lazily - first call to `embed` triggers
construction (which may download). That keeps watcher startup fast for
users who never recall.
"""

from __future__ import annotations

import os
from typing import Any


DEFAULT_MODEL = "BAAI/bge-small-en-v1.5"
DEFAULT_DIM = 384


def model_dimension(model_name: str) -> int | None:
    """Vector width fastembed reports for a model, or None if it lists none.

    Kept tolerant of an older or newer wheel whose catalogue entries carry
    different keys: an unreadable catalogue means unknown, not a crash on
    import of the backend."""
    try:
        from fastembed import TextEmbedding

        for entry in TextEmbedding.list_supported_models():
            if entry.get("model") == model_name:
                dim = entry.get("dim")
                return int(dim) if dim else None
    except Exception:
        return None
    return None


def resolve_dim(model_name: str | None = None) -> int:
    """Vector width for a model, refusing a contradicting override.

    Shared by the backend and the vector store. They used to read
    VAULT_EMBED_DIM independently with their own defaults, so the width an
    index was built at and the width the embedder produced were two separate
    numbers that could silently disagree.

    The width is a property of the model, so fastembed's catalogue decides it.
    An explicit VAULT_EMBED_DIM that contradicts the catalogue is refused,
    because a caller passing the wrong number is not expressing a preference.
    A model fastembed does not list has nothing to check against, so there the
    override is the only information available."""
    model_name = model_name or os.environ.get("VAULT_EMBED_MODEL", DEFAULT_MODEL)
    declared = os.environ.get("VAULT_EMBED_DIM")
    known = model_dimension(model_name)
    if known is None:
        if declared is None:
            raise ValueError(
                f"fastembed does not list {model_name!r}, so its vector width is "
                "unknown. Set VAULT_EMBED_DIM to the model's dimension."
            )
        return int(declared)
    if declared is not None and int(declared) != known:
        raise ValueError(
            f"VAULT_EMBED_DIM={declared} contradicts {model_name!r}, which produces "
            f"{known}-dimensional vectors. Unset VAULT_EMBED_DIM to use {known}, "
            "or correct it."
        )
    return known


def resolve_cache_dir() -> str:
    """Durable model cache location. FASTEMBED_CACHE_PATH wins so users
    keep full control; otherwise ~/.metalmind/cache/fastembed."""
    env = os.environ.get("FASTEMBED_CACHE_PATH")
    if env:
        return env
    return os.path.join(os.path.expanduser("~"), ".metalmind", "cache", "fastembed")


class FastEmbedBackend:
    """In-process ONNX embedding backend. One model instance per process.

    The fastembed import is at module top-level by design - the [rerank]
    canary pattern showed silent-fallback bugs win when imports are
    deferred. Failing fast here surfaces missing wheels immediately.
    """

    def __init__(
        self,
        model_name: str | None = None,
        dim: int | None = None,
    ) -> None:
        self._model_name = model_name or os.environ.get(
            "VAULT_EMBED_MODEL", DEFAULT_MODEL
        )
        self._dim = dim if dim is not None else resolve_dim(self._model_name)
        self._model: Any | None = None

    def _ensure_model(self) -> Any:
        if self._model is None:
            from fastembed import TextEmbedding  # local import keeps unit tests fast

            cache_dir = resolve_cache_dir()
            os.makedirs(cache_dir, exist_ok=True)
            self._model = TextEmbedding(model_name=self._model_name, cache_dir=cache_dir)
        return self._model

    def dimension(self) -> int:
        return self._dim

    def model_id(self) -> str:
        return self._model_name

    def _run(self, method: str, texts: list[str]) -> list[list[float]]:
        """Embed through `method`, falling back to `embed` when the installed
        fastembed predates the asymmetric entry points.

        Retrieval models are trained asymmetrically: many prepend an
        instruction to the query side only. Sending both sides through
        `embed()` compares a bare query against prefixed passages, which
        indexes cleanly and retrieves nothing. `bge-small-en-v1.5` is immune
        because v1.5 was trained so the instruction is optional, and its three
        paths return identical vectors, so the default never noticed.

        fastembed yields numpy arrays; the float conversion keeps the protocol
        output Python-native and JSON-safe for downstream callers."""
        if not texts:
            return []
        model = self._ensure_model()
        fn = getattr(model, method, None) or model.embed
        return [list(map(float, vec)) for vec in fn(texts)]

    def embed(self, texts: list[str]) -> list[list[float]]:
        return self._run("passage_embed", texts)

    def embed_query(self, texts: list[str]) -> list[list[float]]:
        return self._run("query_embed", texts)
