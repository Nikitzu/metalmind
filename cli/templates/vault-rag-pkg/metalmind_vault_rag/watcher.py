"""Watch the vault and re-embed changed markdown files (incremental upsert).
Also hosts a loopback HTTP server so `metalmind tap copper` can bypass the
per-call MCP stdio spawn cost.

Batches burst saves within DEBOUNCE_SECONDS, then upserts only the changed
files. Never wipes the collection — queries remain answerable during reindex.

The watch loop sets ``yield_on_timeout`` so the iterator wakes up periodically
even when no files changed. Without that, a single save that landed inside the
debounce window would sit unindexed until *some other* change re-entered the
loop — the "lone-save starvation" bug.

All stdout/stderr output is also tee'd to ``~/.metalmind/logs/watcher.log``
with rotation (5 MB × 3 backups) so the long-running watcher never fills the
disk with unrotated log output.
"""
import logging
import sys
import time
from logging.handlers import RotatingFileHandler
from pathlib import Path

from watchfiles import watch

from . import http_server
from .core import VAULT
from .indexer import reindex_paths

DEBOUNCE_SECONDS = 2.0
TICK_MS = 1_000  # watch() heartbeat → worst-case flush latency = DEBOUNCE + TICK
LOG_DIR = Path.home() / ".metalmind" / "logs"
LOG_MAX_BYTES = 5_000_000
LOG_BACKUPS = 3


class _TeeStream:
    """Mirrors writes to both the original stream and a rotating file handler.
    Keeps launchd's StandardOutPath working while capping disk usage."""

    def __init__(self, stream, handler: logging.Handler) -> None:
        self._stream = stream
        self._handler = handler

    def write(self, msg: str) -> int:
        if msg and not msg.isspace():
            record = logging.LogRecord(
                name="metalmind-watcher",
                level=logging.INFO,
                pathname="",
                lineno=0,
                msg=msg.rstrip("\n"),
                args=None,
                exc_info=None,
            )
            self._handler.emit(record)
        return self._stream.write(msg)

    def flush(self) -> None:
        self._stream.flush()
        self._handler.flush()


def _install_log_rotation() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(
        LOG_DIR / "watcher.log",
        maxBytes=LOG_MAX_BYTES,
        backupCount=LOG_BACKUPS,
    )
    handler.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
    sys.stdout = _TeeStream(sys.stdout, handler)
    sys.stderr = _TeeStream(sys.stderr, handler)


def _md_change(path: str) -> bool:
    return path.endswith(".md") and ".obsidian" not in path and ".metalmind-stack" not in path


def main() -> None:
    _install_log_rotation()
    print(f"watching {VAULT}", flush=True)
    # Fire up the co-hosted HTTP recall endpoint (127.0.0.1 only). If the port
    # is busy or binding fails, watcher keeps working — CLI falls back to stdio.
    http_server.serve_forever()
    pending: set[Path] = set()
    first_pending_ts = 0.0

    for changes in watch(
        str(VAULT),
        recursive=True,
        step=500,
        yield_on_timeout=True,
        rust_timeout=TICK_MS,
    ):
        for _change_kind, path in changes:
            if _md_change(path):
                if not pending:
                    first_pending_ts = time.time()
                pending.add(Path(path))

        if not pending:
            continue

        # Flush once the oldest pending item has aged past DEBOUNCE_SECONDS —
        # not when the last flush is fresh. A single save without a follow-up
        # still gets indexed within DEBOUNCE + TICK_MS.
        if time.time() - first_pending_ts < DEBOUNCE_SECONDS:
            continue

        batch = sorted(pending)
        pending.clear()
        first_pending_ts = 0.0
        print(f"reindexing {len(batch)} file(s)", flush=True)
        try:
            reindex_paths(batch)
        except Exception as e:
            print(f"indexer failed: {e}", flush=True)


if __name__ == "__main__":
    main()
