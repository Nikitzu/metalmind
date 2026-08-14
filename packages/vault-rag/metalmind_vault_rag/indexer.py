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
from .calibration import (
    best_semantic_score,
    confidence_enabled,
    calibrate,
    embedder_id,
    sidecar_path,
)
from .index_format import current_stamp, stamp_path, write_stamp
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
            payload={"file": rel, "heading": hp, "text": t, "chunk_idx": i},
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
    stamp_index(len(files), total)
    run_calibration()
    return total


def stamp_index(files: int, chunks: int) -> None:
    """Record the format this index was just built in.

    Written before calibration rather than after. Confidence is advisory and may
    legitimately be refused, but a collection with no format record cannot be
    identified later, and the index exists either way."""
    try:
        backend = embedding_backend()
        write_stamp(
            stamp_path(COLLECTION),
            current_stamp(
                embedder=embedder_id(backend.model_id(), backend.dimension()),
                files=files,
                chunks=chunks,
            ),
        )
    except Exception as e:
        print(f"metalmind: could not write the index stamp ({e!r})", flush=True)


def run_calibration() -> None:
    """Derive this collection's confidence bands from the index just built.

    Only full rebuilds land here. An incremental reindex touches a handful of
    files and would pay the whole sampling cost to move the edges by nothing.

    Search is imported inside the function to keep the module import graph
    one-way: search reads calibration, so calibration must not be reachable
    from search at import time.

    Nothing here may break indexing. Confidence is advisory, and a vault that
    indexed correctly but failed to calibrate is a vault that reports no
    confidence, not a failed reindex."""
    if not confidence_enabled():
        return
    try:
        from .search import search_vault

        with fts_conn() as conn:
            rows = conn.execute("SELECT file, text FROM chunks ORDER BY file, chunk_idx").fetchall()

        backend = embedding_backend()

        def score(query: str) -> float | None:
            return best_semantic_score(search_vault(query, k=5))

        bands = calibrate(
            [(r[0], r[1]) for r in rows],
            score,
            embedder=embedder_id(backend.model_id(), backend.dimension()),
            path=sidecar_path(COLLECTION),
        )
    except Exception as e:
        print(f"metalmind: confidence calibration skipped ({e!r})", flush=True)
        return

    if bands is None:
        print("metalmind: no confidence bands for this vault.", flush=True)
    else:
        print(
            f"Calibrated confidence: low {bands.low_edge:.4f}, high {bands.high_edge:.4f}.",
            flush=True,
        )


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
