"""Append-only NDJSON log of recall queries. Opt-in via METALMIND_RECALL_LOG_PATH.

Used by `metalmind doctor --recall-audit` to replay the last N days of queries,
flag zero-hit ones, and rank them as `/save` candidates. Local-only by design:
the file lives on disk, never leaves the machine, and the CLI never reads it
without the user explicitly invoking the audit subcommand.

Format (one JSON object per line):
    {"ts": "2026-05-01T08:30:00Z", "query": "...", "mode": "hybrid",
     "rerank": false, "k": 5, "hit_count": 3, "top_files": [...], "top_score": 0.71}

The `query` is captured verbatim - same caveat as shell history. If you don't
want it, don't enable the log."""
from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_lock = threading.Lock()
_path_cache: Path | None = None
_path_resolved = False


def log_path() -> Path | None:
    """Return the configured log path, or None if logging is disabled."""
    global _path_cache, _path_resolved
    if not _path_resolved:
        raw = os.environ.get("METALMIND_RECALL_LOG_PATH")
        _path_cache = Path(raw).expanduser() if raw else None
        _path_resolved = True
    return _path_cache


def is_enabled() -> bool:
    return log_path() is not None


def record(
    query: str,
    *,
    mode: str,
    rerank: bool,
    k: int,
    hits: list[dict[str, Any]],
) -> None:
    """Append one query record. Best-effort: any error is swallowed so a log
    failure cannot break the search response. Caller is on the request thread,
    so this needs to be cheap - a single appended line is fine for normal vaults."""
    path = log_path()
    if path is None:
        return
    top = hits[:k]
    record = {
        "ts": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "query": query,
        "mode": mode,
        "rerank": rerank,
        "k": k,
        "hit_count": len(top),
        "top_files": [str(h.get("file") or h.get("path") or "") for h in top],
        "top_score": top[0].get("score") if top else None,
    }
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(record, separators=(",", ":")) + "\n"
        with _lock, path.open("a", encoding="utf-8") as f:
            f.write(line)
    except OSError:
        return
