import sqlite3
from pathlib import Path

from qdrant_client.http.models import FieldCondition, Filter, MatchValue, PointStruct

from .core import (
    COLLECTION,
    VAULT,
    chunk_markdown,
    embed,
    ensure_collection,
    files_to_index,
    fts_conn,
    point_id,
    qdrant,
)


def _chunk_file(path: Path) -> tuple[str, list[tuple[str, str]]]:
    """Return (relative-path, chunks). Split out so FTS writes and Qdrant
    writes share the same chunk list — ensures per-chunk parity between
    the two retrievers."""
    rel = str(path.relative_to(VAULT))
    text = path.read_text(encoding="utf-8", errors="ignore")
    chunks = chunk_markdown(text)
    return rel, chunks


def _embed_chunks(rel: str, chunks: list[tuple[str, str]]) -> list[PointStruct]:
    if not chunks:
        return []
    vecs = embed([t for _, t in chunks])
    return [
        PointStruct(
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
    in batches to Qdrant and SQLite FTS5 in lockstep. Queries stay answerable
    throughout — no delete_collection, no memory cliff. Use reindex_wipe()
    after a schema/dim change."""
    c = qdrant()
    ensure_collection()

    files = files_to_index()
    total = 0
    batch: list[PointStruct] = []
    with fts_conn() as fts:
        for f in files:
            rel, chunks = _chunk_file(f)
            file_filter = Filter(
                must=[FieldCondition(key="file", match=MatchValue(value=rel))]
            )
            c.delete(COLLECTION, points_selector=file_filter)
            _fts_replace_file(fts, rel, chunks)
            points = _embed_chunks(rel, chunks)
            if not points:
                continue
            batch.extend(points)
            if len(batch) >= UPSERT_BATCH:
                c.upsert(COLLECTION, points=batch)
                total += len(batch)
                batch = []
        if batch:
            c.upsert(COLLECTION, points=batch)
            total += len(batch)
        fts.commit()

    print(f"Indexed {total} chunks from {len(files)} files.", flush=True)
    return total


def reindex_wipe() -> int:
    """Drop + rebuild both Qdrant and FTS5. For schema/dim changes or a
    corrupt index."""
    c = qdrant()
    if c.collection_exists(COLLECTION):
        c.delete_collection(COLLECTION)
    ensure_collection()
    with fts_conn() as fts:
        fts.execute("DELETE FROM chunks")
        fts.commit()
    return reindex_all()


def reindex_paths(paths: list[Path]) -> int:
    """Incremental: upsert chunks for the given files to both Qdrant and FTS5;
    delete entries from both for files that no longer exist. Safe to call
    mid-query — never wipes the collection."""
    c = qdrant()
    ensure_collection()

    upserted = 0
    deleted = 0
    with fts_conn() as fts:
        for p in paths:
            rel = str(p.relative_to(VAULT)) if p.is_absolute() else str(p)
            file_filter = Filter(
                must=[FieldCondition(key="file", match=MatchValue(value=rel))]
            )
            abs_path = p if p.is_absolute() else VAULT / p
            if not abs_path.exists():
                c.delete(COLLECTION, points_selector=file_filter)
                _fts_delete_file(fts, rel)
                deleted += 1
                continue

            c.delete(COLLECTION, points_selector=file_filter)
            _, chunks = _chunk_file(abs_path)
            _fts_replace_file(fts, rel, chunks)
            points = _embed_chunks(rel, chunks)
            if points:
                c.upsert(COLLECTION, points=points)
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
