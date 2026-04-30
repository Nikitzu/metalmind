"""Embedding backend abstraction.

The watcher and search layer call `embed(texts) -> list[list[float]]`
without caring what model produced the vectors or where it ran. Two
implementations:

- `OllamaBackend` (legacy, v0.4.x default): HTTP to a local Ollama
  daemon running `nomic-embed-text` (768-dim).
- `FastEmbedBackend` (v0.5.0 default): in-process ONNX via the
  fastembed wheel. Default model `BAAI/bge-small-en-v1.5` (384-dim,
  ~30 MB cached at `~/.cache/fastembed/`).

Selection happens once via `make_backend()` keyed on `METALMIND_BACKEND`
— the same env var that picks the vector store. Backends and stores
move in lockstep: legacy Qdrant + Ollama, embedded sqlite-vec +
fastembed.
"""

from __future__ import annotations

import os
from typing import Protocol


class EmbeddingBackend(Protocol):
    """Backend-agnostic text → vector interface.

    Implementations must:
    - Return one vector per input text, in input order.
    - Return vectors of the dimension reported by `dimension()`.
    - Be safe to call with an empty list (returns []).
    """

    def embed(self, texts: list[str]) -> list[list[float]]:
        """Batch embed. Order preserved; one vector per text."""

    def dimension(self) -> int:
        """Vector dimension for the configured model. Used by the store
        to size its index. Stable for the lifetime of a process."""


def make_backend() -> EmbeddingBackend:
    """Pick the active backend from METALMIND_BACKEND.

    Default is `embedded` (fastembed, in-process). Set
    `METALMIND_BACKEND=legacy` to fall back to a local Ollama daemon —
    kept as an escape hatch for users who want a different model and
    don't mind running the daemon.
    """
    backend = os.environ.get("METALMIND_BACKEND", "embedded").lower()
    if backend == "legacy":
        from .ollama_backend import OllamaBackend

        return OllamaBackend()
    if backend == "embedded":
        from .fastembed_backend import FastEmbedBackend  # type: ignore[attr-defined]

        return FastEmbedBackend()
    raise ValueError(
        f"unknown METALMIND_BACKEND={backend!r}; valid: 'embedded', 'legacy'"
    )


__all__ = ["EmbeddingBackend", "make_backend"]
