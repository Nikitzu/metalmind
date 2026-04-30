"""Vector storage abstraction.

The watcher, indexer, and search layer all talk to a `VectorStore` —
never to a concrete vector backend. Two implementations:

- `QdrantStore` (legacy, v0.4.x default): HTTP to a Qdrant server.
- `SqliteVecStore` (v0.5.0 default): in-process sqlite-vec virtual table.

Selection happens once via `make_store()` based on `METALMIND_BACKEND`.
Callers should never import an implementation directly — that defeats
the abstraction and makes A/B benching impossible. Use the factory.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class VectorPoint:
    """One indexable chunk going into a store. The store treats `payload`
    as opaque metadata round-trip; it must round-trip `file`, `heading`,
    and `text` because callers consume those keys downstream."""

    id: str
    vector: list[float]
    payload: dict


@dataclass(frozen=True)
class VectorHit:
    """One search result from a store. `payload` is the same dict the
    caller upserted alongside the vector. `score` is cosine similarity in
    [0, 1] for both implementations — semantic similarity, higher is more
    similar (Qdrant's native convention; sqlite-vec returns cosine
    distance which we convert at the boundary)."""

    score: float
    payload: dict


class VectorStore(Protocol):
    """Backend-agnostic vector storage interface.

    Implementations must:
    - Treat `payload` as opaque (no schema enforcement on upsert)
    - Return `VectorHit.score` as cosine similarity in [0, 1]
    - Make `ensure_collection` idempotent
    - Make `upsert` overwrite by `id` (replace, not duplicate)
    """

    def ensure_collection(self) -> None:
        """Create the collection / virtual table if absent. Idempotent."""

    def collection_exists(self) -> bool:
        """Whether the backing collection / table exists."""

    def upsert(self, points: list[VectorPoint]) -> None:
        """Insert or replace by id. Caller batches; store may further batch."""

    def delete_by_file(self, rel: str) -> None:
        """Drop every point whose `payload['file']` equals `rel`. Used by
        the incremental reindexer when a file is rewritten or removed."""

    def delete_collection(self) -> None:
        """Drop the entire collection / table. For schema or dimension
        changes — never call from the recall path."""

    def count(self) -> int:
        """Total stored points. Doctor smoke checks read this for drift
        detection; impls should answer in O(1) or near it."""

    def query(self, vec: list[float], k: int) -> list[VectorHit]:
        """KNN by cosine similarity. Returns up to `k` hits sorted
        most-similar-first."""


def make_store() -> VectorStore:
    """Pick the active store from `METALMIND_BACKEND`.

    Default is `legacy` (Qdrant) during the v0.5.0 development cycle so
    Slices 1-4 don't change behavior. Slice 5 flips the default to
    `embedded` (sqlite-vec) once the in-process path is proven on the
    bench. The escape hatch stays past v0.5.0 in case sqlite-vec hits a
    ceiling we didn't anticipate.
    """
    backend = os.environ.get("METALMIND_BACKEND", "legacy").lower()
    if backend == "legacy":
        from .qdrant_store import QdrantStore

        return QdrantStore()
    if backend == "embedded":
        from .sqlite_vec_store import SqliteVecStore  # type: ignore[attr-defined]

        return SqliteVecStore()
    raise ValueError(
        f"unknown METALMIND_BACKEND={backend!r}; valid: 'embedded', 'legacy'"
    )


__all__ = ["VectorPoint", "VectorHit", "VectorStore", "make_store"]
