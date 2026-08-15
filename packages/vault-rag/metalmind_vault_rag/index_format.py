"""What format an index was built in.

Retrieval quality depends on decisions frozen at index time: how a note was cut
into chunks, how large those chunks may be, and what text was actually handed to
the embedder. None of that was recorded. That was survivable only because none
of it had ever changed; the moment one does, an upgraded tool reads an old index
and returns quietly worse results with nothing to say so.

Staleness asks one question: **would this code, with this configuration, build a
different index than the one on disk?** Every recorded field that affects the
answer is compared, which is all of them except `files` and `chunks`. Those two
describe the vault at build time and change on every edit, so comparing them
would report a note added since the last reindex as a format mismatch.

An earlier version made `FORMAT_VERSION` the only signal and kept the chunker
fields as description, on the reasoning that deriving staleness from them would
invite an argument about which of them count. That argument has a clean answer:
a field earns its place in the stamp by affecting the build, so every field in
the stamp counts. Keeping them descriptive also left a real gap, because the
chunk budget is settable per process through `VAULT_CHUNK_TARGET_CHARS` and
`VAULT_CHUNK_OVERLAP_CHARS`. A version bump cannot catch a change that involves
no version.

`FORMAT_VERSION` remains, now as the catch-all for a change no field captures.
The rule it encoded still holds: **changing how chunks are produced or embedded
in a way the stamp does not already describe means bumping it.**

`target_chars` and `overlap_chars` postdate the first stamps, where they read 0.
No valid configuration produces a 0 target, so 0 is read as unknown rather than
as a mismatch, and a pre-existing stamp is not called stale for a field it never
had the chance to record.

The stamp sits beside the index databases rather than inside them, the same
choice supersede and calibration made. No index schema change means shipping
this never forces a reindex, which matters because every existing install
predates the stamp and is still correct: this release builds what those indexes
were built with, so a missing stamp is backfilled rather than treated as stale.
"""

from __future__ import annotations

import json
import pathlib
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone

from .core import CHUNK_OVERLAP_CHARS, CHUNK_TARGET_CHARS, EMBED_CONTEXT, MAX_CHUNK_CHARS

FORMAT_VERSION = 2

CHUNKER = "heading-split-sentence-overlap"
EMBEDDED_TEXT = "title-heading-prefixed" if EMBED_CONTEXT else "chunk-text-only"


@dataclass(frozen=True)
class IndexStamp:
    format_version: int
    chunker: str
    max_chunk_chars: int
    embedded_text: str
    embedder: str
    files: int
    chunks: int
    target_chars: int = 0
    overlap_chars: int = 0


def current_stamp(embedder: str, files: int, chunks: int) -> IndexStamp:
    return IndexStamp(
        format_version=FORMAT_VERSION,
        chunker=CHUNKER,
        max_chunk_chars=MAX_CHUNK_CHARS,
        target_chars=CHUNK_TARGET_CHARS,
        overlap_chars=CHUNK_OVERLAP_CHARS,
        embedded_text=EMBEDDED_TEXT,
        embedder=embedder,
        files=files,
        chunks=chunks,
    )


def is_stale(stamp: IndexStamp | None, embedder: str) -> bool:
    """Whether this index was built by something other than what is running.

    A missing stamp is not stale. Every index without one was built by code that
    still produces the current format, so treating absence as a mismatch would
    tell every existing install to rebuild for no gain.

    A zero chunk budget means the stamp predates those fields, not that the
    budget was zero. See the module docstring."""
    if stamp is None:
        return False
    current = current_stamp(embedder=embedder, files=stamp.files, chunks=stamp.chunks)
    if not stamp.target_chars:
        current = replace(current, target_chars=0, overlap_chars=0)
    return stamp != current


def stamp_path(collection: str) -> pathlib.Path:
    return pathlib.Path.home() / ".metalmind" / f"{collection}.index.json"


def write_stamp(path: pathlib.Path, stamp: IndexStamp) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {**asdict(stamp), "built_at": datetime.now(timezone.utc).isoformat()}
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def read_built_at(path: pathlib.Path) -> str | None:
    """When the stamp was written, kept out of IndexStamp on purpose.

    A timestamp on the dataclass would make every stamp unequal to every other
    one, which would turn the round-trip and comparison tests into assertions
    about the clock."""
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    value = payload.get("built_at")
    return str(value) if value else None


def read_stamp(path: pathlib.Path) -> IndexStamp | None:
    """The recorded stamp, or None when there is nothing readable to record.

    An unrecognised `format_version` is returned rather than rejected, unlike
    the calibration sidecar. A stamp from a newer release is exactly the case
    staleness exists to report, and discarding it would describe a downgraded
    install as never stamped instead of as mismatched."""
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    try:
        return IndexStamp(
            format_version=int(payload["format_version"]),
            chunker=str(payload["chunker"]),
            max_chunk_chars=int(payload["max_chunk_chars"]),
            embedded_text=str(payload["embedded_text"]),
            embedder=str(payload["embedder"]),
            files=int(payload["files"]),
            chunks=int(payload["chunks"]),
            target_chars=int(payload.get("target_chars", 0)),
            overlap_chars=int(payload.get("overlap_chars", 0)),
        )
    except (KeyError, TypeError, ValueError):
        return None
