"""vault-doctor: hygiene checks for the Knowledge vault.

Usage: uv run doctor.py [--duplicates] [--orphans] [--dead-links] [--stale-inbox] [--all]
"""
import argparse
import re
import time
from collections import defaultdict
from pathlib import Path

from core import COLLECTION, VAULT, files_to_index, qdrant

WIKILINK = re.compile(r"\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]")
STALE_DAYS = 14
DUPE_THRESHOLD = 0.92


def parse_links(text: str) -> set[str]:
    return {m.group(1).strip() for m in WIKILINK.finditer(text)}


def file_index() -> dict[str, Path]:
    return {p.stem: p for p in files_to_index()}


def check_duplicates() -> None:
    print("\n== Near-duplicates (cosine > 0.92, cross-file) ==")
    c = qdrant()
    points, _ = c.scroll(COLLECTION, limit=10000, with_vectors=True, with_payload=True)
    seen: set[tuple[str, str]] = set()
    hits = 0
    for p in points:
        results = c.query_points(
            collection_name=COLLECTION, query=p.vector, limit=3
        ).points
        for r in results:
            if r.id == p.id or r.score < DUPE_THRESHOLD:
                continue
            if p.payload["file"] == r.payload["file"]:
                continue
            pair = tuple(sorted([str(p.id), str(r.id)]))
            if pair in seen:
                continue
            seen.add(pair)
            hits += 1
            print(
                f"  [{r.score:.3f}] {p.payload['file']} :: {p.payload['heading']}"
                f"  ↔  {r.payload['file']} :: {r.payload['heading']}"
            )
    print(f"  ({hits} pairs)")


def check_orphans() -> None:
    print("\n== Orphans (no in/out links, no tags) ==")
    index = file_index()
    incoming: dict[str, int] = defaultdict(int)
    outgoing: dict[str, int] = defaultdict(int)
    has_tags: dict[str, bool] = {}

    for f in index.values():
        text = f.read_text(encoding="utf-8", errors="ignore")
        links = parse_links(text)
        outgoing[f.stem] = len(links)
        has_tags[f.stem] = bool(re.search(r"^tags:\s*\[", text, re.MULTILINE)) or bool(
            re.search(r"#\w+", text)
        )
        for link in links:
            incoming[link] += 1

    hits = 0
    for stem, f in index.items():
        if incoming[stem] == 0 and outgoing[stem] == 0 and not has_tags[stem]:
            print(f"  {f.relative_to(VAULT)}")
            hits += 1
    print(f"  ({hits} orphans)")


def check_dead_links() -> None:
    print("\n== Dead wikilinks ==")
    index = file_index()
    hits = 0
    for f in index.values():
        text = f.read_text(encoding="utf-8", errors="ignore")
        for link in parse_links(text):
            if link not in index:
                print(f"  {f.relative_to(VAULT)}  →  [[{link}]]")
                hits += 1
    print(f"  ({hits} dead links)")


def check_stale_inbox() -> None:
    print(f"\n== Stale Inbox (>{STALE_DAYS} days) ==")
    cutoff = time.time() - STALE_DAYS * 86400
    hits = 0
    inbox = VAULT / "Inbox"
    if inbox.exists():
        for f in inbox.rglob("*.md"):
            if f.stat().st_mtime < cutoff:
                age_days = int((time.time() - f.stat().st_mtime) / 86400)
                print(f"  [{age_days}d] {f.relative_to(VAULT)}")
                hits += 1
    print(f"  ({hits} stale files)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--duplicates", action="store_true")
    ap.add_argument("--orphans", action="store_true")
    ap.add_argument("--dead-links", action="store_true")
    ap.add_argument("--stale-inbox", action="store_true")
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()

    run_any = args.duplicates or args.orphans or args.dead_links or args.stale_inbox
    if args.all or not run_any:
        args.duplicates = args.orphans = args.dead_links = args.stale_inbox = True

    if args.duplicates:
        check_duplicates()
    if args.orphans:
        check_orphans()
    if args.dead_links:
        check_dead_links()
    if args.stale_inbox:
        check_stale_inbox()


if __name__ == "__main__":
    main()
