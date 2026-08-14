"""Reporting confidence on a result set.

The signal is advisory. It never reorders, filters or removes a hit, and a
vault without calibration behaves exactly as it did before the feature
existed: no field, no warning, nothing for a caller to handle.
"""

import json
import time
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

from metalmind_vault_rag import calibration, http_server, search
from metalmind_vault_rag.calibration import Bands, write_sidecar

EMBEDDER = "fake-model@4"


class FakeBackend:
    def __init__(self, model="fake-model", dim=4):
        self._model = model
        self._dim = dim

    def model_id(self):
        return self._model

    def dimension(self):
        return self._dim


@pytest.fixture
def calibrated(tmp_path, monkeypatch):
    path = tmp_path / "vault.calibration.json"
    monkeypatch.setattr(search, "embedding_backend", lambda: FakeBackend())
    monkeypatch.setattr(search, "sidecar_path", lambda collection: path)
    monkeypatch.delenv("METALMIND_CONFIDENCE", raising=False)
    calibration._BANDS_CACHE = None
    return path


def hits(*scores):
    return [{"file": "a.md", "heading": "h", "text": "t", "sem_score": s} for s in scores]


class TestResultConfidence:
    def test_reports_high_above_the_low_edge(self, calibrated):
        write_sidecar(calibrated, Bands(0.70, 0.64), EMBEDDER, positives_n=150, probes_n=67)

        assert search.result_confidence(hits(0.2, 0.85)) == "high"

    def test_reports_medium_between_the_edges(self, calibrated):
        write_sidecar(calibrated, Bands(0.70, 0.64), EMBEDDER, positives_n=150, probes_n=67)

        assert search.result_confidence(hits(0.66)) == "medium"

    def test_reports_low_below_the_high_edge(self, calibrated):
        write_sidecar(calibrated, Bands(0.70, 0.64), EMBEDDER, positives_n=150, probes_n=67)

        assert search.result_confidence(hits(0.40)) == "low"

    def test_an_empty_result_set_is_low(self, calibrated):
        write_sidecar(calibrated, Bands(0.70, 0.64), EMBEDDER, positives_n=150, probes_n=67)

        assert search.result_confidence([]) == "low"

    def test_an_uncalibrated_vault_reports_nothing(self, calibrated):
        assert search.result_confidence(hits(0.85)) is None

    def test_a_sidecar_from_another_embedder_reports_nothing(self, calibrated):
        write_sidecar(calibrated, Bands(0.70, 0.64), "other-model@768", positives_n=150, probes_n=67)

        assert search.result_confidence(hits(0.85)) is None

    def test_the_env_opt_out_reports_nothing(self, calibrated, monkeypatch):
        write_sidecar(calibrated, Bands(0.70, 0.64), EMBEDDER, positives_n=150, probes_n=67)
        monkeypatch.setenv("METALMIND_CONFIDENCE", "0")

        assert search.result_confidence(hits(0.85)) is None

    def test_does_not_touch_the_hits(self, calibrated):
        write_sidecar(calibrated, Bands(0.70, 0.64), EMBEDDER, positives_n=150, probes_n=67)
        original = hits(0.85, 0.2)
        snapshot = json.dumps(original)

        search.result_confidence(original)

        assert json.dumps(original) == snapshot


    def test_swapping_the_embedder_stops_reporting_stale_bands(self, calibrated, monkeypatch):
        """The identity has to come from the live backend on every call. A
        constant that happens to match the fixture would pass every other test
        here while silently reporting bands derived under a different model."""
        write_sidecar(calibrated, Bands(0.70, 0.64), EMBEDDER, positives_n=150, probes_n=67)
        assert search.result_confidence(hits(0.85)) == "high"

        monkeypatch.setattr(search, "embedding_backend", lambda: FakeBackend("other-model", 768))

        assert search.result_confidence(hits(0.85)) is None


class TestBandsCache:
    def test_recalibration_is_picked_up_without_a_restart(self, calibrated):
        """The watcher is long lived and calibration runs inside it, so bands
        written mid-process have to take effect without a restart."""
        write_sidecar(calibrated, Bands(0.70, 0.64), EMBEDDER, positives_n=150, probes_n=67)
        assert search.result_confidence(hits(0.66)) == "medium"

        time.sleep(0.01)
        write_sidecar(calibrated, Bands(0.60, 0.50), EMBEDDER, positives_n=150, probes_n=67)

        assert search.result_confidence(hits(0.66)) == "high"

    def test_a_deleted_sidecar_stops_being_reported(self, calibrated):
        write_sidecar(calibrated, Bands(0.70, 0.64), EMBEDDER, positives_n=150, probes_n=67)
        assert search.result_confidence(hits(0.85)) == "high"

        calibrated.unlink()

        assert search.result_confidence(hits(0.85)) is None


@pytest.fixture
def server(monkeypatch):
    monkeypatch.setenv("METALMIND_RECALL_REQUIRE_TOKEN", "0")
    monkeypatch.setattr(
        http_server.search, "search_vault", lambda q, k, rerank=False, mode="hybrid": hits(0.85)
    )
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), http_server._Handler)
    import threading

    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


def post_search(base):
    req = urllib.request.Request(
        f"{base}/search",
        data=json.dumps({"query": "anything", "k": 5}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read())


class TestSearchPayload:
    def test_carries_confidence_when_calibrated(self, server, calibrated):
        write_sidecar(calibrated, Bands(0.70, 0.64), EMBEDDER, positives_n=150, probes_n=67)

        assert post_search(server)["confidence"] == "high"

    def test_omits_the_field_entirely_when_uncalibrated(self, server, calibrated):
        payload = post_search(server)

        assert "confidence" not in payload
        assert payload["hits"]
