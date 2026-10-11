"""Owner CLI: `uv run pi-admin <command>`.

  migrate              apply database migrations
  setup                interactively create the owner account (password never echoed or logged)
  backup <file>        consistent online SQLite backup; --full includes sources (stop server)
  restore <file>       replace DB; --full restores data+sources (server must be stopped)
  serve [--host --port] run the API (defaults to 127.0.0.1:8787, loopback only)
"""

from __future__ import annotations

import argparse
import getpass
import os
import shutil
import sqlite3
import sys
from pathlib import Path

from .config import load_settings
from .db import audit, connect, migrate, now_ms, write_tx
from .security import MIN_PASSWORD_LENGTH, hash_password


def cmd_migrate(_args: argparse.Namespace) -> int:
    settings = load_settings()
    conn = connect(settings.db_path)
    applied = migrate(conn)
    conn.close()
    print(f"database: {settings.db_path}")
    print("applied: " + (", ".join(applied) if applied else "nothing (up to date)"))
    return 0


def cmd_setup(args: argparse.Namespace) -> int:
    settings = load_settings()
    conn = connect(settings.db_path)
    migrate(conn)
    if conn.execute("SELECT COUNT(*) FROM admins").fetchone()[0] and not args.add:
        print("An owner account already exists. Use `pi-admin setup --add` to add another admin.", file=sys.stderr)
        return 1
    if not sys.stdin.isatty() and not os.environ.get("PI_SETUP_ALLOW_STDIN"):
        print("setup is interactive: run it in a terminal.", file=sys.stderr)
        return 2
    username = input("Admin username: ").strip()
    if not username or len(username) > 64:
        print("username must be 1-64 characters", file=sys.stderr)
        return 2
    read = getpass.getpass if sys.stdin.isatty() else (lambda prompt: (print(prompt, end="", flush=True), sys.stdin.readline().rstrip("\n"))[1])
    password = read(f"Password (min {MIN_PASSWORD_LENGTH} chars): ")
    if password != read("Repeat password: "):
        print("passwords do not match", file=sys.stderr)
        return 2
    try:
        hashed = hash_password(password)
    except ValueError as err:
        print(str(err), file=sys.stderr)
        return 2
    role = "editor" if args.add else "owner"
    try:
        with write_tx(conn):
            cur = conn.execute("INSERT INTO admins (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)",
                               (username, hashed, role, now_ms()))
            audit(conn, "system", "admin.create", str(cur.lastrowid), role=role)
    except sqlite3.IntegrityError:
        print("that username already exists", file=sys.stderr)
        return 1
    conn.close()
    print(f"Created {role} account '{username}'.")
    return 0


def cmd_backup(args: argparse.Namespace) -> int:
    settings = load_settings()
    dest = Path(args.file).resolve()
    if dest.exists():
        print(f"refusing to overwrite {dest}", file=sys.stderr)
        return 1
    if args.full:
        from .recovery import backup_full
        try:
            backup_full(settings, dest)
        except (ValueError, OSError, sqlite3.Error) as err:
            print(f"full backup failed: {err}", file=sys.stderr)
            return 1
        print(f"full backup written: {dest}")
        return 0
    src = connect(settings.db_path)
    out = sqlite3.connect(dest)
    with out:
        src.backup(out)
    out.close()
    src.close()
    dest.chmod(0o600)
    print(f"backup written: {dest}")
    return 0


def cmd_restore(args: argparse.Namespace) -> int:
    settings = load_settings()
    src = Path(args.file).resolve()
    if args.full:
        from .recovery import restore_full
        try:
            keep = restore_full(settings, src)
        except (ValueError, OSError, sqlite3.Error) as err:
            print(f"full restore failed: {err}", file=sys.stderr)
            return 1
        if keep:
            print(f"previous data kept at {keep}")
        print(f"restored full bundle -> {settings.data_dir}")
        return 0
    check = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
    ok = check.execute("PRAGMA integrity_check").fetchone()[0]
    check.close()
    if ok != "ok":
        print(f"backup failed integrity check: {ok}", file=sys.stderr)
        return 1
    if settings.db_path.exists():
        keep = settings.db_path.with_suffix(f".pre-restore-{now_ms()}.sqlite3")
        shutil.move(settings.db_path, keep)
        for ext in ("-wal", "-shm"):
            Path(str(settings.db_path) + ext).unlink(missing_ok=True)
        print(f"previous database kept at {keep}")
    shutil.copyfile(src, settings.db_path)
    conn = connect(settings.db_path)
    try:
        migrate(conn)
    finally:
        conn.close()
    settings.db_path.chmod(0o600)
    print(f"restored {src} -> {settings.db_path}")
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    from .app import create_app

    if args.host not in {"127.0.0.1", "::1", "localhost"}:
        print(f"WARNING: binding to {args.host} exposes the API beyond this machine.", file=sys.stderr)
    uvicorn.run(create_app(), host=args.host, port=args.port, proxy_headers=False, server_header=False)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pi-admin", description="Practice Institute backend owner tools")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("migrate").set_defaults(fn=cmd_migrate)
    p = sub.add_parser("setup")
    p.add_argument("--add", action="store_true", help="add a further admin (editor role)")
    p.set_defaults(fn=cmd_setup)
    p = sub.add_parser("backup")
    p.add_argument("file")
    p.add_argument("--full", action="store_true", help="private DB + source directory bundle; stop server first")
    p.set_defaults(fn=cmd_backup)
    p = sub.add_parser("restore")
    p.add_argument("file")
    p.add_argument("--full", action="store_true", help="restore full directory bundle; stop server first")
    p.set_defaults(fn=cmd_restore)
    p = sub.add_parser("serve")
    p.add_argument("--host", default=os.environ.get("PI_HOST", "127.0.0.1"))
    p.add_argument("--port", type=int, default=int(os.environ.get("PI_PORT", "8787")))
    p.set_defaults(fn=cmd_serve)
    args = parser.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
