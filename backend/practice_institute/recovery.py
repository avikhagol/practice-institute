"""Private full-data recovery bundles. Stop the server for full backup/restore."""
from __future__ import annotations

from contextlib import closing
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import tempfile

from .config import Settings
from .db import connect, migrate, now_ms

DB_NAME = "practice-institute.sqlite3"


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def _layout(settings: Settings, bundle: Path) -> None:
    if settings.db_path != settings.data_dir / DB_NAME:
        raise ValueError("full recovery requires PI_DB_PATH=PI_DATA_DIR/practice-institute.sqlite3")
    if bundle == settings.data_dir or settings.data_dir in bundle.parents or bundle in settings.data_dir.parents:
        raise ValueError("bundle must be outside PI_DATA_DIR and cannot contain it")


def _check_database(db: Path, sources: Path) -> None:
    with closing(sqlite3.connect(f"file:{db}?mode=ro&immutable=1", uri=True)) as conn:
        if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok" or list(conn.execute("PRAGMA foreign_key_check")):
            raise ValueError("database integrity check failed")
        for sha, size in conn.execute("SELECT sha256, size_bytes FROM sources WHERE stored_path IS NOT NULL"):
            path = sources / f"{sha}.pdf"
            if len(sha) != 64 or any(c not in "0123456789abcdef" for c in sha):
                raise ValueError("invalid source digest")
            if not path.is_file() or path.is_symlink() or path.stat().st_size != size or digest(path) != sha:
                raise ValueError("missing or corrupt source PDF")


def backup_full(settings: Settings, dest: Path) -> None:
    _layout(settings, dest)
    if dest.exists():
        raise ValueError("refusing to overwrite existing bundle")
    if not settings.db_path.is_file():
        raise ValueError("database does not exist; migrate/setup first")
    dest.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".pi-backup-", dir=dest.parent))
    try:
        sources = settings.data_dir / "sources"
        if sources.exists():
            if sources.is_symlink() or any(p.is_symlink() or not p.is_file() or p.suffix != ".pdf" for p in sources.iterdir()):
                raise ValueError("sources must contain regular files only")
            shutil.copytree(sources, stage / "sources")
        else:
            (stage / "sources").mkdir()
        src = connect(settings.db_path)
        out = sqlite3.connect(stage / DB_NAME)
        try:
            src.backup(out)
            out.execute("PRAGMA journal_mode=DELETE")
        finally:
            src.close()
            out.close()
        _check_database(stage / DB_NAME, stage / "sources")
        files = {p.relative_to(stage).as_posix(): digest(p) for p in stage.rglob("*") if p.is_file()}
        (stage / "manifest.json").write_text(json.dumps({"version": 1, "files": files}, indent=2) + "\n")
        for p in stage.rglob("*"):
            p.chmod(0o700 if p.is_dir() else 0o600)
        stage.rename(dest)
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def _validate_bundle_files(bundle: Path, expected: dict) -> None:
    actual = set()
    for p in bundle.rglob("*"):
        if p.is_symlink():
            raise ValueError("bundle symlinks are forbidden")
        if p.is_file() and p != bundle / "manifest.json":
            name = p.relative_to(bundle).as_posix()
            actual.add(name)
            if name != DB_NAME and not (p.parent == bundle / "sources" and p.suffix == ".pdf"):
                raise ValueError("unexpected bundle file")
            if expected.get(name) != digest(p):
                raise ValueError("bundle checksum mismatch")
    if actual != set(expected) or DB_NAME not in actual:
        raise ValueError("bundle file list mismatch")
    _check_database(bundle / DB_NAME, bundle / "sources")


def restore_full(settings: Settings, bundle: Path) -> Path | None:
    _layout(settings, bundle)
    if bundle.is_symlink() or not bundle.is_dir():
        raise ValueError("bundle must be a regular directory")
    if (bundle / "manifest.json").is_symlink():
        raise ValueError("bundle symlinks are forbidden")
    manifest = json.loads((bundle / "manifest.json").read_text())
    if not isinstance(manifest, dict) or manifest.get("version") != 1 or not isinstance(manifest.get("files"), dict):
        raise ValueError("unsupported bundle manifest")
    expected = manifest["files"]
    _validate_bundle_files(bundle, expected)
    settings.data_dir.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".pi-restore-", dir=settings.data_dir.parent))
    keep = None
    try:
        shutil.copyfile(bundle / DB_NAME, stage / DB_NAME)
        shutil.copytree(bundle / "sources", stage / "sources", symlinks=True)
        # The chosen bundle can change after validation. Check the private staged
        # bytes against the captured manifest before opening SQLite or swapping data.
        _validate_bundle_files(stage, expected)
        conn = connect(stage / DB_NAME)
        try:
            migrate(conn)
            # Uploaded paths are absolute; rewrite them for the restored location.
            for row in conn.execute("SELECT id, sha256 FROM sources WHERE stored_path IS NOT NULL").fetchall():
                conn.execute("UPDATE sources SET stored_path=? WHERE id=?", (str(settings.data_dir / "sources" / f"{row['sha256']}.pdf"), row["id"]))
            # Recovery revokes browser admin sessions; owner accounts remain.
            conn.execute("DELETE FROM admin_sessions")
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        finally:
            conn.close()
        for p in stage.rglob("*"):
            p.chmod(0o700 if p.is_dir() else 0o600)
        if settings.data_dir.exists():
            keep = settings.data_dir.with_name(f"{settings.data_dir.name}.pre-restore-{now_ms()}")
            if keep.exists():
                raise ValueError("previous-data destination already exists; retry later")
            settings.data_dir.rename(keep)
        try:
            stage.rename(settings.data_dir)
        except BaseException:
            if keep:
                keep.rename(settings.data_dir)
            raise
        return keep
    finally:
        if stage.exists():
            shutil.rmtree(stage)
