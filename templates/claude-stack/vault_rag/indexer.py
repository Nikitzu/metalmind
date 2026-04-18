from core import (
    COLLECTION,
    chunk_markdown,
    embed,
    ensure_collection,
    files_to_index,
    point_id,
    qdrant,
    VAULT,
)
from qdrant_client.http.models import PointStruct


def main() -> None:
    c = qdrant()
    if c.collection_exists(COLLECTION):
        c.delete_collection(COLLECTION)
    ensure_collection()

    files = files_to_index()
    points: list[PointStruct] = []
    for f in files:
        rel = str(f.relative_to(VAULT))
        text = f.read_text(encoding="utf-8", errors="ignore")
        chunks = chunk_markdown(text)
        if not chunks:
            continue
        vecs = embed([t for _, t in chunks])
        for i, ((hp, t), v) in enumerate(zip(chunks, vecs)):
            points.append(
                PointStruct(
                    id=point_id(rel, hp, i),
                    vector=v,
                    payload={"file": rel, "heading": hp, "text": t},
                )
            )

    if points:
        c.upsert(COLLECTION, points=points)
    print(f"Indexed {len(points)} chunks from {len(files)} files.")


if __name__ == "__main__":
    main()
