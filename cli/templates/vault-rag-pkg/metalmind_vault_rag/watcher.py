"""Watch the vault and re-embed changed markdown files (incremental upsert).

Batches burst saves within DEBOUNCE_SECONDS, then upserts only the changed
files. Never wipes the collection — queries remain answerable during reindex.
"""
import time
from pathlib import Path

from watchfiles import watch

from .core import VAULT
from .indexer import reindex_paths

DEBOUNCE_SECONDS = 2.0


def _md_change(path: str) -> bool:
    return path.endswith(".md") and ".obsidian" not in path and ".metalmind-stack" not in path


def main() -> None:
    print(f"watching {VAULT}", flush=True)
    pending: set[Path] = set()
    last_flush = 0.0

    for changes in watch(str(VAULT), recursive=True, step=500):
        for _change_kind, path in changes:
            if _md_change(path):
                pending.add(Path(path))

        if not pending:
            continue

        now = time.time()
        if now - last_flush < DEBOUNCE_SECONDS:
            continue

        batch = sorted(pending)
        pending.clear()
        print(f"reindexing {len(batch)} file(s)", flush=True)
        try:
            reindex_paths(batch)
        except Exception as e:
            print(f"indexer failed: {e}", flush=True)
        last_flush = time.time()


if __name__ == "__main__":
    main()
