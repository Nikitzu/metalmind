"""sqlite-vec backed VectorStore. Single-process, no daemon, ~3 MB
extension wheel. Becomes the default in v0.5.0; QdrantStore stays
available behind METALMIND_BACKEND=legacy.

Schema (one DB per collection at `~/.metalmind/vec-<col>.db`):

    CREATE VIRTUAL TABLE chunks USING vec0(
        embedding FLOAT[<dim>] distance_metric=cosine
    );

    CREATE TABLE payloads (
        rowid INTEGER PRIMARY KEY,
        point_id TEXT NOT NULL UNIQUE,
        file TEXT NOT NULL,            -- denormalized for delete_by_file index
        payload_json TEXT NOT NULL
    );
    CREATE INDEX payload_file_idx ON payloads(file);

`chunks.rowid` and `payloads.rowid` are joined together — every vec0 row
has a corresponding payload row. UUIDs from `core.point_id` map to
INTEGER rowids via the `point_id` column.

Cosine similarity convention: vec0 returns distance in [0, 2] (0 =
identical, 1 = orthogonal, 2 = opposite). Protocol says VectorHit.score
is similarity in [-1, 1] with higher = better. Conversion at the
boundary: `similarity = 1 - distance`.
"""

from __future__ import annotations

import json
import os
import pathlib
import sqlite3
import struct
from typing import Iterable

import sqlite_vec

from . import VectorHit, VectorPoint


def _pack_vector(vec: list[float], dim: int) -> bytes:
    if len(vec) != dim:
        raise ValueError(
            f"vector dimension mismatch: got {len(vec)}, store expects {dim}"
        )
    return struct.pack(f"{dim}f", *vec)


class SqliteVecStore:
    """In-process vec0 store. Owns a single sqlite3 connection — vec0 is
    safe for concurrent reads from one connection, and the watcher is
    single-process by design."""

    def __init__(
        self,
        db_path: str | pathlib.Path | None = None,
        collection: str | None = None,
        dim: int | None = None,
    ) -> None:
        self._collection = collection or os.environ.get("VAULT_COLLECTION", "vault")
        self._dim = dim if dim is not None else int(os.environ.get("VAULT_EMBED_DIM", "384"))
        if db_path is None:
            db_path = os.environ.get(
                "VAULT_VEC_DB_PATH",
                str(pathlib.Path.home() / ".metalmind" / f"vec-{self._collection}.db"),
            )
        self._db_path = pathlib.Path(db_path)
        self._conn: sqlite3.Connection | None = None

    # --- connection lifecycle ------------------------------------------------

    def _open(self) -> sqlite3.Connection:
        if self._conn is not None:
            return self._conn
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self._db_path))
        conn.enable_load_extension(True)
        sqlite_vec.load(conn)
        conn.enable_load_extension(False)
        self._conn = conn
        return conn

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    # --- VectorStore protocol ------------------------------------------------

    def ensure_collection(self) -> None:
        conn = self._open()
        conn.execute(
            f"CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING vec0("
            f"embedding FLOAT[{self._dim}] distance_metric=cosine)"
        )
        conn.execute(
            "CREATE TABLE IF NOT EXISTS payloads ("
            "rowid INTEGER PRIMARY KEY, "
            "point_id TEXT NOT NULL UNIQUE, "
            "file TEXT NOT NULL, "
            "payload_json TEXT NOT NULL)"
        )
        conn.execute("CREATE INDEX IF NOT EXISTS payload_file_idx ON payloads(file)")
        conn.commit()

    def collection_exists(self) -> bool:
        if not self._db_path.exists():
            return False
        conn = self._open()
        cur = conn.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table','virtual')"
            " AND name IN ('chunks','payloads')"
        )
        names = {row[0] for row in cur.fetchall()}
        return {"chunks", "payloads"}.issubset(names)

    def upsert(self, points: list[VectorPoint]) -> None:
        if not points:
            return
        self.ensure_collection()
        conn = self._open()
        try:
            for p in points:
                file_val = str(p.payload.get("file", ""))
                payload_blob = json.dumps(p.payload, ensure_ascii=False)
                vec_blob = _pack_vector(list(p.vector), self._dim)

                row = conn.execute(
                    "SELECT rowid FROM payloads WHERE point_id = ?", (p.id,)
                ).fetchone()
                if row is None:
                    cur = conn.execute(
                        "INSERT INTO payloads (point_id, file, payload_json)"
                        " VALUES (?, ?, ?)",
                        (p.id, file_val, payload_blob),
                    )
                    rowid = cur.lastrowid
                    conn.execute(
                        "INSERT INTO chunks (rowid, embedding) VALUES (?, ?)",
                        (rowid, vec_blob),
                    )
                else:
                    rowid = row[0]
                    conn.execute(
                        "UPDATE payloads SET file = ?, payload_json = ?"
                        " WHERE rowid = ?",
                        (file_val, payload_blob, rowid),
                    )
                    conn.execute("DELETE FROM chunks WHERE rowid = ?", (rowid,))
                    conn.execute(
                        "INSERT INTO chunks (rowid, embedding) VALUES (?, ?)",
                        (rowid, vec_blob),
                    )
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    def delete_by_file(self, rel: str) -> None:
        if not self.collection_exists():
            return
        conn = self._open()
        rowids: list[int] = [
            row[0]
            for row in conn.execute(
                "SELECT rowid FROM payloads WHERE file = ?", (rel,)
            )
        ]
        if not rowids:
            return
        try:
            placeholders = ",".join("?" * len(rowids))
            conn.execute(f"DELETE FROM chunks WHERE rowid IN ({placeholders})", rowids)
            conn.execute(f"DELETE FROM payloads WHERE rowid IN ({placeholders})", rowids)
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    def delete_collection(self) -> None:
        # Closing + unlinking the file is the cheapest "drop everything".
        # Subsequent ensure_collection() recreates the schema.
        self.close()
        if self._db_path.exists():
            self._db_path.unlink()

    def count(self) -> int:
        if not self.collection_exists():
            return 0
        conn = self._open()
        return int(conn.execute("SELECT COUNT(*) FROM payloads").fetchone()[0])

    def query(self, vec: list[float], k: int) -> list[VectorHit]:
        if not self.collection_exists():
            return []
        conn = self._open()
        vec_blob = _pack_vector(list(vec), self._dim)
        rows: Iterable[tuple] = conn.execute(
            "SELECT chunks.rowid, chunks.distance, payloads.payload_json"
            " FROM chunks JOIN payloads ON chunks.rowid = payloads.rowid"
            " WHERE chunks.embedding MATCH ? AND k = ?"
            " ORDER BY chunks.distance",
            (vec_blob, k),
        )
        hits: list[VectorHit] = []
        for _rowid, distance, payload_json in rows:
            similarity = 1.0 - float(distance)
            hits.append(
                VectorHit(score=similarity, payload=json.loads(payload_json))
            )
        return hits
