"""Embedding backend abstraction.

The watcher and search layer call `embed(texts) -> list[list[float]]`
without caring what model produced the vectors or where it ran. Two
implementations:

- `OllamaBackend` (legacy, v0.4.x default): HTTP to a local Ollama
  daemon running `nomic-embed-text` (768-dim).
- `FastEmbedBackend` (v0.5.0 default): in-process ONNX via the
  fastembed wheel. Default model `BAAI/bge-small-en-v1.5` (384-dim,
  ~30 MB cached at `~/.metalmind/cache/fastembed/`).

Selection happens once via `make_backend()` keyed on `METALMIND_BACKEND`
- the same env var that picks the vector store. Backends and stores
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
        """Batch embed documents. Order preserved; one vector per text."""

    def embed_query(self, texts: list[str]) -> list[list[float]]:
        """Batch embed queries.

        Separate from `embed` because retrieval models are trained
        asymmetrically and many prepend an instruction to the query side only.
        A backend whose model is symmetric may return the same vectors as
        `embed`; the default one does."""

    def dimension(self) -> int:
        """Vector dimension for the configured model. Used by the store
        to size its index. Stable for the lifetime of a process."""

    def model_id(self) -> str:
        """Name of the model producing the vectors. Confidence calibration
        records it beside any derived threshold, because cosine distributions
        move with the model and edges derived under one say nothing under
        another."""


def make_backend() -> EmbeddingBackend:
    """Build the fastembed backend.

    `METALMIND_BACKEND=legacy` selected a local Ollama daemon until
    v0.16.0. The variable is still read so a stale export explains
    itself instead of silently changing which model embeds the vault -
    a mismatch that would poison the index rather than fail loudly.
    """
    backend = os.environ.get("METALMIND_BACKEND", "embedded").lower()
    if backend == "legacy":
        raise ValueError(
            "METALMIND_BACKEND=legacy selected the Ollama embedding backend, "
            "removed in v0.16.0. Unset the variable to use in-process "
            "fastembed."
        )
    if backend == "embedded":
        from .fastembed_backend import FastEmbedBackend  # type: ignore[attr-defined]

        return FastEmbedBackend()
    raise ValueError(f"unknown METALMIND_BACKEND={backend!r}; valid: 'embedded'")


__all__ = ["EmbeddingBackend", "make_backend"]
