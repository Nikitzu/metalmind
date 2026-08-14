"""vault-doctor: hygiene checks for the Knowledge vault."""
import argparse
import json
import os
import re
import time
from collections import defaultdict
from pathlib import Path

from . import recall_log
from . import rerank as rerank_mod
from .calibration import embedder_id
from .core import COLLECTION, VAULT, embedding_backend, files_to_index, fts_row_count, vector_store
from .index_format import FORMAT_VERSION, is_stale, read_stamp, stamp_path

WIKILINK = re.compile(r"\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]")
STALE_DAYS = 14
STALE_VAULT_DAYS = int(os.environ.get("METALMIND_STALE_VAULT_DAYS", "90"))
STALE_SKIP_TOP_DIRS = {"Archive", "Daily"}


def parse_links(text: str) -> set[str]:
    return {m.group(1).strip() for m in WIKILINK.finditer(text)}


def file_index() -> dict[str, Path]:
    return {p.stem: p for p in files_to_index()}


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


def check_fts_index() -> None:
    """FTS5 backs the keyword half of hybrid recall. A zero-row FTS5 table
    alongside a non-empty Qdrant collection means hybrid search silently
    degrades to semantic-only - exactly the class of bug the v0.3.0 upgrade
    path was supposed to close."""
    print("\n== FTS5 keyword index ==")
    try:
        fts_rows = fts_row_count()
    except Exception as e:
        print(f"  ERROR: could not read FTS5 ({e})")
        return
    try:
        store = vector_store()
        if not store.collection_exists():
            print("  fresh install - vector store collection does not exist yet (OK)")
            return
        vec_points = store.count()
    except Exception as e:
        print(f"  ERROR: could not read vector store ({e})")
        return
    print(f"  Vector points: {vec_points}")
    print(f"  FTS5 rows:     {fts_rows}")
    if vec_points > 0 and fts_rows == 0:
        print("  WARN: FTS5 empty while vector store populated - hybrid search is running semantic-only.")
        print("        Fix: restart the watcher (auto-backfills) or run `metalmind-vault-rag-indexer`.")
    elif vec_points > 0 and fts_rows < vec_points // 2:
        print(
            f"  WARN: FTS5 has {fts_rows} rows vs {vec_points} vector points "
            "- significant drift. Consider `metalmind-vault-rag-indexer`."
        )
    else:
        print("  OK")


def check_index_format() -> None:
    """An index built in an older format still answers, just worse, so this is
    a warning rather than an error. Silence on an unstamped index is deliberate:
    those predate stamping and were built by code that still produces the
    current format."""
    print("\n== Index format ==")
    try:
        backend = embedding_backend()
        embedder = embedder_id(backend.model_id(), backend.dimension())
        stamp = read_stamp(stamp_path(COLLECTION))
    except Exception as e:
        print(f"  ERROR: could not read the index stamp ({e})")
        return
    if stamp is None:
        print("  not stamped yet - the watcher records it on next start (OK)")
        return
    print(f"  Format:   {stamp.format_version}")
    print(f"  Embedder: {stamp.embedder}")
    print(f"  Built:    {stamp.files} files, {stamp.chunks} chunks")
    if is_stale(stamp, embedder):
        print(
            f"  WARN: built in format {stamp.format_version} by {stamp.embedder}; "
            f"this release builds format {FORMAT_VERSION} with {embedder}."
        )
        print("        Recall still works. Fix: `metalmind index rebuild`.")
    else:
        print("  OK")


def check_rerank() -> None:
    """Cross-encoder reranker healthcheck.

    Silent-fallback bugs (model missing, transformers version drift, OOM) are
    the worst kind because `rerank=true` returns the unreranked list without
    error. Smoke-test by running a reranker against a known hit list: if it
    actually ran, the top result's score changes from its embedder prior.
    """
    print("\n== Rerank healthcheck ==")
    if not rerank_mod.is_dep_available():
        print("  [rerank] extra not installed - hybrid+rerank mode is unavailable.")
        print(f"  Fix: uv tool install --force --reinstall 'metalmind-vault-rag[rerank]'")
        return
    hits = [
        {"file": "test-a.md", "heading": "(root)", "score": 0.5, "text": "semantic search recall quality"},
        {"file": "test-b.md", "heading": "(root)", "score": 0.4, "text": "something about gardening"},
    ]
    try:
        out = rerank_mod.rerank_hits("how is recall quality measured", hits, k=2)
    except Exception as e:
        print(f"  ERROR: reranker.rerank_hits raised ({e})")
        return
    if not out:
        print("  ERROR: reranker returned no hits")
        return
    top = out[0]
    if top.get("prev_score") is None:
        print("  WARN: reranker returned hits without prev_score - silent fallback.")
        print("        This usually means transformers ≥ 5 is installed alongside FlagEmbedding 1.3.")
        print("        Fix: uv tool install --force --reinstall 'metalmind-vault-rag[rerank]'")
        return
    print(f"  OK - cross-encoder rescored top hit (embedder score {top['prev_score']} → cross-enc {top['score']})")


def recalled_files_from_log() -> set[str] | None:
    """Files that appeared in any logged recall's top hits, or None when the
    recall log is disabled or absent - callers must distinguish "no data"
    from "never recalled"."""
    path = recall_log.log_path()
    if path is None or not path.exists():
        return None
    files: set[str] = set()
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        for f in rec.get("top_files") or []:
            files.add(str(f))
    return files


def collect_stale_vault(
    days: int = STALE_VAULT_DAYS, recalled: set[str] | None = None
) -> list[tuple[int, str, bool]]:
    """(age_days, rel_path, never_recalled) for notes untouched past `days`,
    outside Archive/ and Daily/. `never_recalled` is False when no log exists."""
    cutoff = time.time() - days * 86400
    out: list[tuple[int, str, bool]] = []
    for f in sorted(VAULT.rglob("*.md")):
        rel = f.relative_to(VAULT)
        if rel.parts and rel.parts[0] in STALE_SKIP_TOP_DIRS:
            continue
        if any(part.startswith(".") for part in rel.parts):
            continue
        mtime = f.stat().st_mtime
        if mtime >= cutoff:
            continue
        age_days = int((time.time() - mtime) / 86400)
        never_recalled = recalled is not None and str(rel) not in recalled
        out.append((age_days, str(rel), never_recalled))
    out.sort(reverse=True)
    return out


def check_stale_vault() -> None:
    print(f"\n== Stale notes (>{STALE_VAULT_DAYS} days, outside Archive/ and Daily/) ==")
    recalled = recalled_files_from_log()
    entries = collect_stale_vault(recalled=recalled)
    for age_days, rel, never_recalled in entries:
        marker = "  · never recalled in log" if never_recalled else ""
        print(f"  [{age_days}d] {rel}{marker}")
    if recalled is None and entries:
        print("  (recall log disabled - cannot tell which of these are still being read)")
    print(f"  ({len(entries)} stale notes - report only; archive with `metalmind gold <note>`)")


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
    ap.add_argument("--orphans", action="store_true")
    ap.add_argument("--dead-links", action="store_true")
    ap.add_argument("--stale-inbox", action="store_true")
    ap.add_argument(
        "--stale",
        action="store_true",
        help=f"whole-vault stale report (>{STALE_VAULT_DAYS}d, outside Archive/ and Daily/)",
    )
    ap.add_argument("--fts", action="store_true", help="FTS5 index health vs the vector store")
    ap.add_argument("--rerank", action="store_true", help="cross-encoder reranker smoke-test")
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()

    run_any = (
        args.orphans
        or args.dead_links
        or args.stale_inbox
        or args.stale
        or args.fts
        or args.rerank
    )
    if args.all or not run_any:
        args.orphans = args.dead_links = args.stale_inbox = args.stale = True
        args.fts = args.rerank = True

    if args.orphans:
        check_orphans()
    if args.dead_links:
        check_dead_links()
    if args.stale_inbox:
        check_stale_inbox()
    if args.stale:
        check_stale_vault()
    if args.fts:
        check_fts_index()
    if args.rerank:
        check_rerank()
    if args.fts:
        check_index_format()


if __name__ == "__main__":
    main()
