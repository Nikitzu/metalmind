"""Recall must survive a concurrent reindex.

Under the default rollback journal a write transaction locks readers out
entirely, so a bulk change - a git pull of a synced vault, an archive sweep -
took recall down with `database is locked` for the duration. WAL plus a busy
timeout keeps readers answering from the last committed snapshot.
"""

import sqlite3

import pytest

from metalmind_vault_rag import core, sqlite_util


@pytest.fixture
def fts_db(tmp_path, monkeypatch):
    monkeypatch.setattr(core, "FTS_DB_PATH", tmp_path / "fts-test.db")
    with core.fts_conn() as conn:
        conn.execute(
            "INSERT INTO chunks (file, heading, chunk_idx, text) VALUES (?, ?, ?, ?)",
            ("Work/note.md", "H", 0, "findable content"),
        )
        conn.commit()
    return tmp_path / "fts-test.db"


class TestConnectionPragmas:
    def test_journal_mode_is_wal(self, fts_db):
        with core.fts_conn() as conn:
            assert conn.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"

    def test_busy_timeout_is_set(self, fts_db):
        with core.fts_conn() as conn:
            assert conn.execute("PRAGMA busy_timeout").fetchone()[0] > 0

    def test_wal_persists_on_the_file_so_existing_installs_upgrade(self, tmp_path):
        path = tmp_path / "legacy.db"
        legacy = sqlite3.connect(str(path))
        legacy.execute("CREATE TABLE t (x)")
        legacy.commit()
        legacy.close()

        sqlite_util.connect(str(path)).close()

        plain = sqlite3.connect(str(path))
        assert plain.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
        plain.close()


def bulk_write(conn, rows: int = 4000) -> None:
    """Write enough to spill SQLite's page cache.

    A small pending write holds only a RESERVED lock, which readers tolerate -
    so a toy transaction passes with or without WAL and proves nothing. Past
    the cache threshold the writer escalates to EXCLUSIVE, which is what a
    real 100-file reindex does and what locked recall out.
    """
    blob = "lorem ipsum dolor sit amet " * 400
    for i in range(rows):
        conn.execute(
            "INSERT INTO chunks (file, heading, chunk_idx, text) VALUES (?, ?, ?, ?)",
            (f"Work/bulk-{i}.md", "H", 0, blob),
        )


class TestReaderDuringWrite:
    def test_query_succeeds_while_a_bulk_write_is_open(self, fts_db):
        writer = core.fts_conn()
        bulk_write(writer)

        reader = core.fts_conn()
        rows = reader.execute(
            "SELECT file FROM chunks WHERE chunks MATCH ?", ("findable",)
        ).fetchall()

        assert [r[0] for r in rows] == ["Work/note.md"]

        writer.rollback()
        writer.close()
        reader.close()

    def test_reader_does_not_see_the_writers_uncommitted_rows(self, fts_db):
        writer = core.fts_conn()
        bulk_write(writer, rows=50)

        reader = core.fts_conn()
        rows = reader.execute(
            "SELECT file FROM chunks WHERE chunks MATCH ?", ("lorem",)
        ).fetchall()

        assert rows == []

        writer.rollback()
        writer.close()
        reader.close()
