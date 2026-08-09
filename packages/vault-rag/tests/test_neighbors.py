"""Neighbor-chunk attachment for `/search?neighbors=true`.

A hit's position is recovered by exact (file, text) match against the FTS
table; prev/next chunks of the same file come back under `neighbor_text`.
Hits whose source changed since indexing, or first/last chunks, degrade to
partial or absent neighbors rather than erroring.
"""

import sqlite3

import pytest

from metalmind_vault_rag import core, search


@pytest.fixture
def fts_db(tmp_path, monkeypatch):
    db_path = tmp_path / "fts-test.db"
    monkeypatch.setattr(core, "FTS_DB_PATH", db_path)
    with core.fts_conn() as conn:
        conn.executemany(
            "INSERT INTO chunks (file, heading, chunk_idx, text) VALUES (?, ?, ?, ?)",
            [
                ("Work/note.md", "Intro", 0, "first chunk"),
                ("Work/note.md", "Middle", 1, "second chunk"),
                ("Work/note.md", "End", 2, "third chunk"),
                ("Work/other.md", "Solo", 0, "only chunk"),
            ],
        )
    return db_path


def hit(file: str, text: str) -> dict:
    return {"file": file, "heading": "h", "score": 1.0, "text": text}


class TestAttachNeighbors:
    def test_middle_chunk_gets_both_neighbors(self, fts_db):
        hits = [hit("Work/note.md", "second chunk")]
        search.attach_neighbors(hits)
        assert hits[0]["neighbor_text"] == {"prev": "first chunk", "next": "third chunk"}

    def test_first_chunk_gets_only_next(self, fts_db):
        hits = [hit("Work/note.md", "first chunk")]
        search.attach_neighbors(hits)
        assert hits[0]["neighbor_text"] == {"next": "second chunk"}

    def test_last_chunk_gets_only_prev(self, fts_db):
        hits = [hit("Work/note.md", "third chunk")]
        search.attach_neighbors(hits)
        assert hits[0]["neighbor_text"] == {"prev": "second chunk"}

    def test_single_chunk_file_gets_no_field(self, fts_db):
        hits = [hit("Work/other.md", "only chunk")]
        search.attach_neighbors(hits)
        assert "neighbor_text" not in hits[0]

    def test_stale_hit_degrades_silently(self, fts_db):
        hits = [hit("Work/note.md", "text that was reindexed away")]
        search.attach_neighbors(hits)
        assert "neighbor_text" not in hits[0]

    def test_neighbors_never_cross_files(self, fts_db):
        with core.fts_conn() as conn:
            conn.execute(
                "INSERT INTO chunks (file, heading, chunk_idx, text) VALUES (?, ?, ?, ?)",
                ("Work/other.md", "Solo", 1, "second of other"),
            )
        hits = [hit("Work/note.md", "third chunk")]
        search.attach_neighbors(hits)
        assert hits[0]["neighbor_text"] == {"prev": "second chunk"}
