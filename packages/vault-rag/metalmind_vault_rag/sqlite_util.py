"""Shared SQLite connection hygiene for the FTS and vector databases.

Under the default rollback journal a write transaction blocks every reader,
which turns a bulk change - a git pull of a synced vault, an archive sweep -
into minutes of `database is locked` on the query path. WAL lets readers
proceed against the last committed snapshot while the writer works.

The journal mode is a property of the database file rather than the
connection, so opening an existing database with this helper upgrades it in
place. No reindex, no user action.
"""
from __future__ import annotations

import os
import sqlite3

BUSY_TIMEOUT_S = float(os.environ.get("VAULT_SQLITE_BUSY_TIMEOUT_S", "30"))


def connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, timeout=BUSY_TIMEOUT_S)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(f"PRAGMA busy_timeout={int(BUSY_TIMEOUT_S * 1000)}")
    return conn
