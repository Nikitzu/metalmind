"""Reporting index format staleness.

The format version lives in Python. Rendering it from the CLI means either
duplicating the constant in TypeScript, where it would drift the first time
someone bumps one and not the other, or asking the side that owns it. This
endpoint is that ask, and it is what both `metalmind index status` and
`metalmind pulse` read.
"""

import json
import threading
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

from metalmind_vault_rag import doctor, http_server
from metalmind_vault_rag.index_format import FORMAT_VERSION, IndexStamp, current_stamp, write_stamp

EMBEDDER = "fake-model@4"


class FakeBackend:
    def model_id(self):
        return "fake-model"

    def dimension(self):
        return 4


@pytest.fixture
def stamped(tmp_path, monkeypatch):
    path = tmp_path / "vault.index.json"
    for mod in (doctor, http_server):
        monkeypatch.setattr(mod, "embedding_backend", lambda: FakeBackend(), raising=False)
        monkeypatch.setattr(mod, "stamp_path", lambda collection: path, raising=False)
    return path


def stale_stamp():
    fresh = current_stamp(embedder=EMBEDDER, files=341, chunks=2970)
    return IndexStamp(**{**fresh.__dict__, "format_version": FORMAT_VERSION - 1})


class TestDoctorCheck:
    def test_a_stale_index_is_a_warning_naming_the_fix(self, stamped, capsys):
        write_stamp(stamped, stale_stamp())

        doctor.check_index_format()
        out = capsys.readouterr().out

        assert "WARN" in out
        assert "index rebuild" in out

    def test_a_stale_index_names_both_formats(self, stamped, capsys):
        write_stamp(stamped, stale_stamp())

        doctor.check_index_format()
        out = capsys.readouterr().out

        assert str(FORMAT_VERSION - 1) in out
        assert str(FORMAT_VERSION) in out

    def test_a_current_index_reports_ok(self, stamped, capsys):
        write_stamp(stamped, current_stamp(embedder=EMBEDDER, files=341, chunks=2970))

        doctor.check_index_format()
        out = capsys.readouterr().out

        assert "OK" in out
        assert "WARN" not in out

    def test_an_unstamped_index_is_not_a_warning(self, stamped, capsys):
        doctor.check_index_format()
        out = capsys.readouterr().out

        assert "WARN" not in out

    def test_it_runs_as_part_of_index_health(self, stamped, capsys, monkeypatch):
        """Asserting the call appears in main's source proves nothing: the text
        survives inside a disabled branch. Run it."""
        write_stamp(stamped, current_stamp(embedder=EMBEDDER, files=1, chunks=1))
        monkeypatch.setattr(doctor, "check_fts_index", lambda: None)
        monkeypatch.setattr("sys.argv", ["metalmind-vault-rag-doctor", "--fts"])

        doctor.main()

        assert "== Index format ==" in capsys.readouterr().out


@pytest.fixture
def server(monkeypatch):
    monkeypatch.setenv("METALMIND_RECALL_REQUIRE_TOKEN", "0")
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), http_server._Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


def get_status(base):
    with urllib.request.urlopen(f"{base}/index/status", timeout=5) as resp:
        return json.loads(resp.read())


class TestStatusEndpoint:
    def test_reports_a_current_index_as_not_stale(self, server, stamped):
        write_stamp(stamped, current_stamp(embedder=EMBEDDER, files=341, chunks=2970))

        body = get_status(server)

        assert body["stale"] is False
        assert body["format_version"] == FORMAT_VERSION
        assert body["expected_format_version"] == FORMAT_VERSION
        assert (body["files"], body["chunks"]) == (341, 2970)

    def test_reports_a_stale_index_with_both_versions(self, server, stamped):
        write_stamp(stamped, stale_stamp())

        body = get_status(server)

        assert body["stale"] is True
        assert body["format_version"] == FORMAT_VERSION - 1
        assert body["expected_format_version"] == FORMAT_VERSION

    def test_an_unstamped_index_is_reported_as_absent_not_stale(self, server, stamped):
        body = get_status(server)

        assert body["stamped"] is False
        assert body["stale"] is False

    def test_carries_the_confidence_bands_when_they_exist(self, server, stamped, monkeypatch, tmp_path):
        from metalmind_vault_rag.calibration import Bands, write_sidecar

        sidecar = tmp_path / "vault.calibration.json"
        write_sidecar(sidecar, Bands(0.7051, 0.648), EMBEDDER, positives_n=150, probes_n=67)
        monkeypatch.setattr(http_server, "sidecar_path", lambda collection: sidecar, raising=False)

        body = get_status(server)

        assert body["bands"] == {"low_edge": 0.7051, "high_edge": 0.648}

    def test_omits_bands_when_the_vault_has_none(self, server, stamped):
        body = get_status(server)

        assert body["bands"] is None
