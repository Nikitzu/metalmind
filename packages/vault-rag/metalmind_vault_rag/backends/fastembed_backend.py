"""fastembed-backed EmbeddingBackend. Runs an ONNX embedding model
in-process — no Ollama daemon, no HTTP. Becomes the default in v0.5.0.

Default model is BAAI/bge-small-en-v1.5 (384-dim, ~30 MB). First call
auto-downloads the ONNX weights to ~/.metalmind/cache/fastembed/ and
caches them across processes; subsequent calls reuse the disk cache
without network access. fastembed's own default lives in the system
temp dir, which macOS purges periodically — that leaves a snapshot
directory with the model file missing and recall failing with
NO_SUCHFILE until the cache is cleared. A home-dir cache is durable.
Override the location via FASTEMBED_CACHE_PATH, the model via
VAULT_EMBED_MODEL; the matching dimension is read from VAULT_EMBED_DIM
(default 384 for bge-small).

The TextEmbedding model is held lazily — first call to `embed` triggers
construction (which may download). That keeps watcher startup fast for
users who never recall.
"""

from __future__ import annotations

import os
from typing import Any


DEFAULT_MODEL = "BAAI/bge-small-en-v1.5"
DEFAULT_DIM = 384


def resolve_cache_dir() -> str:
    """Durable model cache location. FASTEMBED_CACHE_PATH wins so users
    keep full control; otherwise ~/.metalmind/cache/fastembed."""
    env = os.environ.get("FASTEMBED_CACHE_PATH")
    if env:
        return env
    return os.path.join(os.path.expanduser("~"), ".metalmind", "cache", "fastembed")


class FastEmbedBackend:
    """In-process ONNX embedding backend. One model instance per process.

    The fastembed import is at module top-level by design — the [rerank]
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
        # Allow callers to override the dim explicitly when using a
        # non-default model; the default matches DEFAULT_MODEL.
        self._dim = (
            dim
            if dim is not None
            else int(os.environ.get("VAULT_EMBED_DIM", str(DEFAULT_DIM)))
        )
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

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        model = self._ensure_model()
        # fastembed.embed returns an iterator of numpy arrays; tolist()
        # keeps the protocol output type Python-native and JSON-safe for
        # downstream callers.
        return [list(map(float, vec)) for vec in model.embed(texts)]
