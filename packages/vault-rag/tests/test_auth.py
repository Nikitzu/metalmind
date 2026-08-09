"""Recall auth token: generation, validation, and the HTTP gate.

Grace mode (default) serves tokenless requests with a warning so an updated
watcher never breaks an older CLI; METALMIND_RECALL_REQUIRE_TOKEN=1 enforces.
Browser-origin requests are rejected in both modes.
"""

import json
import stat
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

from metalmind_vault_rag import auth, http_server


@pytest.fixture
def token_file(tmp_path, monkeypatch):
    path = tmp_path / "recall-token"
    monkeypatch.setenv("METALMIND_RECALL_TOKEN_PATH", str(path))
    return path


class TestTokenFile:
    def test_ensure_creates_0600_and_is_stable(self, token_file):
        first = auth.ensure_token()
        mode = stat.S_IMODE(token_file.stat().st_mode)
        assert mode == 0o600
        assert auth.ensure_token() == first

    def test_is_valid_accepts_only_the_stored_token(self, token_file):
        token = auth.ensure_token()
        assert auth.is_valid(token)
        assert auth.is_valid(f"  {token}\n")
        assert not auth.is_valid("wrong")
        assert not auth.is_valid("")

    def test_is_valid_is_false_without_a_file(self, token_file):
        assert not auth.is_valid("anything")


@pytest.fixture
def server(token_file, monkeypatch):
    monkeypatch.setattr(http_server, "_warned_tokenless", False)
    srv = ThreadingHTTPServer(("127.0.0.1", 0), http_server._Handler)
    import threading

    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def post(endpoint, path, body, headers=None):
    req = urllib.request.Request(
        f"{endpoint}{path}",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", **(headers or {})},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as res:
            return res.status, json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))


class TestHttpGate:
    def test_browser_origin_is_rejected_even_with_valid_token(self, server):
        token = auth.ensure_token()
        status, body = post(
            server,
            "/search",
            {"query": "q"},
            {"Origin": "https://evil.example", auth.HEADER: token},
        )
        assert status == 403
        assert "browser-origin" in body["error"]

    def test_optional_mode_serves_tokenless_requests(self, server, monkeypatch):
        monkeypatch.delenv("METALMIND_RECALL_REQUIRE_TOKEN", raising=False)
        status, body = post(server, "/search", {"query": ""})
        assert status == 400
        assert body["error"] == "query is required"

    def test_enforced_mode_rejects_tokenless_requests(self, server, monkeypatch):
        monkeypatch.setenv("METALMIND_RECALL_REQUIRE_TOKEN", "1")
        auth.ensure_token()
        status, body = post(server, "/search", {"query": "q"})
        assert status == 403
        assert auth.HEADER in body["error"]

    def test_enforced_mode_serves_with_valid_token(self, server, monkeypatch):
        monkeypatch.setenv("METALMIND_RECALL_REQUIRE_TOKEN", "1")
        token = auth.ensure_token()
        status, body = post(server, "/search", {"query": ""}, {auth.HEADER: token})
        assert status == 400
        assert body["error"] == "query is required"

    def test_auth_status_reports_mode_and_file(self, server, token_file):
        auth.ensure_token()
        with urllib.request.urlopen(f"{server}/auth/status", timeout=5) as res:
            body = json.loads(res.read().decode("utf-8"))
        assert body["token_present"] is True
        assert body["mode"] == "optional"
        assert body["token_file"] == str(token_file)
