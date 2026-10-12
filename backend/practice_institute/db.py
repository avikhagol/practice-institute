"""SQLite access and forward-only migrations.

One connection per request (sync endpoints run in FastAPI's threadpool). Writes use
`BEGIN IMMEDIATE` so concurrent saves/submits for the same attempt serialise instead of
interleaving (no lost updates).
"""

from __future__ import annotations

import json
import sqlite3
import time
from contextlib import contextmanager
from importlib import resources
from pathlib import Path
from typing import Any, Iterator


def now_ms() -> int:
    return int(time.time() * 1000)


def connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, isolation_level=None, timeout=15, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = FULL")
    conn.execute("PRAGMA busy_timeout = 15000")
    return conn


@contextmanager
def write_tx(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")


def _migration_files() -> list[tuple[int, str, str]]:
    pkg = resources.files("practice_institute") / "migrations"
    out = []
    for entry in pkg.iterdir():
        name = entry.name
        if name.endswith(".sql") and name[:4].isdigit():
            out.append((int(name[:4]), name, entry.read_text(encoding="utf-8")))
    return sorted(out)


def migrate(conn: sqlite3.Connection) -> list[str]:
    """Apply pending migrations; returns names applied. Safe to run repeatedly."""
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)"
    )
    done = {row[0] for row in conn.execute("SELECT version FROM schema_migrations")}
    applied = []
    for version, name, sql in _migration_files():
        if version in done:
            continue
        conn.execute("BEGIN IMMEDIATE")
        try:
            # Another desktop CLI may have applied this migration while we waited
            # for the writer lock. The pre-lock snapshot is only an optimisation.
            if conn.execute("SELECT 1 FROM schema_migrations WHERE version=?", (version,)).fetchone():
                conn.execute("COMMIT")
                continue
            # executescript would COMMIT implicitly; split on ';' statement boundaries instead.
            for stmt in _split_sql(sql):
                conn.execute(stmt)
            conn.execute(
                "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
                (version, name, now_ms()),
            )
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise
        applied.append(name)
    return applied


def _split_sql(sql: str) -> list[str]:
    lines = [line for line in sql.splitlines() if not line.strip().startswith("--")]
    cleaned = "\n".join(line.split("--", 1)[0] for line in lines)
    return [stmt.strip() for stmt in cleaned.split(";") if stmt.strip()]


def audit(conn: sqlite3.Connection, actor: str, action: str, target: str | None = None, **detail: Any) -> None:
    conn.execute(
        "INSERT INTO audit_events (at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)",
        (now_ms(), actor, action, target, json.dumps(detail, ensure_ascii=False, sort_keys=True)),
    )
