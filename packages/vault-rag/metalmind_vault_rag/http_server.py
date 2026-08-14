"""Loopback HTTP recall endpoint. Co-hosted inside the watcher process so that
`metalmind tap copper` can hit a long-running server instead of spawning a new
Python MCP every call. Bound to 127.0.0.1 only - nothing leaves the machine."""
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import auth, recall_log, search
from .indexer import reindex_paths

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = int(os.environ.get("VAULT_HTTP_PORT", "17317"))

_warned_tokenless = False


def _auth_gate(handler: "_Handler") -> bool:
    """True when the request may proceed. Browser-origin requests are always
    rejected (a web page can fire POSTs at localhost; no CLI sends Origin).
    Token mismatches reject only under METALMIND_RECALL_REQUIRE_TOKEN=1,
    which is the shared-machine setting; otherwise they are served with one
    note per process."""
    global _warned_tokenless
    if handler.headers.get("Origin"):
        handler._send_json(403, {"error": "browser-origin requests are not allowed"})
        return False
    supplied = handler.headers.get(auth.HEADER, "")
    if auth.is_valid(supplied):
        return True
    if auth.enforcement_enabled():
        handler._send_json(403, {"error": f"missing or invalid {auth.HEADER}"})
        return False
    if not _warned_tokenless:
        _warned_tokenless = True
        print(
            f"http recall: serving requests without {auth.HEADER}; "
            "set METALMIND_RECALL_REQUIRE_TOKEN=1 to require it on a shared machine",
            flush=True,
        )
    return True


class _Handler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, body: object) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or "0")
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send_json(200, {"ok": True, "service": "metalmind-vault-rag"})
        elif self.path == "/auth/status":
            self._send_json(
                200,
                {
                    "token_file": str(auth.token_path()),
                    "token_present": auth.token_path().exists(),
                    "mode": "enforced" if auth.enforcement_enabled() else "optional",
                },
            )
        elif self.path == "/rerank/status":
            # CLI probes this before issuing a `--rerank` call. If `available`
            # is false, the CLI auto-installs the [rerank] extra and restarts
            # the watcher so the user never sees a raw `uv tool install …`
            # command in docs.
            from . import rerank as rerank_mod
            self._send_json(200, {"available": rerank_mod.is_dep_available()})
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if not _auth_gate(self):
            return
        body = self._read_json()
        try:
            if self.path == "/search":
                query = str(body.get("query", ""))
                k = int(body.get("k") or 5)
                rerank = bool(body.get("rerank"))
                mode = str(body.get("mode") or "hybrid")
                neighbors = bool(body.get("neighbors"))
                if not query.strip():
                    self._send_json(400, {"error": "query is required"})
                    return
                hits = search.search_vault(query, k, rerank=rerank, mode=mode)
                if neighbors:
                    search.attach_neighbors(hits)
                recall_log.record(query, mode=mode, rerank=rerank, k=k, hits=hits)
                payload = {"hits": hits}
                confidence = search.result_confidence(hits)
                if confidence:
                    payload["confidence"] = confidence
                self._send_json(200, payload)
            elif self.path == "/expand":
                query = str(body.get("query", ""))
                k = int(body.get("k") or 5)
                if not query.strip():
                    self._send_json(400, {"error": "query is required"})
                    return
                self._send_json(200, search.expand_search(query, k))
            elif self.path == "/related":
                file = str(body.get("file", ""))
                if not file.strip():
                    self._send_json(400, {"error": "file is required"})
                    return
                self._send_json(200, search.related_notes(file))
            elif self.path == "/reindex":
                raw_paths = body.get("paths") or []
                if not isinstance(raw_paths, list) or not raw_paths:
                    self._send_json(400, {"error": "paths must be a non-empty list"})
                    return
                paths = [Path(str(p)) for p in raw_paths if p]
                count = reindex_paths(paths)
                self._send_json(200, {"ok": True, "upserted": count, "files": len(paths)})
            else:
                self._send_json(404, {"error": "not found"})
        except Exception as e:  # pragma: no cover - defensive
            self._send_json(500, {"error": str(e)})

    # Silence the default BaseHTTPRequestHandler access-log noise.
    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        return


def serve_forever(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> ThreadingHTTPServer | None:
    """Start the HTTP recall server. Returns the server instance, or None if
    the port was already in use (watcher continues without HTTP)."""
    try:
        auth.ensure_token()
    except OSError as e:
        print(f"http recall: could not write auth token ({e}); grace mode only", flush=True)
    try:
        server = ThreadingHTTPServer((host, port), _Handler)
    except OSError as e:
        print(f"http recall: port {port} unavailable ({e}); continuing without HTTP", flush=True)
        return None
    print(f"http recall: listening on http://{host}:{port}", flush=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True, name="metalmind-http-recall")
    thread.start()
    return server


def main() -> None:
    """Entry point for running the HTTP server standalone (diagnostics)."""
    auth.ensure_token()
    server = ThreadingHTTPServer((DEFAULT_HOST, DEFAULT_PORT), _Handler)
    print(f"http recall: listening on http://{DEFAULT_HOST}:{DEFAULT_PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
