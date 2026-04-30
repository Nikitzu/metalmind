import hashlib
import os
import pathlib
import re
import sqlite3
import uuid

from .backends import EmbeddingBackend, make_backend
from .stores import VectorStore, make_store

COLLECTION = os.environ.get("VAULT_COLLECTION", "vault")
VAULT = pathlib.Path(os.environ.get("VAULT_PATH", str(pathlib.Path.home() / "Knowledge")))
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


# Process-lifetime singletons. Constructed lazily on first access so the
# watcher's startup probe and one-shot CLI scripts don't pay the cost
# unless they actually need to embed or hit the store.
_VECTOR_STORE: VectorStore | None = None
_EMBEDDING_BACKEND: EmbeddingBackend | None = None


def vector_store() -> VectorStore:
    global _VECTOR_STORE
    if _VECTOR_STORE is None:
        _VECTOR_STORE = make_store()
    return _VECTOR_STORE


def embedding_backend() -> EmbeddingBackend:
    global _EMBEDDING_BACKEND
    if _EMBEDDING_BACKEND is None:
        _EMBEDDING_BACKEND = make_backend()
    return _EMBEDDING_BACKEND


def embed(texts: list[str]) -> list[list[float]]:
    """Thin facade over the active EmbeddingBackend. Kept as a top-level
    function so older test fixtures and any third-party callers that
    imported `core.embed` keep working without churn."""
    return embedding_backend().embed(texts)


def ensure_collection() -> None:
    """Create the active store's collection if absent. Idempotent."""
    vector_store().ensure_collection()


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
