import sqlite3
from pathlib import Path

from .core import (
    COLLECTION,
    VAULT,
    chunk_markdown,
    embedding_backend,
    files_to_index,
    fts_conn,
    in_skip_dir,
    point_id,
    vector_store,
)
from .stores import VectorPoint


def _chunk_file(path: Path) -> tuple[str, list[tuple[str, str]]]:
    """Return (relative-path, chunks). Split out so FTS writes and vector
    writes share the same chunk list - ensures per-chunk parity between
    the two retrievers."""
    rel = str(path.relative_to(VAULT))
    text = path.read_text(encoding="utf-8", errors="ignore")
    chunks = chunk_markdown(text)
    return rel, chunks


def _embed_chunks(rel: str, chunks: list[tuple[str, str]]) -> list[VectorPoint]:
    if not chunks:
        return []
    vecs = embedding_backend().embed([t for _, t in chunks])
    return [
        VectorPoint(
            id=point_id(rel, hp, i),
            vector=v,
            payload={"file": rel, "heading": hp, "text": t},
        )
        for i, ((hp, t), v) in enumerate(zip(chunks, vecs))
    ]


def _fts_replace_file(conn: sqlite3.Connection, rel: str, chunks: list[tuple[str, str]]) -> None:
    """Atomic-per-file: drop all rows for this file, insert fresh."""
    conn.execute("DELETE FROM chunks WHERE file = ?", (rel,))
    if chunks:
        conn.executemany(
            "INSERT INTO chunks (file, heading, chunk_idx, text) VALUES (?, ?, ?, ?)",
            [(rel, hp, i, t) for i, (hp, t) in enumerate(chunks)],
        )


def _fts_delete_file(conn: sqlite3.Connection, rel: str) -> None:
    conn.execute("DELETE FROM chunks WHERE file = ?", (rel,))


UPSERT_BATCH = 500


def reindex_all() -> int:
    """Stream-rebuild: walk every file, overwrite its chunks in place, upsert
    in batches to the vector store and SQLite FTS5 in lockstep. Queries stay
    answerable throughout - no delete_collection, no memory cliff. Use
    reindex_wipe() after a schema/dim change."""
    store = vector_store()
    store.ensure_collection()

    files = files_to_index()
    total = 0
    batch: list[VectorPoint] = []
    with fts_conn() as fts:
        for f in files:
            rel, chunks = _chunk_file(f)
            store.delete_by_file(rel)
            _fts_replace_file(fts, rel, chunks)
            points = _embed_chunks(rel, chunks)
            if not points:
                continue
            batch.extend(points)
            if len(batch) >= UPSERT_BATCH:
                store.upsert(batch)
                total += len(batch)
                batch = []
        if batch:
            store.upsert(batch)
            total += len(batch)
        fts.commit()

    print(f"Indexed {total} chunks from {len(files)} files.", flush=True)
    return total


def reindex_wipe() -> int:
    """Drop + rebuild both the vector store and FTS5. For schema/dim changes
    or a corrupt index."""
    store = vector_store()
    store.delete_collection()
    store.ensure_collection()
    with fts_conn() as fts:
        fts.execute("DELETE FROM chunks")
        fts.commit()
    return reindex_all()


def reindex_paths(paths: list[Path]) -> int:
    """Incremental: upsert chunks for the given files to both the vector
    store and FTS5; delete entries from both for files that no longer exist.
    Safe to call mid-query - never wipes the collection.

    Commits per file rather than per batch. A single transaction spanning a
    100-file bulk change holds the write lock for minutes, and readers that
    exhaust their busy timeout inside it fail rather than wait."""
    store = vector_store()
    store.ensure_collection()

    upserted = 0
    deleted = 0
    with fts_conn() as fts:
        for p in paths:
            rel = str(p.relative_to(VAULT)) if p.is_absolute() else str(p)
            abs_path = p if p.is_absolute() else VAULT / p
            if in_skip_dir(Path(rel)) or not abs_path.exists():
                store.delete_by_file(rel)
                _fts_delete_file(fts, rel)
                fts.commit()
                deleted += 1
                continue

            store.delete_by_file(rel)
            _, chunks = _chunk_file(abs_path)
            _fts_replace_file(fts, rel, chunks)
            points = _embed_chunks(rel, chunks)
            if points:
                store.upsert(points)
                upserted += len(points)
            fts.commit()

    print(
        f"Incremental: {upserted} chunks upserted, {deleted} files removed.",
        flush=True,
    )
    return upserted


def main() -> None:
    import sys

    args = sys.argv[1:]
    if args and args[0] == "--paths":
        paths = [Path(p) for p in args[1:] if p]
        if not paths:
            print("--paths requires at least one file", flush=True)
            sys.exit(2)
        reindex_paths(paths)
        return
    if args and args[0] == "--wipe":
        reindex_wipe()
        return
    if args and args[0] in {"-h", "--help"}:
        print(
            "usage: metalmind-vault-rag-indexer                 # stream-rebuild (no query gap)\n"
            "       metalmind-vault-rag-indexer --paths FILE... # incremental upsert\n"
            "       metalmind-vault-rag-indexer --wipe          # drop collection + rebuild",
            flush=True,
        )
        return
    reindex_all()


if __name__ == "__main__":
    main()
