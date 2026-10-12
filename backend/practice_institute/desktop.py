"""Desktop runtime: what the packaged launcher spawns (`pi-admin serve-desktop`).

One process, one FastAPI app, one SQLite writer, two loopback listeners:

  owner  127.0.0.1:<owner_port>   full app (admin UI, admin API, student API)
  public 127.0.0.1:<public_port>  StudentGateway: /api/v1 only (the tunnel target)

Launcher protocol (contract in PACKAGING.md, "Runtime process protocol"):
- stdout carries ONE JSON object per line: {"event": "ready" | "error" | "stopping" | "stopped", ...}.
  Nothing secret is ever written to stdout; logs go to stderr.
- Closing stdin (or writing a line "stop") requests a graceful shutdown. This works on
  Windows, where the launcher cannot deliver SIGTERM, and also stops the runtime when the
  launcher dies. SIGINT/SIGTERM do the same on POSIX.
- Exit codes: 0 clean stop, 2 configuration error, 3 port in use, 4 another runtime holds
  the profile lock.

A per-data-directory lock (OS file lock, released automatically when the process dies)
prevents two runtimes from writing one database, whatever launched them.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import signal
import socket
import sys
import threading
import time
from pathlib import Path
from typing import IO, Any, Iterator

EXIT_OK = 0
EXIT_CONFIG = 2
EXIT_PORT_IN_USE = 3
EXIT_LOCKED = 4
LOCK_NAME = "runtime.lock"
LOOPBACK = "127.0.0.1"


class RuntimeLocked(RuntimeError):
    pass


def emit(event: str, out: IO[str] | None = None, **fields: Any) -> None:
    stream = out or sys.stdout
    stream.write(json.dumps({"event": event, **fields}, sort_keys=True) + "\n")
    stream.flush()


@contextlib.contextmanager
def profile_lock(data_dir: Path) -> Iterator[Path]:
    """Exclusive non-blocking lock on <data_dir>/runtime.lock for the life of the runtime."""
    data_dir.mkdir(parents=True, exist_ok=True)
    path = data_dir / LOCK_NAME
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        try:
            if os.name == "nt":
                import msvcrt
                os.lseek(fd, 0, os.SEEK_SET)
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as err:
            raise RuntimeLocked(str(path)) from err
        # Informational only; the OS lock is the authority.
        os.ftruncate(fd, 0)
        os.write(fd, json.dumps({"pid": os.getpid(), "started_at": int(time.time() * 1000)}).encode())
        yield path
    finally:
        os.close(fd)


def bind_loopback(port: int) -> socket.socket:
    """Bind 127.0.0.1:<port> without SO_REUSEADDR sharing tricks. Raises OSError if taken."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    if os.name == "nt":
        # Refuse to share a port another process has bound (Windows default allows hijack).
        sock.setsockopt(socket.SOL_SOCKET, getattr(socket, "SO_EXCLUSIVEADDRUSE", -5), 1)
    else:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind((LOOPBACK, port))
        sock.listen(128)
    except OSError:
        sock.close()
        raise
    sock.setblocking(False)
    return sock


@contextlib.contextmanager
def writer_guard(data_dir: Path) -> Iterator[Path]:
    """Stable sibling lock: restoration can rename data_dir even on Windows.

    Both the managed runtime and full recovery acquire this lock. It lives outside
    the directory recovery swaps, so the open Windows lock handle cannot prevent
    the directory rename. The runtime also retains its documented profile lock.
    """
    with profile_lock(data_dir.parent / f".{data_dir.name}-writer-guard") as path:
        yield path


def _watch_stdin(loop: asyncio.AbstractEventLoop, stop: asyncio.Event, stream: IO[bytes]) -> None:
    try:
        for line in stream:
            if line.strip().lower() == b"stop":
                break
    except (OSError, ValueError):
        pass
    loop.call_soon_threadsafe(stop.set)


async def _run(owner_port: int, public_port: int | None, stdin: IO[bytes] | None, out: IO[str]) -> int:
    import uvicorn

    from .app import create_app
    from .gateway import OwnerHostGuard, StudentGateway

    class _Server(uvicorn.Server):
        @contextlib.contextmanager
        def capture_signals(self) -> Iterator[None]:  # signals are handled once, below
            yield

    try:
        owner_sock = bind_loopback(owner_port)
    except OSError:
        emit("error", out, code="port-in-use", port=owner_port, listener="owner")
        return EXIT_PORT_IN_USE
    public_sock = None
    if public_port is not None:
        try:
            public_sock = bind_loopback(public_port)
        except OSError:
            owner_sock.close()
            emit("error", out, code="port-in-use", port=public_port, listener="public")
            return EXIT_PORT_IN_USE

    app = create_app()
    common = dict(log_level="warning", access_log=False, proxy_headers=False, server_header=False,
                  date_header=True, lifespan="on")
    servers = [_Server(uvicorn.Config(OwnerHostGuard(app, owner_port), **common))]
    sockets = [owner_sock]
    if public_sock is not None:
        servers.append(_Server(uvicorn.Config(StudentGateway(app), **{**common, "lifespan": "off"})))
        sockets.append(public_sock)

    loop = asyncio.get_running_loop()
    stop = asyncio.Event()
    if stdin is not None:
        threading.Thread(target=_watch_stdin, args=(loop, stop, stdin), name="pi-stdin", daemon=True).start()
    if threading.current_thread() is threading.main_thread():
        for sig in (signal.SIGINT, signal.SIGTERM):
            with contextlib.suppress(ValueError, OSError):
                signal.signal(sig, lambda *_: loop.call_soon_threadsafe(stop.set))

    tasks = [asyncio.create_task(s.serve(sockets=[sock])) for s, sock in zip(servers, sockets)]
    while not all(s.started for s in servers):
        if any(t.done() for t in tasks) or stop.is_set():
            break
        await asyncio.sleep(0.05)
    if all(s.started for s in servers):
        emit("ready", out, pid=os.getpid(), owner_url=f"http://{LOOPBACK}:{owner_port}",
             public_url=f"http://{LOOPBACK}:{public_port}" if public_sock is not None else None)
        stopper = asyncio.create_task(stop.wait())
        await asyncio.wait([stopper, *tasks], return_when=asyncio.FIRST_COMPLETED)
        stopper.cancel()
    emit("stopping", out)
    for s in servers:
        s.should_exit = True
    results = await asyncio.gather(*tasks, return_exceptions=True)
    failed = [r for r in results if isinstance(r, BaseException)]
    emit("stopped", out, ok=not failed)
    return EXIT_OK if not failed else EXIT_CONFIG


def serve_desktop(owner_port: int, public_port: int | None, *, stdin: IO[bytes] | None = None,
                  out: IO[str] | None = None) -> int:
    from .config import load_settings

    out = out or sys.stdout
    settings = load_settings()
    if public_port is not None and public_port == owner_port:
        emit("error", out, code="config", message="owner and public ports must differ")
        return EXIT_CONFIG
    try:
        with writer_guard(settings.data_dir), profile_lock(settings.data_dir):
            return asyncio.run(_run(owner_port, public_port, stdin, out))
    except RuntimeLocked:
        emit("error", out, code="already-running", data_dir=str(settings.data_dir))
        return EXIT_LOCKED


def setup_owner_from_json(stream: IO[str], out: IO[str] | None = None) -> int:
    """First-run owner creation for the GUI. Reads ONE JSON line from stdin:
    {"username": str, "password": str, "confirm": str}. The password is never an argument,
    environment variable, log line or output field. Prints one JSON result line."""
    import sqlite3

    from .config import load_settings
    from .db import audit, connect, migrate, now_ms, write_tx
    from .security import MIN_PASSWORD_LENGTH, hash_password

    out = out or sys.stdout

    def result(ok: bool, code: str, message: str = "") -> int:
        out.write(json.dumps({"ok": ok, "code": code, "message": message}) + "\n")
        out.flush()
        return 0 if ok else 1

    try:
        body = json.loads(stream.readline(64 * 1024) or "null")
    except ValueError:
        return result(False, "bad-input", "expected one JSON object")
    if not isinstance(body, dict) or not all(isinstance(body.get(k), str) for k in ("username", "password", "confirm")):
        return result(False, "bad-input", "username, password and confirm are required")
    username = body["username"].strip()
    if not username or len(username) > 64 or any(ord(c) < 32 for c in username):
        return result(False, "bad-username", "username must be 1-64 printable characters")
    if body["password"] != body["confirm"]:
        return result(False, "mismatch", "passwords do not match")
    if len(body["password"]) < MIN_PASSWORD_LENGTH:
        return result(False, "weak-password", f"password must be at least {MIN_PASSWORD_LENGTH} characters")
    settings = load_settings()
    conn = connect(settings.db_path)
    try:
        migrate(conn)
        hashed = hash_password(body["password"])
        with write_tx(conn):
            if conn.execute("SELECT COUNT(*) FROM admins").fetchone()[0]:
                return result(False, "owner-exists", "an owner account already exists")
            cur = conn.execute("INSERT INTO admins (username, password_hash, role, created_at) VALUES (?, ?, 'owner', ?)",
                               (username, hashed, now_ms()))
            audit(conn, "system", "admin.create", str(cur.lastrowid), role="owner", via="desktop")
    except sqlite3.IntegrityError:
        return result(False, "owner-exists", "that username already exists")
    finally:
        conn.close()
    return result(True, "created", f"owner account '{username}' created")


def owner_status(out: IO[str] | None = None) -> int:
    """Prints {"owner_exists": bool, "migrations": [...]} for first-run detection."""
    from .config import load_settings
    from .db import connect, migrate

    out = out or sys.stdout
    settings = load_settings()
    conn = connect(settings.db_path)
    try:
        migrate(conn)
        exists = bool(conn.execute("SELECT COUNT(*) FROM admins WHERE role='owner'").fetchone()[0])
        names = [r[0] for r in conn.execute("SELECT name FROM schema_migrations ORDER BY version")]
    finally:
        conn.close()
    out.write(json.dumps({"owner_exists": exists, "migrations": names}) + "\n")
    out.flush()
    return 0


def exam_activity(out: IO[str] | None = None) -> int:
    """Read-only snapshot for launcher recovery guards; never migrate or sweep data."""
    import sqlite3

    from .config import load_settings
    from .db import now_ms

    settings = load_settings()
    active = opened = 0
    if settings.db_path.exists():
        conn = sqlite3.connect(settings.db_path.as_uri() + "?mode=ro", uri=True, timeout=15)
        try:
            conn.execute("PRAGMA query_only=ON")
            conn.execute("BEGIN")
            now = now_ms()
            active = conn.execute(
                "SELECT COUNT(*) FROM attempts WHERE status='active' AND deadline_at + ? > ?",
                (settings.submit_grace_ms, now),
            ).fetchone()[0]
            opened = conn.execute(
                "SELECT COUNT(*) FROM exams WHERE status='published' AND opens_at <= ? AND closes_at > ?",
                (now, now),
            ).fetchone()[0]
        finally:
            conn.close()
    stream = out or sys.stdout
    stream.write(json.dumps({"active_attempts": active, "open_exams": opened}) + "\n")
    stream.flush()
    return 0
