import hashlib
import os
import pathlib
import re
import sqlite3
import uuid

from .backends import EmbeddingBackend, make_backend
from .sqlite_util import connect as sqlite_connect
from .stores import VectorStore, make_store

COLLECTION = os.environ.get("VAULT_COLLECTION", "vault")
VAULT = pathlib.Path(os.environ.get("VAULT_PATH", str(pathlib.Path.home() / "Knowledge")))
MAX_CHUNK_CHARS = int(os.environ.get("VAULT_MAX_CHUNK_CHARS", "3500"))

CHUNK_TARGET_CHARS = int(os.environ.get("VAULT_CHUNK_TARGET_CHARS", "3500"))
CHUNK_OVERLAP_CHARS = int(os.environ.get("VAULT_CHUNK_OVERLAP_CHARS", "0"))

_SEGMENT_SPLIT = re.compile(r"(?<=[.!?])\s+|\n\s*\n")

# FTS5 keyword index lives alongside Qdrant. Same chunk granularity (one row
# per heading-chunk). Per-collection so bench runs and user vaults never
# collide - default derived from VAULT_COLLECTION.
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


def embed_query(texts: list[str]) -> list[list[float]]:
    """Embed search queries, which is not the same operation as embedding a
    document on an asymmetric retrieval model.

    A backend predating this method falls back to `embed`, so a third-party
    implementation keeps working."""
    backend = embedding_backend()
    fn = getattr(backend, "embed_query", None)
    return fn(texts) if fn else backend.embed(texts)


def ensure_collection() -> None:
    """Create the active store's collection if absent. Idempotent."""
    vector_store().ensure_collection()


def fts_conn() -> sqlite3.Connection:
    """Open (and lazily create) the FTS5 keyword index. One row per chunk.

    Porter tokenizer - stems English words so `running` → `run`, closes common
    query/doc vocabulary gaps. Unicode61 is the SQLite default; switching to
    porter is a deliberate choice for English-heavy vaults. Revisit if
    multilingual users show up.

    The table schema mirrors Qdrant payload keys (file, heading) so the RRF
    merger can de-dup hits by (file, heading) regardless of retriever source.
    """
    FTS_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite_connect(str(FTS_DB_PATH))
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


def fts_file_count() -> int:
    with fts_conn() as conn:
        cur = conn.execute("SELECT COUNT(DISTINCT file) FROM chunks")
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
        for piece in split_section(t, CHUNK_TARGET_CHARS, CHUNK_OVERLAP_CHARS):
            final.append((hp, piece))
    return final


SKIP_DIRS = frozenset({".obsidian", ".metalmind-stack", ".trash"})


def in_skip_dir(path: pathlib.PurePath) -> bool:
    return any(part in SKIP_DIRS for part in path.parts)


def files_to_index() -> list[pathlib.Path]:
    return [p for p in VAULT.rglob("*.md") if not in_skip_dir(p)]


def split_section(text: str, target: int, overlap: int) -> list[str]:
    """Split one section into chunks on sentence and paragraph boundaries,
    carrying `overlap` characters of the previous chunk into the next.

    The old chunker cut at a fixed offset, mid-word, with nothing shared across
    the seam, so a fact spanning it survived in neither piece.

    Defaults are 3500/0, which is the old character budget with better cut
    points rather than smaller chunks. A 1500-session sweep preferred 1200/200,
    but that ranking did not survive the 3000-session corpus: there 3500/0 reads
    44/62/70 against 1200/200's 44/62/69 on a smaller index. Sizing carries none
    of the arc's gain, which came from chunk identity in fusion. Overlap earns
    nothing at this budget, so it stays off by default and stays configurable.

    A segment longer than the target is emitted whole rather than cut. Splitting
    it would recreate exactly the failure this replaces, and one oversized
    paragraph is a smaller problem than a sentence severed at a byte offset.

    That holds only up to MAX_CHUNK_CHARS. Content with no sentence boundary at
    all, a base64 blob or a wide table, would otherwise become one enormous
    chunk, and the embedder truncates at its token limit, so everything past the
    limit would go unindexed entirely. Beyond the ceiling the old character cut
    is the lesser harm: the tail survives in a later chunk.

    Every chunk consumes at least one new segment. Without that, an overlap at
    or above the target refills each chunk from the carried tail alone and the
    loop never advances.

    Overlap is clamped to half the target. It terminates without the clamp, but
    degenerately: measured at overlap 1000 against target 200, chunks reached
    five times the target and the count quadrupled. A mistyped sweep value would
    otherwise build a quietly bad index rather than failing."""
    segments = [s.strip() for s in _SEGMENT_SPLIT.split(text or "") if s and s.strip()]
    if not segments:
        return []
    overlap = max(0, min(overlap, target // 2))

    chunks: list[str] = []
    carried: list[str] = []
    current: list[str] = list(carried)
    size = 0

    def flush() -> list[str]:
        if not current:
            return []
        chunks.append(" ".join(current))
        tail: list[str] = []
        used = 0
        for seg in reversed(current):
            if used + len(seg) > overlap:
                break
            tail.insert(0, seg)
            used += len(seg) + 1
        return tail

    expanded: list[str] = []
    for seg in segments:
        if len(seg) <= MAX_CHUNK_CHARS:
            expanded.append(seg)
        else:
            expanded.extend(
                seg[i : i + MAX_CHUNK_CHARS] for i in range(0, len(seg), MAX_CHUNK_CHARS)
            )

    for seg in expanded:
        if current and size + len(seg) + 1 > target:
            carried = flush()
            current = list(carried)
            size = sum(len(s) + 1 for s in current)
        current.append(seg)
        size += len(seg) + 1

    if current:
        chunks.append(" ".join(current))
    return chunks


def note_title(file_rel: str) -> str:
    """A readable title from the path. The filename is always present and, for a
    scribe-written note, is generated from the title, so it needs no frontmatter
    parse and behaves the same for a hand-made note dropped into the vault."""
    stem = file_rel.rsplit("/", 1)[-1]
    if stem.lower().endswith(".md"):
        stem = stem[:-3]
    return stem.replace("-", " ").replace("_", " ").strip()


EMBED_CONTEXT = os.environ.get("METALMIND_EMBED_CONTEXT", "1") != "0"


def embed_text(file_rel: str, heading: str, text: str) -> str:
    """The string handed to the embedder: where the chunk came from, then the
    chunk.

    Only this changes. Stored text, FTS rows and snippets stay what the note
    says, so neighbours and displayed output are untouched.

    The heading path already opens with the H1, which for a scribe-written note
    is the filename stem, so the title is prepended only when the heading does
    not already carry it. Repeating it would double that text's weight in the
    embedding and buy nothing."""
    if not EMBED_CONTEXT:
        return text
    title = note_title(file_rel)
    parts: list[str] = []
    clean_heading = (heading or "").strip()
    if clean_heading and clean_heading != "(root)":
        if not clean_heading.lower().startswith(title.lower()):
            parts.append(title)
        parts.append(clean_heading)
    elif title:
        parts.append(title)
    if not parts:
        return text
    return f"{' / '.join(parts)}: {text}"


def point_id(file_rel: str, heading: str, idx: int) -> str:
    h = hashlib.sha1(f"{file_rel}|{heading}|{idx}".encode()).hexdigest()
    return str(uuid.UUID(h[:32]))
