"""Disposable fixtures only: every test gets a fresh temp database and throwaway admin."""

from __future__ import annotations

import secrets
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from practice_institute import app as app_mod
from practice_institute import db as db_mod
from practice_institute import exams as exams_mod
from practice_institute.config import load_settings
from practice_institute.db import connect, migrate
from practice_institute.security import hash_password

STUDENT_ORIGIN = "http://127.0.0.1:4318"


class Clock:
    def __init__(self, start: int) -> None:
        self.t = start

    def __call__(self) -> int:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += int(seconds * 1000)


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> Clock:
    c = Clock(1_900_000_000_000)
    for mod in (app_mod, db_mod, exams_mod):
        monkeypatch.setattr(mod, "now_ms", c)
    return c


@pytest.fixture
def settings(tmp_path: Path):
    base = load_settings()
    return replace(base, db_path=tmp_path / "test.sqlite3", data_dir=tmp_path,
                   allowed_origins=[STUDENT_ORIGIN], expiry_sweep_s=3600.0, submit_grace_ms=2000)


@pytest.fixture
def admin_password(settings) -> str:
    password = secrets.token_urlsafe(18)  # random per test run, never printed
    conn = connect(settings.db_path)
    migrate(conn)
    conn.execute("INSERT INTO admins (username, password_hash, role, created_at) VALUES ('owner', ?, 'owner', 0)",
                 (hash_password(password),))
    conn.close()
    return password


@pytest.fixture
def client(settings, admin_password, clock) -> TestClient:
    with TestClient(app_mod.create_app(settings), base_url="http://127.0.0.1:8787") as c:
        yield c


@pytest.fixture
def admin(client: TestClient, admin_password: str) -> TestClient:
    """Same client, logged in, with CSRF header attached for mutations."""
    r = client.post("/api/admin/login", json={"username": "owner", "password": admin_password})
    assert r.status_code == 200, r.text
    client.headers["X-CSRF-Token"] = r.json()["csrf_token"]
    return client


BILINGUAL = [
    {"stem_en": "Which number is even?", "stem_hi": "कौन-सी संख्या सम है?",
     "options": [{"key": "A", "en": "3", "hi": "३"}, {"key": "B", "en": "4", "hi": "४"},
                 {"key": "C", "en": "5", "hi": "५"}, {"key": "D", "en": "7", "hi": "७"}],
     "answer_key": "B", "explanation_en": "4 is divisible by 2.", "status": "reviewed", "key_verified": True},
    {"stem_en": "Capital of India?", "stem_hi": None,
     "options": [{"key": "A", "en": "Delhi"}, {"key": "B", "en": "Mumbai"},
                 {"key": "C", "en": "Pune"}, {"key": "D", "en": "Agra"}],
     "answer_key": "A", "status": "reviewed", "key_verified": True},
    {"stem_en": None, "stem_hi": "भारत का राष्ट्रीय पशु कौन है?",
     "options": [{"key": "A", "hi": "बाघ"}, {"key": "B", "hi": "शेर"},
                 {"key": "C", "hi": "हाथी"}, {"key": "D", "hi": "मोर"}],
     "answer_key": "A", "status": "reviewed", "key_verified": True},
]


def make_exam(admin: TestClient, clock: Clock, *, mode: str = "independent", duration_s: int = 600,
              opens_in_s: int = 0, window_s: int = 3600, **extra) -> dict:
    ids = admin.post("/api/admin/questions", json=BILINGUAL).json()["ids"]
    body = {"title": "Synthetic demo exam", "mode": mode, "duration_s": duration_s,
            "opens_at": clock.t + opens_in_s * 1000, "closes_at": clock.t + (opens_in_s + window_s) * 1000,
            "question_ids": ids, "marks_correct": 1, "marks_wrong": 0.25, **extra}
    r = admin.post("/api/admin/exams", json=body)
    assert r.status_code == 201, r.text
    exam = r.json()
    r = admin.post(f"/api/admin/exams/{exam['id']}/publish")
    assert r.status_code == 200, r.text
    return exam
