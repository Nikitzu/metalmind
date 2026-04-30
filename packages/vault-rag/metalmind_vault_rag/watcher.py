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
import os
import sys
import time
from logging.handlers import RotatingFileHandler
from pathlib import Path

from watchfiles import watch

from . import http_server
from .core import COLLECTION, VAULT, files_to_index, fts_row_count, vector_store
from .indexer import reindex_all, reindex_paths

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


def _maybe_backfill() -> None:
    """One-shot reindex for upgraders.

    Triggers when either the vector store or the FTS5 index is empty
    while source files exist on disk. Two upgrade paths land here:

    - v0.4.x → v0.5.0 (Qdrant + Ollama → sqlite-vec + fastembed): the
      old Qdrant collection becomes orphaned (different embedding model
      = different vectors). The new sqlite-vec store starts empty;
      this rebuild fills it from source.
    - v0.2.x → v0.3.0+ (FTS5 introduced): the older case the original
      `_maybe_backfill_fts` handled. Same code path now.

    Cheap at typical vault sizes (~1 min for 1000 notes on M1). Set
    ``VAULT_NO_FTS_BACKFILL=1`` to defer if needed.
    """
    if os.environ.get("VAULT_NO_FTS_BACKFILL") == "1":
        return
    try:
        fts_rows = fts_row_count()
    except Exception as e:
        print(f"backfill: could not read FTS5 row count ({e}); skipping check", flush=True)
        return
    try:
        store = vector_store()
        vec_points = store.count() if store.collection_exists() else 0
    except Exception as e:
        print(f"backfill: could not read vector store count ({e}); skipping check", flush=True)
        return

    if vec_points > 0 and fts_rows > 0:
        return  # both populated — happy path

    files = files_to_index()
    if not files:
        return  # empty vault, nothing to do

    reason_bits: list[str] = []
    if vec_points == 0:
        reason_bits.append("vector store empty")
    if fts_rows == 0:
        reason_bits.append("FTS5 empty")
    print(
        f"backfill: {' / '.join(reason_bits)} with {len(files)} source files present "
        f"— reindexing once (~1 min per 1k notes on M1).",
        flush=True,
    )
    try:
        reindex_all()
    except Exception as e:
        print(
            f"backfill failed: {e}; recall will be degraded until you run "
            f"`metalmind-vault-rag-indexer`",
            flush=True,
        )


# Backwards-compatible alias for the old name in case anyone imports it.
_maybe_backfill_fts = _maybe_backfill


def main() -> None:
    _install_log_rotation()
    print(f"watching {VAULT}", flush=True)
    _maybe_backfill()
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
