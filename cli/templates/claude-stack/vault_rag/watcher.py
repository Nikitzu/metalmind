"""Watch the vault and re-run the indexer when markdown files change.

Debounced so bursts of saves only trigger one reindex.
"""
import subprocess
import sys
import time
from pathlib import Path

from watchfiles import watch

VAULT = Path.home() / "Knowledge"
INDEXER = Path(__file__).parent / "indexer.py"
DEBOUNCE_SECONDS = 3.0


def should_trigger(changes) -> bool:
    return any(
        p.endswith(".md") and ".obsidian" not in p and ".claude-stack" not in p
        for _, p in changes
    )


def main() -> None:
    print(f"watching {VAULT}", flush=True)
    last_run = 0.0
    pending = False
    for changes in watch(str(VAULT), recursive=True, step=1000):
        if not should_trigger(changes):
            continue
        pending = True
        now = time.time()
        if now - last_run < DEBOUNCE_SECONDS:
            continue
        if pending:
            print(f"reindexing ({len(changes)} changes)", flush=True)
            subprocess.run([sys.executable, str(INDEXER)], check=False)
            last_run = time.time()
            pending = False


if __name__ == "__main__":
    main()
