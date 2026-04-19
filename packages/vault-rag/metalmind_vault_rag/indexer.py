from pathlib import Path

from qdrant_client.http.models import FieldCondition, Filter, MatchValue, PointStruct

from .core import (
    COLLECTION,
    VAULT,
    chunk_markdown,
    embed,
    ensure_collection,
    files_to_index,
    point_id,
    qdrant,
)


def _embed_file(path: Path) -> list[PointStruct]:
    rel = str(path.relative_to(VAULT))
    text = path.read_text(encoding="utf-8", errors="ignore")
    chunks = chunk_markdown(text)
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


UPSERT_BATCH = 500


def reindex_all() -> int:
    """Stream-rebuild: walk every file, overwrite its chunks in place, upsert
    in batches. Queries stay answerable throughout — no delete_collection,
    no memory cliff. Use reindex_wipe() after a schema/dim change."""
    c = qdrant()
    ensure_collection()

    files = files_to_index()
    total = 0
    batch: list[PointStruct] = []
    for f in files:
        rel = str(f.relative_to(VAULT))
        file_filter = Filter(
            must=[FieldCondition(key="file", match=MatchValue(value=rel))]
        )
        c.delete(COLLECTION, points_selector=file_filter)
        points = _embed_file(f)
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

    print(f"Indexed {total} chunks from {len(files)} files.", flush=True)
    return total


def reindex_wipe() -> int:
    """Drop + rebuild. For schema/dim changes or a corrupt collection."""
    c = qdrant()
    if c.collection_exists(COLLECTION):
        c.delete_collection(COLLECTION)
    ensure_collection()
    return reindex_all()


def reindex_paths(paths: list[Path]) -> int:
    """Incremental: upsert chunks for the given files; delete points for files
    that no longer exist. Safe to call mid-query — never wipes the collection."""
    c = qdrant()
    ensure_collection()

    upserted = 0
    deleted = 0
    for p in paths:
        rel = str(p.relative_to(VAULT)) if p.is_absolute() else str(p)
        file_filter = Filter(
            must=[FieldCondition(key="file", match=MatchValue(value=rel))]
        )
        abs_path = p if p.is_absolute() else VAULT / p
        if not abs_path.exists():
            c.delete(COLLECTION, points_selector=file_filter)
            deleted += 1
            continue

        c.delete(COLLECTION, points_selector=file_filter)
        points = _embed_file(abs_path)
        if points:
            c.upsert(COLLECTION, points=points)
            upserted += len(points)

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
