"""Protocol-contract tests for QdrantStore.

Uses qdrant-client's `:memory:` mode so the suite is hermetic — no
running Qdrant server required, no Docker. Same code path the watcher
uses on a real server, just backed by RAM.

When SqliteVecStore lands in Slice 2, the same shape of tests should
run against it; consider parametrising on the store factory.
"""

from __future__ import annotations

import pytest
from qdrant_client import QdrantClient

from metalmind_vault_rag.stores import VectorHit, VectorPoint
from metalmind_vault_rag.stores.qdrant_store import QdrantStore


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> QdrantStore:
    """In-memory Qdrant store with a unique collection per test."""
    s = QdrantStore.__new__(QdrantStore)
    s._url = ":memory:"  # unused — we wire the client directly
    s._collection = "test"
    s._dim = 4
    s._client = QdrantClient(":memory:")
    return s


def _point(id_: str, vec: list[float], file: str = "a.md", heading: str = "(root)") -> VectorPoint:
    return VectorPoint(id=id_, vector=vec, payload={"file": file, "heading": heading, "text": "t"})


def test_ensure_collection_is_idempotent(store: QdrantStore) -> None:
    assert not store.collection_exists()
    store.ensure_collection()
    assert store.collection_exists()
    # Second call must not raise or recreate.
    store.ensure_collection()
    assert store.collection_exists()


def test_upsert_and_query_round_trip(store: QdrantStore) -> None:
    store.ensure_collection()
    store.upsert(
        [
            _point("00000000-0000-0000-0000-000000000001", [1.0, 0.0, 0.0, 0.0]),
            _point("00000000-0000-0000-0000-000000000002", [0.0, 1.0, 0.0, 0.0]),
        ]
    )
    hits = store.query([1.0, 0.0, 0.0, 0.0], k=2)
    assert len(hits) == 2
    assert all(isinstance(h, VectorHit) for h in hits)
    # Cosine similarity: identical vector ranks first with score ~1.
    assert hits[0].score >= hits[1].score
    assert hits[0].score > 0.99


def test_upsert_replaces_by_id(store: QdrantStore) -> None:
    """Re-upserting the same id overwrites — never duplicates."""
    store.ensure_collection()
    pid = "00000000-0000-0000-0000-000000000001"
    store.upsert([_point(pid, [1.0, 0.0, 0.0, 0.0], file="a.md")])
    store.upsert([_point(pid, [0.0, 1.0, 0.0, 0.0], file="a.md")])
    assert store.count() == 1
    hits = store.query([0.0, 1.0, 0.0, 0.0], k=1)
    assert hits[0].score > 0.99


def test_delete_by_file_removes_only_matching(store: QdrantStore) -> None:
    store.ensure_collection()
    store.upsert(
        [
            _point("00000000-0000-0000-0000-000000000001", [1.0, 0.0, 0.0, 0.0], file="a.md"),
            _point("00000000-0000-0000-0000-000000000002", [0.0, 1.0, 0.0, 0.0], file="a.md"),
            _point("00000000-0000-0000-0000-000000000003", [0.0, 0.0, 1.0, 0.0], file="b.md"),
        ]
    )
    store.delete_by_file("a.md")
    assert store.count() == 1
    hits = store.query([0.0, 0.0, 1.0, 0.0], k=5)
    assert len(hits) == 1
    assert hits[0].payload["file"] == "b.md"


def test_count_on_missing_collection_is_zero(store: QdrantStore) -> None:
    assert store.count() == 0


def test_delete_collection_drops_everything(store: QdrantStore) -> None:
    store.ensure_collection()
    store.upsert([_point("00000000-0000-0000-0000-000000000001", [1.0, 0.0, 0.0, 0.0])])
    assert store.collection_exists()
    store.delete_collection()
    assert not store.collection_exists()


def test_query_respects_k_limit(store: QdrantStore) -> None:
    store.ensure_collection()
    store.upsert(
        [
            _point(f"00000000-0000-0000-0000-00000000000{i}", [float(i), 0.0, 0.0, 0.0])
            for i in range(1, 6)
        ]
    )
    hits = store.query([3.0, 0.0, 0.0, 0.0], k=2)
    assert len(hits) == 2
