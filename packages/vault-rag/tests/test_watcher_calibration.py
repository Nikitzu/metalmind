"""Calibrating an install that upgraded without reindexing.

0.20.0 hooked calibration to a full reindex, and the watcher only rebuilds when
the index is empty. A populated vault therefore upgraded, restarted and got
nothing, with no user-facing command to trigger it since `metalmind reindex` is
retired. The watcher now calibrates on startup when the collection has no bands
of its own, which costs seconds against the index already on disk rather than
the minutes a rebuild would.
"""

import pytest

from metalmind_vault_rag import watcher
from metalmind_vault_rag.calibration import Bands, write_sidecar

EMBEDDER = "fake-model@4"


class FakeBackend:
    def model_id(self):
        return "fake-model"

    def dimension(self):
        return 4


@pytest.fixture
def stubbed(tmp_path, monkeypatch):
    calls = []
    path = tmp_path / "vault.calibration.json"
    monkeypatch.setattr(watcher, "embedding_backend", lambda: FakeBackend())
    monkeypatch.setattr(watcher, "sidecar_path", lambda collection: path)
    monkeypatch.setattr(watcher, "fts_row_count", lambda: 2970)
    monkeypatch.setattr(watcher, "run_calibration", lambda: calls.append(1))
    monkeypatch.delenv("METALMIND_CONFIDENCE", raising=False)
    return calls, path


class TestStartupCalibration:
    def test_calibrates_when_the_collection_has_no_bands(self, stubbed):
        calls, _ = stubbed

        watcher._maybe_calibrate()

        assert calls == [1]

    def test_skips_when_bands_already_exist(self, stubbed):
        calls, path = stubbed
        write_sidecar(path, Bands(0.70, 0.64), EMBEDDER, positives_n=150, probes_n=67)

        watcher._maybe_calibrate()

        assert calls == []

    def test_recalibrates_when_the_bands_came_from_another_embedder(self, stubbed):
        calls, path = stubbed
        write_sidecar(path, Bands(0.70, 0.64), "other@768", positives_n=150, probes_n=67)

        watcher._maybe_calibrate()

        assert calls == [1]

    def test_skips_an_empty_index(self, stubbed, monkeypatch):
        calls, _ = stubbed
        monkeypatch.setattr(watcher, "fts_row_count", lambda: 0)

        watcher._maybe_calibrate()

        assert calls == []

    def test_skips_when_confidence_is_disabled(self, stubbed, monkeypatch):
        calls, _ = stubbed
        monkeypatch.setenv("METALMIND_CONFIDENCE", "0")

        watcher._maybe_calibrate()

        assert calls == []

    def test_an_unreadable_index_does_not_stop_the_watcher(self, stubbed, monkeypatch):
        calls, _ = stubbed

        def boom():
            raise RuntimeError("database is locked")

        monkeypatch.setattr(watcher, "fts_row_count", boom)

        watcher._maybe_calibrate()

        assert calls == []


class _StopWatching(Exception):
    """Breaks main() out of its watch loop once startup has run."""


class TestStartupWiring:
    def test_main_calibrates_before_entering_the_watch_loop(self, stubbed, monkeypatch):
        """The guards above are inert if nothing calls them. This release
        exists because the call site was missing, not the logic."""
        calls, _ = stubbed
        order = []
        monkeypatch.setattr(watcher, "_install_log_rotation", lambda: None)
        monkeypatch.setattr(watcher, "_maybe_backfill", lambda: None)
        monkeypatch.setattr(watcher, "_maybe_stamp_index", lambda: None)
        monkeypatch.setattr(watcher.http_server, "serve_forever", lambda: order.append("serve"))
        monkeypatch.setattr(watcher, "_maybe_calibrate", lambda: order.append("calibrate"))

        def stop(*args, **kwargs):
            raise _StopWatching

        monkeypatch.setattr(watcher, "watch", stop)

        with pytest.raises(_StopWatching):
            watcher.main()

        assert order == ["serve", "calibrate"]
