"""Where confidence calibration runs, and where it must not.

Calibration costs a couple of hundred searches. That is affordable once per
full rebuild and wasteful on an incremental reindex, which touches a handful of
files and would move the edges by nothing. It is also advisory, so no failure
inside it may turn a successful index into a failed one.
"""

import sqlite3

import pytest

from metalmind_vault_rag import indexer


class FakeStore:
    def __init__(self):
        self.ensured = 0

    def ensure_collection(self):
        self.ensured += 1

    def delete_by_file(self, rel):
        pass

    def upsert(self, points):
        pass


@pytest.fixture
def stubbed(monkeypatch):
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE chunks (file, heading, chunk_idx, text)")
    monkeypatch.setattr(indexer, "vector_store", lambda: FakeStore())
    monkeypatch.setattr(indexer, "fts_conn", lambda: conn)
    return conn


class TestIncrementalDoesNotCalibrate:
    def test_reindex_paths_leaves_calibration_alone(self, stubbed, monkeypatch):
        calls = []
        monkeypatch.setattr(indexer, "run_calibration", lambda: calls.append(1))

        indexer.reindex_paths([])

        assert calls == []


class TestCalibrationIsAdvisory:
    def test_a_failure_inside_calibration_does_not_raise(self, monkeypatch, capsys):
        def boom():
            raise sqlite3.OperationalError("database is locked")

        monkeypatch.setattr(indexer, "fts_conn", boom)
        monkeypatch.delenv("METALMIND_CONFIDENCE", raising=False)

        indexer.run_calibration()

        assert "calibration skipped" in capsys.readouterr().out

    def test_the_env_opt_out_skips_the_pass_entirely(self, monkeypatch):
        """Records a flag rather than raising. run_calibration swallows every
        exception by design, so a raising spy would be caught and the test
        would pass whether the opt-out worked or not."""
        touched = []
        monkeypatch.setattr(indexer, "fts_conn", lambda: touched.append(1))
        monkeypatch.setenv("METALMIND_CONFIDENCE", "0")

        indexer.run_calibration()

        assert touched == []

    def test_a_refusal_is_reported_without_a_sidecar(self, monkeypatch, capsys, tmp_path):
        conn = sqlite3.connect(":memory:")
        conn.execute("CREATE TABLE chunks (file, heading, chunk_idx, text)")
        monkeypatch.setattr(indexer, "fts_conn", lambda: conn)
        monkeypatch.delenv("METALMIND_CONFIDENCE", raising=False)
        monkeypatch.setattr(indexer, "sidecar_path", lambda c: tmp_path / "c.json")
        monkeypatch.setattr(
            indexer, "embedding_backend", lambda: type("B", (), {"model_id": lambda s: "m", "dimension": lambda s: 4})()
        )

        indexer.run_calibration()

        assert "no confidence bands" in capsys.readouterr().out
        assert not (tmp_path / "c.json").exists()
