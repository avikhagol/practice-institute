"""Real-process tests of `pi-admin serve-desktop` / `setup-owner` (disposable temp data only)."""
from __future__ import annotations

import json
import io
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def env_for(data: Path) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if not k.startswith("PI_")}
    env.update(PI_DATA_DIR=str(data), PI_ALLOWED_ORIGINS="http://127.0.0.1:4318",
               PI_ADMIN_DIST=str(data.parent / "no-admin-dist"))
    return env


def spawn(data: Path, owner: int, public: int) -> subprocess.Popen:
    return subprocess.Popen([sys.executable, "-m", "practice_institute.cli", "serve-desktop", "--stdin-control",
                             "--owner-port", str(owner), "--public-port", str(public)],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            env=env_for(data), text=True)


def first_event(proc: subprocess.Popen, timeout: float = 30) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        line = proc.stdout.readline()
        if line:
            return json.loads(line)
        if proc.poll() is not None:
            break
    raise AssertionError(f"no event; stderr={proc.stderr.read()[-2000:]}")


def raw_get(port: int, target: str, headers: str = "") -> tuple[int, bytes]:
    with socket.create_connection(("127.0.0.1", port), timeout=5) as s:
        s.sendall(f"GET {target} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{headers}Connection: close\r\n\r\n".encode("latin-1"))
        data = b""
        while chunk := s.recv(65536):
            data += chunk
    status = int(data.split(b" ", 2)[1]) if data.startswith(b"HTTP/") else 0
    return status, data


@pytest.fixture
def runtime(tmp_path: Path):
    data = tmp_path / "Data dir with spaces ünï"
    owner, public = free_port(), free_port()
    proc = spawn(data, owner, public)
    event = first_event(proc)
    assert event["event"] == "ready", event
    yield data, owner, public, proc
    if proc.poll() is None:
        proc.stdin.close()
        proc.wait(timeout=15)


def test_ready_event_and_listener_split(runtime):
    data, owner, public, proc = runtime
    assert (data / "practice-institute.sqlite3").is_file()
    assert raw_get(owner, "/api/v1/health")[0] == 200
    assert raw_get(public, "/api/v1/health")[0] == 200
    assert raw_get(owner, "/api/admin/me")[0] == 401
    for target in ["/api/admin/me", "/admin/", "/", "/api/v10/health", "/api/v1/../admin/", "/api/v1/%2e%2e/admin/",
                   "/api/v1%2F..%2Fadmin%2F", "/api/v1/..%2fadmin", "//api/v1/health", "/api/v1/health%00",
                   "/api/v1/%61dmin", "/API/v1/health", "/api/v1;/health", "/api/v1/health/..",
                   "http://127.0.0.1/admin/", "/api/admin/sources/1/file", "/docs", "/openapi.json"]:
        status, _ = raw_get(public, target)
        assert status in (400, 404), (target, status)


def test_public_listener_cors_is_exact_origin(runtime):
    _data, _owner, public, _proc = runtime
    _, good = raw_get(public, "/api/v1/health", "Origin: http://127.0.0.1:4318\r\n")
    assert b"access-control-allow-origin: http://127.0.0.1:4318" in good.lower()
    _, bad = raw_get(public, "/api/v1/health", "Origin: http://localhost:4318\r\n")
    assert b"access-control-allow-origin" not in bad.lower()


def test_duplicate_runtime_is_refused_and_port_conflict_reported(runtime, tmp_path):
    data, owner, public, _proc = runtime
    second = spawn(data, free_port(), free_port())
    event = first_event(second)
    assert event == {"event": "error", "code": "already-running", "data_dir": str(data.resolve())}
    assert second.wait(timeout=15) == 4
    other = spawn(tmp_path / "other", owner, free_port())
    event = first_event(other)
    assert event["code"] == "port-in-use" and event["port"] == owner and event["listener"] == "owner"
    assert other.wait(timeout=15) == 3
    other = spawn(tmp_path / "other2", free_port(), public)
    assert first_event(other)["listener"] == "public"
    assert other.wait(timeout=15) == 3


def test_stdin_close_stops_gracefully_and_releases_lock(runtime):
    data, owner, public, proc = runtime
    proc.stdin.close()
    assert first_event(proc)["event"] == "stopping"
    assert first_event(proc) == {"event": "stopped", "ok": True}
    assert proc.wait(timeout=15) == 0
    again = spawn(data, owner, public)
    assert first_event(again)["event"] == "ready"
    again.stdin.write("stop\n")
    again.stdin.flush()
    assert again.wait(timeout=15) == 0


def run_setup(data: Path, payload: str) -> dict:
    out = subprocess.run([sys.executable, "-m", "practice_institute.cli", "setup-owner", "--stdin-json"],
                         input=payload, capture_output=True, text=True, env=env_for(data), timeout=60)
    assert out.stderr == ""
    return json.loads(out.stdout)


def status(data: Path) -> dict:
    out = subprocess.run([sys.executable, "-m", "practice_institute.cli", "owner-status"],
                         capture_output=True, text=True, env=env_for(data), timeout=60)
    return json.loads(out.stdout)


def test_gui_owner_setup_never_echoes_password(tmp_path):
    data = tmp_path / "d"
    secret = "Synthetic-" + os.urandom(6).hex()
    assert status(data)["owner_exists"] is False
    assert run_setup(data, "not json\n")["code"] == "bad-input"
    assert run_setup(data, json.dumps({"username": "o", "password": secret, "confirm": secret + "x"}))["code"] == "mismatch"
    assert run_setup(data, json.dumps({"username": "o", "password": "short", "confirm": "short"}))["code"] == "weak-password"
    assert run_setup(data, json.dumps({"username": "", "password": secret, "confirm": secret}))["code"] == "bad-username"
    created = run_setup(data, json.dumps({"username": "owner", "password": secret, "confirm": secret}))
    assert created["ok"] is True and secret not in json.dumps(created)
    assert status(data)["owner_exists"] is True
    again = run_setup(data, json.dumps({"username": "owner2", "password": secret, "confirm": secret}))
    assert again == {"ok": False, "code": "owner-exists", "message": "an owner account already exists"}


def test_exam_activity_read_only_boundaries(settings, clock, monkeypatch):
    from practice_institute import config
    from practice_institute.desktop import exam_activity
    from practice_institute.db import connect, migrate

    monkeypatch.setattr(config, "load_settings", lambda: settings)
    conn = connect(settings.db_path)
    migrate(conn)
    for i, (status, opens, closes) in enumerate([
        ("published", clock.t, clock.t + 10000),
        ("published", clock.t - 10000, clock.t),
        ("published", clock.t + 1, clock.t + 10000),
        ("draft", clock.t, clock.t + 10000),
        ("closed", clock.t, clock.t + 10000),
    ], 1):
        conn.execute("INSERT INTO exams (id,code,title,mode,status,duration_s,opens_at,closes_at,created_at) VALUES (?,?,?,'independent',?,60,?,?,0)",
                     (i, f"code{i}", "Synthetic", status, opens, closes))
    for i, (status, deadline) in enumerate([
        ("active", clock.t + 1000), ("active", clock.t - 1999),
        ("active", clock.t - 2000), ("active", clock.t - 2001),
        ("submitted", clock.t + 1000), ("expired", clock.t + 1000),
    ]):
        conn.execute("INSERT INTO attempts (id,exam_id,alias,alias_key,token_hash,status,joined_at,started_at,deadline_at,order_json) VALUES (?,1,?,?,?, ?,0,0,?,'[]')",
                     (str(i), str(i), str(i), str(i), status, deadline))
    before = list(conn.iterdump())
    out = io.StringIO()
    assert exam_activity(out) == 0
    assert json.loads(out.getvalue()) == {"active_attempts": 2, "open_exams": 1}
    assert list(conn.iterdump()) == before
    clock.advance(10)
    out = io.StringIO()
    exam_activity(out)
    assert json.loads(out.getvalue()) == {"active_attempts": 0, "open_exams": 0}
    conn.close()


def test_exam_activity_missing_profile_does_not_create_database(tmp_path):
    data = tmp_path / "not-created"
    r = subprocess.run([sys.executable, "-m", "practice_institute.cli", "exam-activity"],
                       capture_output=True, text=True, env=env_for(data), timeout=30)
    assert r.returncode == 0 and r.stderr == ""
    assert json.loads(r.stdout) == {"active_attempts": 0, "open_exams": 0}
    assert not data.exists()


def test_full_recovery_refuses_live_profile(runtime, tmp_path):
    data, _owner, _public, _proc = runtime
    for command in ["backup", "restore"]:
        r = subprocess.run([sys.executable, "-m", "practice_institute.cli", command, "--full", str(tmp_path / "bundle")],
                           capture_output=True, text=True, env=env_for(data), timeout=30)
        assert r.returncode == 4
        assert "stopped" in r.stderr
        assert not (tmp_path / "bundle").exists()
