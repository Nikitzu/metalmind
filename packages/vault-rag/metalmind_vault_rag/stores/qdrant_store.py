"""Qdrant-backed VectorStore. Wraps the v0.4.x in-tree behavior so the
indexer, search layer, and doctor can talk to the abstraction instead.

No new behavior: every call here was previously inlined in `core.py`,
`indexer.py`, or `search.py`. Slice 1 of the v0.5.0 plan extracts it
into a class so the SqliteVecStore (Slice 2) can drop in alongside it.
"""

from __future__ import annotations

import os

from qdrant_client import QdrantClient
from qdrant_client.http.models import (
    Distance,
    FieldCondition,
    Filter,
    MatchValue,
    PointStruct,
    VectorParams,
)

from . import VectorHit, VectorPoint


class QdrantStore:
    """Qdrant client wrapper. One instance per watcher process; cheap to
    construct (the underlying gRPC/HTTP client is lazy)."""

    def __init__(
        self,
        url: str | None = None,
        collection: str | None = None,
        dim: int | None = None,
    ) -> None:
        self._url = url or os.environ.get("VAULT_QDRANT_URL", "http://localhost:6333")
        self._collection = collection or os.environ.get("VAULT_COLLECTION", "vault")
        self._dim = dim if dim is not None else int(os.environ.get("VAULT_EMBED_DIM", "768"))
        self._client = QdrantClient(url=self._url)

    # --- VectorStore protocol -------------------------------------------------

    def ensure_collection(self) -> None:
        if not self._client.collection_exists(self._collection):
            self._client.create_collection(
                self._collection,
                vectors_config=VectorParams(size=self._dim, distance=Distance.COSINE),
            )

    def collection_exists(self) -> bool:
        return bool(self._client.collection_exists(self._collection))

    def upsert(self, points: list[VectorPoint]) -> None:
        if not points:
            return
        self._client.upsert(
            self._collection,
            points=[
                PointStruct(id=p.id, vector=p.vector, payload=p.payload) for p in points
            ],
        )

    def delete_by_file(self, rel: str) -> None:
        self._client.delete(
            self._collection,
            points_selector=Filter(
                must=[FieldCondition(key="file", match=MatchValue(value=rel))]
            ),
        )

    def delete_collection(self) -> None:
        if self._client.collection_exists(self._collection):
            self._client.delete_collection(self._collection)

    def count(self) -> int:
        if not self._client.collection_exists(self._collection):
            return 0
        info = self._client.get_collection(self._collection)
        return int(getattr(info, "points_count", 0) or 0)

    def query(self, vec: list[float], k: int) -> list[VectorHit]:
        result = self._client.query_points(
            collection_name=self._collection, query=vec, limit=k
        ).points
        return [VectorHit(score=float(r.score), payload=dict(r.payload)) for r in result]
