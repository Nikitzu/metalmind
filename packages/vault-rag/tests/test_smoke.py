"""Smoke tests for the metalmind-vault-rag package.

Run from the package root: `uv run --extra dev pytest` (or equivalent).
These cover: imports work, the HTTP server handles requests correctly with
search mocked out, and the chunker/point-id helpers match expected shapes.
"""
import json
import threading
import urllib.request
from http.server import ThreadingHTTPServer
from unittest.mock import patch

import pytest

# Import-time checks — fail fast if any module has a syntax/import error.
from metalmind_vault_rag import (  # noqa: F401
    core,
    doctor,
    http_server,
    indexer,
    search,
    server,
    watcher,
)


def test_all_modules_expose_expected_entrypoints() -> None:
    """Every binary declared in pyproject.toml needs a main() in its module."""
    assert callable(getattr(indexer, "main", None))
    assert callable(getattr(watcher, "main", None))
    assert callable(getattr(server, "main", None))
    assert callable(getattr(doctor, "main", None))
    assert callable(getattr(http_server, "main", None))


def test_chunk_markdown_splits_on_headings() -> None:
    text = "# Top\nalpha\n## Sub\nbeta\n## Sub2\ngamma\n"
    chunks = core.chunk_markdown(text)
    assert [hp for hp, _ in chunks] == ["Top", "Top / Sub", "Top / Sub2"]


def test_chunk_markdown_splits_large_sections() -> None:
    big = "x" * (core.MAX_CHUNK_CHARS * 2 + 100)
    text = f"# Big\n{big}\n"
    chunks = core.chunk_markdown(text)
    assert len(chunks) >= 3  # split into at least 3 pieces


def test_point_id_is_stable_for_same_inputs() -> None:
    a = core.point_id("file.md", "heading", 0)
    b = core.point_id("file.md", "heading", 0)
    c = core.point_id("file.md", "heading", 1)
    assert a == b
    assert a != c


def test_parse_links_extracts_wikilinks() -> None:
    assert set(search.parse_links("see [[note-a]] and [[note-b#anchor]]")) == {
        "note-a",
        "note-b",
    }
    assert search.parse_links("no links here") == []


def test_http_server_health_endpoint() -> None:
    """Boot the server on a random port, hit /health, tear down."""
    server_obj = ThreadingHTTPServer(("127.0.0.1", 0), http_server._Handler)
    port = server_obj.server_address[1]
    thread = threading.Thread(target=server_obj.serve_forever, daemon=True)
    thread.start()
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=2) as resp:
            assert resp.status == 200
            body = json.loads(resp.read().decode("utf-8"))
            assert body["ok"] is True
    finally:
        server_obj.shutdown()
        server_obj.server_close()


def test_http_server_search_delegates_to_search_module() -> None:
    fake_hits = [
        {"file": "x.md", "heading": "(root)", "score": 0.9, "text": "body"},
    ]
    with patch.object(search, "search_vault", return_value=fake_hits) as m:
        server_obj = ThreadingHTTPServer(("127.0.0.1", 0), http_server._Handler)
        port = server_obj.server_address[1]
        thread = threading.Thread(target=server_obj.serve_forever, daemon=True)
        thread.start()
        try:
            req = urllib.request.Request(
                f"http://127.0.0.1:{port}/search",
                data=json.dumps({"query": "hello", "k": 3}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=2) as resp:
                assert resp.status == 200
                body = json.loads(resp.read().decode("utf-8"))
                assert body["hits"] == fake_hits
            m.assert_called_once_with("hello", 3, rerank=False)
        finally:
            server_obj.shutdown()
            server_obj.server_close()


def test_http_server_search_forwards_rerank_flag() -> None:
    """?rerank=true on /search body must flow through to search_vault."""
    with patch.object(search, "search_vault", return_value=[]) as m:
        server_obj = ThreadingHTTPServer(("127.0.0.1", 0), http_server._Handler)
        port = server_obj.server_address[1]
        thread = threading.Thread(target=server_obj.serve_forever, daemon=True)
        thread.start()
        try:
            req = urllib.request.Request(
                f"http://127.0.0.1:{port}/search",
                data=json.dumps({"query": "hello", "k": 3, "rerank": True}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=2) as resp:
                assert resp.status == 200
            m.assert_called_once_with("hello", 3, rerank=True)
        finally:
            server_obj.shutdown()
            server_obj.server_close()


def test_http_server_rejects_empty_query() -> None:
    server_obj = ThreadingHTTPServer(("127.0.0.1", 0), http_server._Handler)
    port = server_obj.server_address[1]
    thread = threading.Thread(target=server_obj.serve_forever, daemon=True)
    thread.start()
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/search",
            data=json.dumps({"query": ""}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with pytest.raises(urllib.error.HTTPError) as exc:
            urllib.request.urlopen(req, timeout=2)
        assert exc.value.code == 400
    finally:
        server_obj.shutdown()
        server_obj.server_close()
