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


def reindex_all() -> int:
    """Full wipe + rebuild. Used by CLI and first-run priming."""
    c = qdrant()
    if c.collection_exists(COLLECTION):
        c.delete_collection(COLLECTION)
    ensure_collection()

    files = files_to_index()
    points: list[PointStruct] = []
    for f in files:
        points.extend(_embed_file(f))
    if points:
        c.upsert(COLLECTION, points=points)
    print(f"Indexed {len(points)} chunks from {len(files)} files.", flush=True)
    return len(points)


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
    reindex_all()


if __name__ == "__main__":
    main()
