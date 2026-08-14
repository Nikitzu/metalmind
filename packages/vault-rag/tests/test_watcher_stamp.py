"""Making an index that predates stamping identifiable.

Every install upgrading into this release has a populated index and no stamp.
Those indexes were built by code that still produces the current format, so the
honest record is a backfilled stamp, not a rebuild: telling a working install to
spend minutes reindexing to learn what is already known would be the cost
without the benefit.

The backfill has to happen for the arc to be worth anything. A format bump only
helps if the index it is compared against carries a version at all.
"""

import pytest

from metalmind_vault_rag import watcher
from metalmind_vault_rag.index_format import FORMAT_VERSION, IndexStamp, current_stamp, read_stamp, write_stamp

EMBEDDER = "fake-model@4"


class FakeBackend:
    def model_id(self):
        return "fake-model"

    def dimension(self):
        return 4


@pytest.fixture
def stubbed(tmp_path, monkeypatch):
    path = tmp_path / "vault.index.json"
    reindexed = []
    monkeypatch.setattr(watcher, "embedding_backend", lambda: FakeBackend())
    monkeypatch.setattr(watcher, "stamp_path", lambda collection: path)
    monkeypatch.setattr(watcher, "fts_row_count", lambda: 2970)
    monkeypatch.setattr(watcher, "fts_file_count", lambda: 341)
    monkeypatch.setattr(watcher, "reindex_all", lambda: reindexed.append(1))
    return path, reindexed


class TestBackfill:
    def test_a_populated_index_without_a_stamp_gains_one(self, stubbed):
        path, _ = stubbed

        watcher._maybe_stamp_index()

        stamp = read_stamp(path)
        assert stamp is not None
        assert stamp.format_version == FORMAT_VERSION
        assert (stamp.files, stamp.chunks) == (341, 2970)

    def test_the_backfill_never_reindexes(self, stubbed):
        _, reindexed = stubbed

        watcher._maybe_stamp_index()

        assert reindexed == []

    def test_an_empty_index_is_left_unstamped(self, stubbed, monkeypatch):
        path, _ = stubbed
        monkeypatch.setattr(watcher, "fts_row_count", lambda: 0)

        watcher._maybe_stamp_index()

        assert read_stamp(path) is None

    def test_an_existing_stamp_is_not_overwritten(self, stubbed):
        path, _ = stubbed
        write_stamp(path, current_stamp(embedder=EMBEDDER, files=1, chunks=1))
        before = read_stamp(path)

        watcher._maybe_stamp_index()

        assert read_stamp(path) == before


class TestStalenessReporting:
    def test_a_stale_index_is_reported(self, stubbed, capsys):
        path, _ = stubbed
        old = current_stamp(embedder=EMBEDDER, files=1, chunks=1)
        write_stamp(path, IndexStamp(**{**old.__dict__, "format_version": FORMAT_VERSION - 1}))

        watcher._maybe_stamp_index()

        assert "index rebuild" in capsys.readouterr().out

    def test_a_stale_index_is_not_silently_restamped(self, stubbed):
        """Rewriting the stamp would erase the only evidence that the index
        needs rebuilding, and the index itself would still be in the old
        format."""
        path, _ = stubbed
        old = current_stamp(embedder=EMBEDDER, files=1, chunks=1)
        write_stamp(path, IndexStamp(**{**old.__dict__, "format_version": FORMAT_VERSION - 1}))

        watcher._maybe_stamp_index()

        assert read_stamp(path).format_version == FORMAT_VERSION - 1

    def test_a_stale_index_is_never_rebuilt_without_asking(self, stubbed):
        path, reindexed = stubbed
        old = current_stamp(embedder=EMBEDDER, files=1, chunks=1)
        write_stamp(path, IndexStamp(**{**old.__dict__, "format_version": FORMAT_VERSION - 1}))

        watcher._maybe_stamp_index()

        assert reindexed == []

    def test_a_fresh_index_says_nothing(self, stubbed, capsys):
        path, _ = stubbed
        write_stamp(path, current_stamp(embedder=EMBEDDER, files=341, chunks=2970))

        watcher._maybe_stamp_index()

        assert capsys.readouterr().out == ""


class TestFailureIsNotFatal:
    def test_an_unreadable_index_does_not_stop_the_watcher(self, stubbed, monkeypatch, capsys):
        def boom():
            raise RuntimeError("database is locked")

        monkeypatch.setattr(watcher, "fts_row_count", boom)

        watcher._maybe_stamp_index()

        assert "index stamp" in capsys.readouterr().out.lower()


class _StopWatching(Exception):
    pass


class TestWiring:
    def test_main_stamps_before_it_calibrates(self, stubbed, monkeypatch):
        """Calibration queries the index; the format record describes it. If the
        order ever inverts, a stale index gets bands derived under a format the
        user is about to be told to replace."""
        order = []
        monkeypatch.setattr(watcher, "_install_log_rotation", lambda: None)
        monkeypatch.setattr(watcher, "_maybe_backfill", lambda: None)
        monkeypatch.setattr(watcher.http_server, "serve_forever", lambda: None)
        monkeypatch.setattr(watcher, "_maybe_stamp_index", lambda: order.append("stamp"))
        monkeypatch.setattr(watcher, "_maybe_calibrate", lambda: order.append("calibrate"))

        def stop(*args, **kwargs):
            raise _StopWatching

        monkeypatch.setattr(watcher, "watch", stop)

        with pytest.raises(_StopWatching):
            watcher.main()

        assert order == ["stamp", "calibrate"]
