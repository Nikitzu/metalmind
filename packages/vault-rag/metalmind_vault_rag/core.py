import hashlib
import os
import pathlib
import re
import sqlite3
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

# FTS5 keyword index lives alongside Qdrant. Same chunk granularity (one row
# per heading-chunk). Per-collection so bench runs and user vaults never
# collide — default derived from VAULT_COLLECTION.
FTS_DB_PATH = pathlib.Path(
    os.environ.get(
        "VAULT_FTS_DB_PATH",
        str(pathlib.Path.home() / ".metalmind" / f"fts-{COLLECTION}.db"),
    )
)


EMBED_BATCH = int(os.environ.get("VAULT_EMBED_BATCH", "64"))


def embed(texts: list[str]) -> list[list[float]]:
    """Batch-embed via Ollama's /api/embed. Falls back to legacy /api/embeddings
    (one call per text) only if the batch endpoint returns 404 — so older
    Ollama servers still work. 5–10× faster than the old per-text loop."""
    if not texts:
        return []
    out: list[list[float]] = []
    with httpx.Client(timeout=120) as c:
        i = 0
        use_legacy = False
        while i < len(texts):
            batch = texts[i : i + EMBED_BATCH]
            if not use_legacy:
                r = c.post(f"{OLLAMA}/api/embed", json={"model": MODEL, "input": batch})
                if r.status_code == 404:
                    use_legacy = True
                else:
                    r.raise_for_status()
                    out.extend(r.json()["embeddings"])
                    i += len(batch)
                    continue
            # Legacy fallback: one-at-a-time.
            for t in batch:
                lr = c.post(f"{OLLAMA}/api/embeddings", json={"model": MODEL, "prompt": t})
                lr.raise_for_status()
                out.append(lr.json()["embedding"])
            i += len(batch)
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


def fts_conn() -> sqlite3.Connection:
    """Open (and lazily create) the FTS5 keyword index. One row per chunk.

    Porter tokenizer — stems English words so `running` → `run`, closes common
    query/doc vocabulary gaps. Unicode61 is the SQLite default; switching to
    porter is a deliberate choice for English-heavy vaults. Revisit if
    multilingual users show up.

    The table schema mirrors Qdrant payload keys (file, heading) so the RRF
    merger can de-dup hits by (file, heading) regardless of retriever source.
    """
    FTS_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(FTS_DB_PATH))
    conn.execute(
        """
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(
            file UNINDEXED,
            heading UNINDEXED,
            chunk_idx UNINDEXED,
            text,
            tokenize = 'porter'
        )
        """
    )
    return conn


def fts_row_count() -> int:
    with fts_conn() as conn:
        cur = conn.execute("SELECT COUNT(*) FROM chunks")
        return int(cur.fetchone()[0])


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
