"""Writing the index stamp when the index is actually rebuilt.

Only a full rebuild produces a whole index in one known format. An incremental
reindex touches a handful of files against everything already there, so
restamping after one would claim the whole collection was built by the running
code when most of it was not.
"""

import sqlite3

import pytest

from metalmind_vault_rag import indexer
from metalmind_vault_rag.index_format import FORMAT_VERSION, read_stamp


class FakeStore:
    def ensure_collection(self):
        pass

    def delete_by_file(self, rel):
        pass

    def upsert(self, points):
        pass


class FakeBackend:
    def model_id(self):
        return "fake-model"

    def dimension(self):
        return 4


@pytest.fixture
def stubbed(tmp_path, monkeypatch):
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE chunks (file, heading, chunk_idx, text)")
    path = tmp_path / "vault.index.json"
    monkeypatch.setattr(indexer, "vector_store", lambda: FakeStore())
    monkeypatch.setattr(indexer, "fts_conn", lambda: conn)
    monkeypatch.setattr(indexer, "embedding_backend", lambda: FakeBackend())
    monkeypatch.setattr(indexer, "stamp_path", lambda collection: path)
    monkeypatch.setattr(indexer, "run_calibration", lambda: None)
    monkeypatch.setattr(indexer, "files_to_index", lambda: [])
    return path


class TestStampIndex:
    def test_writes_the_running_format_and_the_counts(self, stubbed):
        indexer.stamp_index(files=341, chunks=2970)

        stamp = read_stamp(stubbed)
        assert stamp is not None
        assert stamp.format_version == FORMAT_VERSION
        assert (stamp.files, stamp.chunks) == (341, 2970)
        assert stamp.embedder == "fake-model@4"

    def test_a_failure_does_not_break_indexing(self, stubbed, monkeypatch, capsys):
        def boom():
            raise RuntimeError("no backend")

        monkeypatch.setattr(indexer, "embedding_backend", boom)

        indexer.stamp_index(files=1, chunks=1)

        assert "stamp" in capsys.readouterr().out.lower()


class TestWiring:
    def test_a_full_reindex_stamps(self, stubbed):
        indexer.reindex_all()

        assert read_stamp(stubbed) is not None

    def test_an_incremental_reindex_does_not_stamp(self, stubbed):
        indexer.reindex_paths([])

        assert read_stamp(stubbed) is None

    def test_an_incremental_reindex_leaves_an_existing_stamp_alone(self, stubbed):
        indexer.stamp_index(files=341, chunks=2970)
        before = read_stamp(stubbed)

        indexer.reindex_paths([])

        assert read_stamp(stubbed) == before

    def test_the_stamp_lands_even_when_calibration_fails(self, stubbed, monkeypatch):
        """The index is built either way. Confidence is advisory; the format
        record is not, and losing it would leave the collection unidentifiable."""

        def boom():
            raise RuntimeError("calibration exploded")

        monkeypatch.setattr(indexer, "run_calibration", boom)

        with pytest.raises(RuntimeError):
            indexer.reindex_all()

        assert read_stamp(stubbed) is not None
