import hashlib
import os
import pathlib
import re
import uuid

import httpx
from qdrant_client import QdrantClient
from qdrant_client.http.models import Distance, VectorParams

OLLAMA = os.environ.get("VAULT_OLLAMA_URL", "http://localhost:11434")
QDRANT = os.environ.get("VAULT_QDRANT_URL", "http://localhost:6333")
MODEL = os.environ.get("VAULT_EMBED_MODEL", "nomic-embed-text")
COLLECTION = os.environ.get("VAULT_COLLECTION", "vault")
VAULT = pathlib.Path(os.environ.get("VAULT_PATH", str(pathlib.Path.home() / "Knowledge")))
DIM = int(os.environ.get("VAULT_EMBED_DIM", "768"))
MAX_CHUNK_CHARS = int(os.environ.get("VAULT_MAX_CHUNK_CHARS", "3500"))


def embed(texts: list[str]) -> list[list[float]]:
    out: list[list[float]] = []
    with httpx.Client(timeout=120) as c:
        for t in texts:
            r = c.post(f"{OLLAMA}/api/embeddings", json={"model": MODEL, "prompt": t})
            r.raise_for_status()
            out.append(r.json()["embedding"])
    return out


def qdrant() -> QdrantClient:
    return QdrantClient(url=QDRANT)


def ensure_collection() -> None:
    c = qdrant()
    if not c.collection_exists(COLLECTION):
        c.create_collection(
            COLLECTION,
            vectors_config=VectorParams(size=DIM, distance=Distance.COSINE),
        )


def chunk_markdown(text: str) -> list[tuple[str, str]]:
    lines = text.split("\n")
    chunks: list[tuple[str, str]] = []
    heading_stack: list[str] = []
    current: list[str] = []

    def flush() -> None:
        if current:
            hp = " / ".join(heading_stack) or "(root)"
            txt = "\n".join(current).strip()
            if txt:
                chunks.append((hp, txt))

    for line in lines:
        m = re.match(r"^(#{1,6})\s+(.*)", line)
        if m:
            flush()
            current = []
            level = len(m.group(1))
            heading_stack = heading_stack[: level - 1] + [m.group(2).strip()]
        else:
            current.append(line)
    flush()

    final: list[tuple[str, str]] = []
    for hp, t in chunks:
        if len(t) <= MAX_CHUNK_CHARS:
            final.append((hp, t))
        else:
            for i in range(0, len(t), MAX_CHUNK_CHARS):
                final.append((hp, t[i : i + MAX_CHUNK_CHARS]))
    return final


def files_to_index() -> list[pathlib.Path]:
    skip = {".obsidian", ".metalmind-stack", ".trash"}
    return [
        p
        for p in VAULT.rglob("*.md")
        if not any(part in skip for part in p.parts)
    ]


def point_id(file_rel: str, heading: str, idx: int) -> str:
    h = hashlib.sha1(f"{file_rel}|{heading}|{idx}".encode()).hexdigest()
    return str(uuid.UUID(h[:32]))
