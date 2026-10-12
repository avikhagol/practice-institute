"""Desktop commands may share startup; migration state must be checked under lock."""
from concurrent.futures import ThreadPoolExecutor
import threading


def test_concurrent_first_run_migrations_recheck_after_writer_lock(tmp_path, monkeypatch):
    from practice_institute import db

    path = tmp_path / "concurrent.sqlite3"
    initial = db.connect(path)
    initial.execute("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)")
    initial.close()
    files = db._migration_files()
    barrier = threading.Barrier(2)

    def same_pre_lock_snapshot():
        # migrate calls this only after reading its initial applied-version set.
        barrier.wait(timeout=10)
        return files

    monkeypatch.setattr(db, "_migration_files", same_pre_lock_snapshot)

    def migrate():
        conn = db.connect(path)
        try:
            return db.migrate(conn)
        finally:
            conn.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: migrate(), range(2)))
    assert sorted(name for result in results for name in result) == sorted(name for _, name, _ in files)
    conn = db.connect(path)
    try:
        assert conn.execute("SELECT COUNT(*) FROM schema_migrations").fetchone()[0] == len(files)
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    finally:
        conn.close()
