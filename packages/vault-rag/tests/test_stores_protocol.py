"""Shared protocol-contract tests run against every VectorStore impl.

Single source of truth for the VectorStore contract. Each impl is a
parametrize value; pytest IDs make failures point at the offender. When
adding a new store, add a fixture entry and the suite runs against it
unchanged - the parametrize survives the removal of the Qdrant store in
v0.16.0 precisely so the next store costs one line.

Tests are hermetic - sqlite-vec uses a temp file. No external services,
no Docker.
"""

from __future__ import annotations

import pathlib

import pytest

from metalmind_vault_rag.stores import VectorHit, VectorPoint
from metalmind_vault_rag.stores.sqlite_vec_store import SqliteVecStore


def _sqlite_vec_factory(tmp_path: pathlib.Path) -> SqliteVecStore:
    return SqliteVecStore(db_path=tmp_path / "vec.db", collection="test", dim=4)


@pytest.fixture(params=["sqlite-vec"])
def store(request: pytest.FixtureRequest, tmp_path: pathlib.Path):
    impl = _sqlite_vec_factory(tmp_path)
    yield impl
    if hasattr(impl, "close"):
        impl.close()  # type: ignore[attr-defined]


def _point(
    id_: str,
    vec: list[float],
    file: str = "a.md",
    heading: str = "(root)",
    text: str = "t",
) -> VectorPoint:
    return VectorPoint(
        id=id_, vector=vec, payload={"file": file, "heading": heading, "text": text}
    )


# Stable UUIDs - harmless for sqlite-vec, required by stricter stores.
_ID1 = "00000000-0000-0000-0000-000000000001"
_ID2 = "00000000-0000-0000-0000-000000000002"
_ID3 = "00000000-0000-0000-0000-000000000003"


def test_ensure_collection_is_idempotent(store) -> None:
    assert not store.collection_exists()
    store.ensure_collection()
    assert store.collection_exists()
    store.ensure_collection()
    assert store.collection_exists()


def test_upsert_and_query_round_trip(store) -> None:
    store.ensure_collection()
    store.upsert(
        [
            _point(_ID1, [1.0, 0.0, 0.0, 0.0]),
            _point(_ID2, [0.0, 1.0, 0.0, 0.0]),
        ]
    )
    hits = store.query([1.0, 0.0, 0.0, 0.0], k=2)
    assert len(hits) == 2
    assert all(isinstance(h, VectorHit) for h in hits)
    assert hits[0].score >= hits[1].score
    assert hits[0].score > 0.99  # cosine similarity ~1 for identical


def test_upsert_replaces_by_id(store) -> None:
    store.ensure_collection()
    store.upsert([_point(_ID1, [1.0, 0.0, 0.0, 0.0])])
    store.upsert([_point(_ID1, [0.0, 1.0, 0.0, 0.0])])
    assert store.count() == 1
    hits = store.query([0.0, 1.0, 0.0, 0.0], k=1)
    assert hits[0].score > 0.99


def test_delete_by_file_removes_only_matching(store) -> None:
    store.ensure_collection()
    store.upsert(
        [
            _point(_ID1, [1.0, 0.0, 0.0, 0.0], file="a.md"),
            _point(_ID2, [0.0, 1.0, 0.0, 0.0], file="a.md"),
            _point(_ID3, [0.0, 0.0, 1.0, 0.0], file="b.md"),
        ]
    )
    store.delete_by_file("a.md")
    assert store.count() == 1
    hits = store.query([0.0, 0.0, 1.0, 0.0], k=5)
    assert len(hits) == 1
    assert hits[0].payload["file"] == "b.md"


def test_count_on_missing_collection_is_zero(store) -> None:
    assert store.count() == 0


def test_delete_collection_drops_everything(store) -> None:
    store.ensure_collection()
    store.upsert([_point(_ID1, [1.0, 0.0, 0.0, 0.0])])
    assert store.collection_exists()
    store.delete_collection()
    assert not store.collection_exists()


def test_query_respects_k_limit(store) -> None:
    store.ensure_collection()
    store.upsert(
        [
            _point(f"00000000-0000-0000-0000-00000000000{i}", [float(i), 0.0, 0.0, 0.0])
            for i in range(1, 6)
        ]
    )
    hits = store.query([3.0, 0.0, 0.0, 0.0], k=2)
    assert len(hits) == 2


def test_payload_is_round_tripped_verbatim(store) -> None:
    """Stores must preserve payload contents exactly - callers use it
    for `file`, `heading`, `text` and don't expect mutation."""
    store.ensure_collection()
    store.upsert([_point(_ID1, [1.0, 0.0, 0.0, 0.0], file="x.md", heading="H1", text="body")])
    hits = store.query([1.0, 0.0, 0.0, 0.0], k=1)
    assert hits[0].payload["file"] == "x.md"
    assert hits[0].payload["heading"] == "H1"
    assert hits[0].payload["text"] == "body"
