"""Practice Institute API.

Two permission domains:
- /api/v1/*    student API. Cross-origin allowed only for PI_ALLOWED_ORIGINS, no cookies.
               An attempt is authorised by its resume secret (Authorization: Bearer ...).
- /api/admin/* admin API. Same-origin only, HttpOnly session cookie + X-CSRF-Token header.
"""

# No `from __future__ import annotations`: FastAPI must resolve the closure-local
# dependency aliases (Db, Admin, Attempt) at definition time.
import json
import math
import csv
import hashlib
import io
import ipaddress
import random
from pathlib import Path
import re
import secrets
import sqlite3
import threading
import unicodedata
from contextlib import asynccontextmanager
from typing import Annotated, Any, Iterator, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pypdf import PdfReader
from pydantic import BaseModel, Field, field_validator

from . import exams as ex
from .config import Settings, load_settings
from .db import audit, connect, migrate, now_ms, write_tx
from .security import DUMMY_HASH, RateLimiter, new_token, same, token_hash, verify_password

SESSION_COOKIE = "pi_admin_session"
API_VERSION = "1"
OPTION_KEY_RE = re.compile(r"^[A-E]$")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    limiter = RateLimiter()

    boot = connect(settings.db_path)
    migrate(boot)
    boot.close()

    stop = threading.Event()

    def sweeper() -> None:
        conn = connect(settings.db_path)
        try:
            while not stop.wait(settings.expiry_sweep_s):
                try:
                    ex.sweep_expired(conn, settings.submit_grace_ms)
                except sqlite3.Error:
                    pass  # retried next tick; lazy finalisation on access also applies
        finally:
            conn.close()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        thread = threading.Thread(target=sweeper, name="pi-expiry-sweeper", daemon=True)
        thread.start()
        yield
        stop.set()
        thread.join(timeout=5)

    app = FastAPI(title="Practice Institute API", version="0.1.0", lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings = settings
    app.state.limiter = limiter

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
        max_age=600,
    )

    @app.middleware("http")
    async def guard(request: Request, call_next):
        path = request.url.path
        if path.startswith("/api/admin"):
            origin = request.headers.get("origin")
            if origin and origin.rstrip("/") != _self_origin(request):
                return JSONResponse({"error": "cross-origin-admin-forbidden"}, status_code=403)
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            limit = settings.max_upload_bytes if path.endswith("/upload") else settings.max_body_bytes
            length = request.headers.get("content-length")
            if length is None:
                if request.headers.get("transfer-encoding"):
                    return JSONResponse({"error": "length-required"}, status_code=411)
            elif not length.isdigit() or int(length) > limit:
                return JSONResponse({"error": "body-too-large", "limit": limit}, status_code=413)
        response = await call_next(request)
        response.headers.setdefault("Cache-Control", "no-store")
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("X-Frame-Options", "DENY")
        return response

    # ---------- dependencies ----------

    def get_db() -> Iterator[sqlite3.Connection]:
        conn = connect(settings.db_path)
        try:
            yield conn
        finally:
            conn.close()

    Db = Annotated[sqlite3.Connection, Depends(get_db)]

    def client_id(request: Request) -> str:
        # `pi_public` is set only by StudentGateway (the tunnel-facing listener), never from a header.
        # cf-connecting-ip is trusted solely there; the owner listener must never key on it.
        if request.scope.get("pi_public"):
            try:
                return str(ipaddress.ip_address(request.headers.get("cf-connecting-ip", "").strip()))
            except ValueError:
                pass
        if settings.trust_proxy_headers:
            forwarded = request.headers.get("x-forwarded-for", "")
            if forwarded:
                return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    def require_admin(request: Request, db: Db, x_csrf_token: Annotated[str | None, Header()] = None) -> sqlite3.Row:
        raw = request.cookies.get(SESSION_COOKIE)
        if not raw:
            raise HTTPException(401, "admin login required")
        row = db.execute(
            "SELECT s.*, a.username, a.role FROM admin_sessions s JOIN admins a ON a.id = s.admin_id "
            "WHERE s.token_hash = ? AND s.expires_at > ?", (token_hash(raw), now_ms())).fetchone()
        if row is None:
            raise HTTPException(401, "admin session expired")
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            if not x_csrf_token or not same(x_csrf_token, row["csrf_token"]):
                raise HTTPException(403, "missing or invalid CSRF token")
        return row

    Admin = Annotated[sqlite3.Row, Depends(require_admin)]

    def require_attempt(attempt_id: str, db: Db, authorization: Annotated[str | None, Header()] = None) -> sqlite3.Row:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(401, "attempt token required")
        row = db.execute("SELECT * FROM attempts WHERE id = ?", (attempt_id,)).fetchone()
        # Same 404 for unknown id and wrong token: do not reveal which attempts exist.
        if row is None or not same(row["token_hash"], token_hash(authorization[7:].strip())):
            raise HTTPException(404, "attempt not found")
        if row["status"] == "active" and now_ms() > row["deadline_at"] + settings.submit_grace_ms:
            ex.finalize(db, attempt_id, "timeout", expiry_grace_ms=settings.submit_grace_ms)
            row = db.execute("SELECT * FROM attempts WHERE id = ?", (attempt_id,)).fetchone()
        return row

    Attempt = Annotated[sqlite3.Row, Depends(require_attempt)]

    # ---------- public ----------

    @app.get("/api/v1/health")
    def health(db: Db) -> dict[str, Any]:
        db.execute("SELECT 1").fetchone()
        return {"status": "ok", "service": "practice-institute", "api_version": API_VERSION, "server_now": now_ms()}

    @app.get("/api/v1/time")
    def server_time() -> dict[str, int]:
        return {"server_now": now_ms()}

    def _exam_by_code(db: sqlite3.Connection, code: str) -> sqlite3.Row:
        row = db.execute("SELECT * FROM exams WHERE code = ? AND status IN ('published', 'closed')",
                         (code.strip().upper(),)).fetchone()
        if row is None:
            raise HTTPException(404, "no published exam with that code")
        return row

    def _exam_public(exam: sqlite3.Row) -> dict[str, Any]:
        snapshot = json.loads(exam["snapshot_json"])
        langs = {lang for q in snapshot["questions"] for lang in ("en", "hi") if q["stem"][lang]}
        return {
            "code": exam["code"], "title": exam["title"], "instructions": exam["instructions"],
            "mode": exam["mode"], "status": exam["status"], "scored": bool(exam["scored"]),
            "duration_s": exam["duration_s"], "opens_at": exam["opens_at"], "closes_at": exam["closes_at"],
            "late_join_s": exam["late_join_s"], "question_count": exam["subset_count"] or len(snapshot["questions"]),
            "pool_count": len(snapshot["questions"]), "max_attempts": exam["max_attempts"],
            "random_subset": exam["subset_count"] is not None,
            "languages": sorted(langs), "marks": snapshot["marks"], "server_now": now_ms(),
        }

    @app.get("/api/v1/exams/{code}")
    def exam_lookup(code: str, db: Db) -> dict[str, Any]:
        return _exam_public(_exam_by_code(db, code))

    class JoinIn(BaseModel):
        alias: str = Field(min_length=2, max_length=40)

        @field_validator("alias")
        @classmethod
        def clean(cls, v: str) -> str:
            v = unicodedata.normalize("NFC", " ".join(v.split()))
            if len(v) < 2 or any(unicodedata.category(c).startswith("C") for c in v):
                raise ValueError("alias must be 2-40 printable characters")
            return v

    @app.post("/api/v1/exams/{code}/join", status_code=201)
    def join(code: str, body: JoinIn, request: Request, db: Db) -> dict[str, Any]:
        if not limiter.allow("join", client_id(request), settings.join_rate_per_min):
            raise HTTPException(429, "too many join attempts; wait a minute")
        exam = _exam_by_code(db, code)
        return _new_attempt(db, exam, body.alias, body.alias.casefold())

    def _new_attempt(db: sqlite3.Connection, exam: sqlite3.Row, alias: str, identity: str,
                     previous: sqlite3.Row | None = None) -> dict[str, Any]:
        snapshot = json.loads(exam["snapshot_json"])
        attempt_id = secrets.token_urlsafe(12)
        token = new_token()
        with write_tx(db):
            # Recheck schedule under the write lock: an owner close/extension can
            # race enrollment, and no new active attempt may enter a closed exam.
            exam = db.execute("SELECT * FROM exams WHERE id=?", (exam["id"],)).fetchone()
            t = now_ms()
            if exam["status"] != "published" or t >= exam["closes_at"]:
                raise HTTPException(409, "this exam is closed")
            if exam["mode"] == "cohort":
                if t > exam["opens_at"] + exam["late_join_s"] * 1000:
                    raise HTTPException(409, "late joining has closed for this cohort exam")
                started = exam["opens_at"]
            else:
                if t < exam["opens_at"]:
                    raise HTTPException(409, "this exam's availability window has not opened yet")
                started = t
            deadline = min(started + exam["duration_s"] * 1000, exam["closes_at"])
            if t >= deadline:
                raise HTTPException(409, "this exam's answering time has ended")
            rows = db.execute("SELECT * FROM attempts WHERE exam_id=? AND identity_key=? ORDER BY attempt_number",
                              (exam["id"], identity)).fetchall()
            if rows and previous is None:
                raise HTTPException(409, "that name is already used in this exam — resume with your saved attempt link or pick another name")
            if previous is not None and (not rows or rows[-1]["id"] != previous["id"]):
                raise HTTPException(409, "resume your latest attempt before trying again")
            if any(row["status"] == "active" for row in rows):
                raise HTTPException(409, "finish your current attempt before trying again")
            number = len(rows) + 1
            if number > exam["max_attempts"]:
                raise HTTPException(409, "attempt limit reached for this exam")
            order = ex.attempt_order(attempt_id, len(snapshot["questions"]), exam["shuffle"],
                                     exam["subset_count"], exam["subset_seed"])
            # Keep the legacy unique alias key for first enrollment; later attempts have
            # distinct storage keys and share the explicit identity_key and number.
            alias_key = identity if number == 1 else f"{identity}:attempt:{attempt_id}"
            db.execute(
                "INSERT INTO attempts (id, exam_id, alias, alias_key, identity_key, attempt_number, token_hash, joined_at, started_at, deadline_at, order_json) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (attempt_id, exam["id"], alias, alias_key, identity, number, token_hash(token), t, started, deadline, json.dumps(order)))
            audit(db, f"attempt:{attempt_id}", "attempt.join", exam["code"], attempt_number=number)
        return {"attempt_id": attempt_id, "token": token, "exam": _exam_public(exam),
                "started_at": started, "deadline_at": deadline, "server_now": now_ms()}

    @app.post("/api/v1/attempts/{attempt_id}/reattempt", status_code=201)
    def reattempt(attempt: Attempt, request: Request, db: Db):
        if not limiter.allow("join", client_id(request), settings.join_rate_per_min):
            raise HTTPException(429, "too many join attempts; wait a minute")
        exam = db.execute("SELECT * FROM exams WHERE id=?", (attempt["exam_id"],)).fetchone()
        t = now_ms()
        if exam["mode"] != "independent" or exam["status"] != "published" or not exam["opens_at"] <= t < exam["closes_at"]:
            raise HTTPException(409, "reattempts require an open independent exam")
        return _new_attempt(db, exam, attempt["alias"], attempt["identity_key"], previous=attempt)

    def _attempt_state(db: sqlite3.Connection, attempt: sqlite3.Row) -> dict[str, Any]:
        exam = db.execute("SELECT * FROM exams WHERE id = ?", (attempt["exam_id"],)).fetchone()
        t = now_ms()
        phase = "lobby" if attempt["status"] == "active" and t < attempt["started_at"] else (
            "running" if attempt["status"] == "active" else "finished")
        out: dict[str, Any] = {
            "attempt_id": attempt["id"], "alias": attempt["alias"], "attempt_number": attempt["attempt_number"], "status": attempt["status"], "phase": phase,
            "finish_reason": attempt["finish_reason"], "started_at": attempt["started_at"],
            "deadline_at": attempt["deadline_at"], "finished_at": attempt["finished_at"],
            "last_seq": attempt["last_seq"], "server_now": t, "exam": _exam_public(exam),
            "questions": [], "answers": {},
        }
        if phase != "lobby":
            snapshot = json.loads(exam["snapshot_json"])
            out["questions"] = [ex.public_question(snapshot["questions"][i]) for i in json.loads(attempt["order_json"])]
            out["answers"] = {qid: {"choice": r["choice"], "marked": bool(r["marked"]), "seq": r["seq"]}
                              for qid, r in ex.load_answers(db, attempt["id"]).items()}
        return out

    @app.get("/api/v1/attempts/{attempt_id}")
    def attempt_state(attempt: Attempt, db: Db) -> dict[str, Any]:
        return _attempt_state(db, attempt)

    class Change(BaseModel):
        qid: str = Field(max_length=16)
        choice: str | None = None
        marked: bool = False
        seq: int = Field(ge=1)

    class SaveIn(BaseModel):
        changes: list[Change] = Field(max_length=500)

    def _apply_changes(db: sqlite3.Connection, attempt: sqlite3.Row, changes: list[Change]) -> dict[str, int]:
        exam = db.execute("SELECT e.snapshot_json, a.order_json FROM exams e JOIN attempts a ON a.exam_id=e.id WHERE a.id = ?", (attempt["id"],)).fetchone()
        questions = json.loads(exam["snapshot_json"])["questions"]
        valid = {questions[i]["qid"]: {o["key"] for o in questions[i]["options"]} for i in json.loads(exam["order_json"])}
        acked: dict[str, int] = {}
        t = now_ms()
        for c in changes:
            if c.qid not in valid or (c.choice is not None and c.choice not in valid[c.qid]):
                raise HTTPException(422, f"invalid answer for {c.qid}")
            # Per-question last-writer-by-sequence: a stale/replayed change never overwrites a newer one.
            db.execute(
                "INSERT INTO answers (attempt_id, qid, choice, marked, seq, saved_at) VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT (attempt_id, qid) DO UPDATE SET choice=excluded.choice, marked=excluded.marked, "
                "seq=excluded.seq, saved_at=excluded.saved_at WHERE excluded.seq > answers.seq",
                (attempt["id"], c.qid, c.choice, int(c.marked), c.seq, t))
            acked[c.qid] = max(acked.get(c.qid, 0), c.seq)
        if changes:
            db.execute("UPDATE attempts SET last_seq = MAX(last_seq, ?) WHERE id = ?",
                       (max(c.seq for c in changes), attempt["id"]))
        return acked

    def _require_open(db: sqlite3.Connection, attempt_id: str) -> sqlite3.Row:
        row = db.execute("SELECT * FROM attempts WHERE id = ?", (attempt_id,)).fetchone()
        t = now_ms()
        if row["status"] != "active":
            raise HTTPException(409, "attempt already finished")
        if t < row["started_at"]:
            raise HTTPException(409, "exam has not started yet")
        if t > row["deadline_at"] + settings.submit_grace_ms:
            raise HTTPException(409, "deadline passed")
        return row

    @app.post("/api/v1/attempts/{attempt_id}/answers")
    def save_answers(body: SaveIn, attempt: Attempt, db: Db) -> dict[str, Any]:
        with write_tx(db):
            row = _require_open(db, attempt["id"])
            acked = _apply_changes(db, row, body.changes)
            last = db.execute("SELECT last_seq FROM attempts WHERE id = ?", (row["id"],)).fetchone()[0]
        return {"acked": acked, "last_seq": last, "server_now": now_ms(), "deadline_at": row["deadline_at"]}

    @app.post("/api/v1/attempts/{attempt_id}/submit")
    def submit(body: SaveIn, attempt: Attempt, db: Db) -> dict[str, Any]:
        with write_tx(db):
            row = db.execute("SELECT * FROM attempts WHERE id = ?", (attempt["id"],)).fetchone()
            if row["status"] == "active":
                row = _require_open(db, row["id"])
                _apply_changes(db, row, body.changes)
                ex.finalize(db, row["id"], "submitted", in_tx=True)
        final = db.execute("SELECT * FROM attempts WHERE id = ?", (attempt["id"],)).fetchone()
        # Idempotent: repeating submit returns the same acknowledged final state.
        return {"status": final["status"], "finish_reason": final["finish_reason"],
                "finished_at": final["finished_at"], "server_now": now_ms()}

    @app.get("/api/v1/attempts/{attempt_id}/result")
    def result(attempt: Attempt, db: Db) -> dict[str, Any]:
        if attempt["status"] == "active":
            raise HTTPException(409, "attempt still in progress")
        exam = db.execute("SELECT * FROM exams WHERE id = ?", (attempt["exam_id"],)).fetchone()
        out: dict[str, Any] = {"status": attempt["status"], "finish_reason": attempt["finish_reason"],
                               "scores_released": bool(exam["release_scores"]),
                               "answers_released": bool(exam["release_answers"])}
        if exam["release_scores"]:
            out.update(score=attempt["score"], correct=attempt["correct"], wrong=attempt["wrong"],
                       unanswered=attempt["unanswered"], total=len(json.loads(attempt["order_json"])))
        if exam["release_answers"]:
            snapshot = json.loads(exam["snapshot_json"])
            mine = ex.load_answers(db, attempt["id"])
            out["review"] = [
                {**ex.public_question(q), "answer_key": q["answer_key"], "explanation": q["explanation"],
                 "your_choice": mine[q["qid"]]["choice"] if q["qid"] in mine else None}
                for q in (snapshot["questions"][i] for i in json.loads(attempt["order_json"]))]
        return out

    # ---------- admin ----------

    class LoginIn(BaseModel):
        username: str = Field(min_length=1, max_length=64)
        password: str = Field(min_length=1, max_length=256)

    @app.post("/api/admin/login")
    def admin_login(body: LoginIn, request: Request, response: Response, db: Db) -> dict[str, Any]:
        if not limiter.allow("login", client_id(request), settings.login_rate_per_min):
            raise HTTPException(429, "too many login attempts; wait a minute")
        admin = db.execute("SELECT * FROM admins WHERE username = ?", (body.username,)).fetchone()
        ok = verify_password(admin["password_hash"] if admin else DUMMY_HASH, body.password)
        if not admin or not ok:
            with write_tx(db):
                audit(db, "anon", "admin.login_failed", body.username[:64], ip=client_id(request))
            raise HTTPException(401, "invalid username or password")
        token, csrf = new_token(), new_token()
        with write_tx(db):
            db.execute("DELETE FROM admin_sessions WHERE expires_at < ?", (now_ms(),))
            db.execute("INSERT INTO admin_sessions (token_hash, csrf_token, admin_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
                       (token_hash(token), csrf, admin["id"], now_ms(), now_ms() + settings.session_ttl_s * 1000))
            audit(db, f"admin:{admin['id']}", "admin.login", ip=client_id(request))
        response.set_cookie(SESSION_COOKIE, token, max_age=settings.session_ttl_s, httponly=True,
                            secure=settings.cookie_secure, samesite="strict", path="/")
        return {"username": admin["username"], "role": admin["role"], "csrf_token": csrf}

    @app.get("/api/admin/me")
    def admin_me(admin: Admin) -> dict[str, Any]:
        return {"username": admin["username"], "role": admin["role"], "csrf_token": admin["csrf_token"]}

    @app.post("/api/admin/logout")
    def admin_logout(admin: Admin, response: Response, db: Db) -> dict[str, bool]:
        with write_tx(db):
            db.execute("DELETE FROM admin_sessions WHERE id = ?", (admin["id"],))
            audit(db, f"admin:{admin['admin_id']}", "admin.logout")
        response.delete_cookie(SESSION_COOKIE, path="/")
        return {"ok": True}

    def owner(admin: sqlite3.Row) -> None:
        if admin["role"] != "owner":
            raise HTTPException(403, "owner role required")

    @app.get("/api/admin/sources")
    def list_sources(admin: Admin, db: Db):
        rows = db.execute("SELECT id, filename, sha256, size_bytes, page_count, label, exam_body, year, subject, synthetic, provenance, consent, created_at FROM sources ORDER BY id DESC")
        return {"sources": [dict(r) for r in rows], "max_upload_bytes": settings.max_upload_bytes, "max_pages": settings.max_source_pages}

    @app.post("/api/admin/sources/upload", status_code=201)
    async def upload_source(admin: Admin, db: Db, file: UploadFile = File(),
                            label: str = Form(min_length=1, max_length=200),
                            provenance: str = Form(min_length=1, max_length=4000),
                            consent: bool = Form(), year: str = Form(default="", max_length=16),
                            subject: str = Form(default="", max_length=120),
                            exam_body: str = Form(default="", max_length=120), synthetic: bool = Form(default=False)):
        if not consent or not label.strip() or not provenance.strip():
            raise HTTPException(422, "provenance and permission to store this source are required")
        raw = await file.read(settings.max_upload_bytes + 1)
        await file.close()
        if len(raw) > settings.max_upload_bytes:
            raise HTTPException(413, "PDF exceeds upload limit")
        if not raw.startswith(b"%PDF-"):
            raise HTTPException(422, "file is not a PDF")
        try:
            reader = PdfReader(io.BytesIO(raw), strict=True)
            if reader.is_encrypted:
                raise ValueError("encrypted PDF")
            pages = len(reader.pages)
            if not 1 <= pages <= settings.max_source_pages:
                raise ValueError(f"PDF must contain 1–{settings.max_source_pages} pages")
        except Exception as err:
            raise HTTPException(422, "PDF is invalid, encrypted, or exceeds the page limit") from err
        digest = hashlib.sha256(raw).hexdigest()
        folder = settings.data_dir / "sources"
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / f"{digest}.pdf"
        with write_tx(db):
            duplicate = db.execute("SELECT id FROM sources WHERE sha256=?", (digest,)).fetchone()
            if duplicate:
                return {"id": duplicate["id"], "duplicate": True, "page_count": pages}
            target.write_bytes(raw)
            cur = db.execute("INSERT INTO sources (filename, sha256, size_bytes, page_count, label, provenance, consent, stored_path, year, subject, exam_body, synthetic, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)",
                             (Path(file.filename or "source.pdf").name, digest, len(raw), pages, label.strip(), provenance.strip(), str(target), year or None, subject or None, exam_body or None, int(synthetic), now_ms()))
            audit(db, f"admin:{admin['admin_id']}", "source.upload", str(cur.lastrowid), sha256=digest)
        return {"id": cur.lastrowid, "duplicate": False, "page_count": pages}

    @app.get("/api/admin/sources/{source_id}/file")
    def source_file(source_id: int, admin: Admin, db: Db):
        row = db.execute("SELECT * FROM sources WHERE id=?", (source_id,)).fetchone()
        if row is None or not row["stored_path"] or not Path(row["stored_path"]).is_file():
            raise HTTPException(404, "source not found")
        return FileResponse(row["stored_path"], media_type="application/pdf", filename=row["filename"])

    class OptionIn(BaseModel):
        key: str
        en: str | None = Field(default=None, max_length=4000)
        hi: str | None = Field(default=None, max_length=4000)

        @field_validator("key")
        @classmethod
        def key_ok(cls, v: str) -> str:
            if not OPTION_KEY_RE.match(v):
                raise ValueError("option key must be A-E")
            return v

    class QuestionIn(BaseModel):
        stem_en: str | None = Field(default=None, max_length=8000)
        stem_hi: str | None = Field(default=None, max_length=8000)
        context_en: str | None = Field(default=None, max_length=20000)
        context_hi: str | None = Field(default=None, max_length=20000)
        options: list[OptionIn] = Field(min_length=2, max_length=5)
        answer_key: str | None = None
        explanation_en: str | None = None
        explanation_hi: str | None = None
        subject: str | None = None
        year: str | None = None
        source_id: int | None = None
        source_number: int | None = Field(default=None, ge=1)
        source_page: int | None = Field(default=None, ge=1)
        crop_json: str | None = Field(default=None, max_length=500)
        status: Literal["needs-review", "reviewed", "excluded"] = "needs-review"
        origin: Literal["manual", "text-layer", "ocr", "import"] = "manual"
        warnings: list[str] = Field(default_factory=list, max_length=50)
        key_verified: bool = False

    def _check_question(q: QuestionIn) -> None:
        if not (q.stem_en or q.stem_hi):
            raise HTTPException(422, "a question needs an English or Hindi stem")
        keys = [o.key for o in q.options]
        if any(not (o.en or o.hi) for o in q.options):
            raise HTTPException(422, "every option needs original text in at least one language")
        if len(set(keys)) != len(keys):
            raise HTTPException(422, "duplicate option keys")
        if q.answer_key is not None and q.answer_key not in keys:
            raise HTTPException(422, "answer key must match an option key")
        if q.crop_json is not None:
            try:
                crop = json.loads(q.crop_json)
                if not isinstance(crop, dict) or set(crop) != {"page", "x", "y", "w", "h"}:
                    raise ValueError("crop fields")
                if type(crop["page"]) is not int or crop["page"] < 1:
                    raise ValueError("crop page")
                if q.source_page is not None and crop["page"] != q.source_page:
                    raise ValueError("crop page differs from source")
                for field in ("x", "y", "w", "h"):
                    value = crop[field]
                    if type(value) not in (int, float) or not math.isfinite(value):
                        raise ValueError("crop coordinate")
                if not (0 <= crop["x"] < 1 and 0 <= crop["y"] < 1 and
                        0 < crop["w"] <= 1 and 0 < crop["h"] <= 1 and
                        crop["x"] + crop["w"] <= 1 + 1e-9 and crop["y"] + crop["h"] <= 1 + 1e-9):
                    raise ValueError("crop bounds")
            except (ValueError, TypeError, KeyError):
                raise HTTPException(422, "crop must contain a valid page and normalized x/y/w/h bounds")
        if q.origin != "manual" and q.status == "reviewed":
            # OCR output is never auto-published: it must be reviewed via an explicit PATCH.
            raise HTTPException(422, "extracted questions must be imported as needs-review")

    @app.post("/api/admin/questions", status_code=201)
    def create_questions(body: list[QuestionIn], admin: Admin, db: Db) -> dict[str, Any]:
        if len(body) > 500:
            raise HTTPException(413, "at most 500 questions per request")
        for q in body:
            _check_question(q)
        ids = []
        t = now_ms()
        with write_tx(db):
            for q in body:
                if q.source_id is not None:
                    source = db.execute("SELECT page_count FROM sources WHERE id=?", (q.source_id,)).fetchone()
                    if source is None or not q.source_page or not 1 <= q.source_page <= source["page_count"]:
                        raise HTTPException(422, "invalid source or page")
                if q.source_id is not None and q.source_number is not None and db.execute("SELECT 1 FROM questions WHERE source_id=? AND source_number=?", (q.source_id, q.source_number)).fetchone():
                    raise HTTPException(409, "this source question number is already imported")
                cur = db.execute(
                    "INSERT INTO questions (source_id, source_number, source_page, crop_json, subject, year, context_en, context_hi, "
                    "stem_en, stem_hi, options_json, answer_key, explanation_en, explanation_hi, status, origin, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (q.source_id, q.source_number, q.source_page, q.crop_json, q.subject, q.year, q.context_en, q.context_hi,
                     q.stem_en, q.stem_hi, json.dumps([o.model_dump() for o in q.options], ensure_ascii=False),
                     q.answer_key, q.explanation_en, q.explanation_hi, q.status, q.origin, t, t))
                db.execute("UPDATE questions SET key_verified=?, warnings_json=? WHERE id=?",
                           (int(bool(q.answer_key) and q.key_verified), json.dumps(q.warnings), cur.lastrowid))
                ids.append(cur.lastrowid)
            audit(db, f"admin:{admin['admin_id']}", "questions.create", count=len(ids))
        return {"ids": ids}

    def question_out(row):
        out = dict(row)
        out["options"] = json.loads(out.pop("options_json"))
        out["warnings"] = json.loads(out.pop("warnings_json"))
        if not out["stem_en"]: out["warnings"].append("English version not in source")
        if not out["stem_hi"]: out["warnings"].append("Hindi version not in source")
        if not out["key_verified"]: out["warnings"].append("Answer key is not verified")
        return out

    @app.get("/api/admin/questions")
    def list_questions(admin: Admin, db: Db, status: str | None = None, source_id: int | None = None,
                       year: str | None = None, subject: str | None = None, language: Literal["en", "hi", "both"] | None = None):
        sql, args, terms = "SELECT * FROM questions", [], []
        for col, value in (("status", status), ("source_id", source_id), ("year", year), ("subject", subject)):
            if value is not None:
                terms.append(f"{col} = ?"); args.append(value)
        if language:
            for lang in (["en", "hi"] if language == "both" else [language]):
                terms.append(f"stem_{lang} IS NOT NULL AND stem_{lang} != ''")
        if terms: sql += " WHERE " + " AND ".join(terms)
        return {"questions": [question_out(r) for r in db.execute(sql + " ORDER BY id", args)]}

    class QuestionPatch(QuestionIn):
        version: int = Field(ge=1)

    @app.patch("/api/admin/questions/{question_id}")
    def edit_question(question_id: int, body: QuestionPatch, admin: Admin, db: Db):
        # Explicit human review can accept OCR candidates; creation cannot.
        checked = body.model_copy(update={"status": "needs-review"})
        _check_question(checked)
        if body.key_verified and not body.answer_key:
            raise HTTPException(422, "select a key before verifying it")
        with write_tx(db):
            row = db.execute("SELECT * FROM questions WHERE id=?", (question_id,)).fetchone()
            if row is None: raise HTTPException(404, "question not found")
            if row["version"] != body.version: raise HTTPException(409, "question changed; reload before editing")
            # Provenance cannot be reassigned while editing text.
            cols = ["stem_en", "stem_hi", "context_en", "context_hi", "answer_key", "explanation_en", "explanation_hi", "subject", "year", "status", "crop_json"]
            values = [getattr(body, col) for col in cols]
            db.execute("UPDATE questions SET " + ", ".join(f"{col}=?" for col in cols) + ", options_json=?, key_verified=?, version=version+1, updated_at=? WHERE id=?",
                       (*values, json.dumps([o.model_dump() for o in body.options], ensure_ascii=False), int(body.key_verified), now_ms(), question_id))
            audit(db, f"admin:{admin['admin_id']}", "question.edit", str(question_id), version=body.version+1, status=body.status)
        return question_out(db.execute("SELECT * FROM questions WHERE id=?", (question_id,)).fetchone())

    class SampleIn(BaseModel):
        count: int = Field(ge=1, le=500)
        seed: str = Field(min_length=1, max_length=100)
        source_id: int | None = None
        year: str | None = None
        subject: str | None = None
        language: Literal["en", "hi", "both"] | None = None

    @app.post("/api/admin/questions/sample")
    def sample_questions(body: SampleIn, admin: Admin, db: Db):
        candidates = list_questions(admin, db, "reviewed", body.source_id, body.year, body.subject, body.language)["questions"]
        if body.count > len(candidates): raise HTTPException(422, "not enough reviewed questions match these filters")
        ids = random.Random(body.seed).sample([q["id"] for q in candidates], body.count)
        return {"question_ids": ids, "seed": body.seed}

    class ExamIn(BaseModel):
        title: str = Field(min_length=1, max_length=200)
        instructions: str = Field(default="", max_length=10000)
        mode: Literal["cohort", "independent"]
        scored: bool = True
        duration_s: int = Field(gt=0, le=6 * 3600)
        opens_at: int
        closes_at: int
        late_join_s: int = Field(default=600, ge=0)
        shuffle: Literal["fixed", "per-attempt"] = "fixed"
        max_attempts: int = Field(default=1, ge=1, le=10)
        subset_count: int | None = Field(default=None, ge=1, le=500)
        subset_seed: str = Field(default="", max_length=100)
        marks_correct: float = Field(default=1, ge=0)
        marks_wrong: float = Field(default=0, ge=0)
        question_ids: list[int] = Field(min_length=1, max_length=500)

    def _new_code(db: sqlite3.Connection) -> str:
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I confusion
        while True:
            code = "".join(secrets.choice(alphabet) for _ in range(6))
            if not db.execute("SELECT 1 FROM exams WHERE code = ?", (code,)).fetchone():
                return code

    @app.post("/api/admin/exams", status_code=201)
    def create_exam(body: ExamIn, admin: Admin, db: Db) -> dict[str, Any]:
        if body.closes_at <= body.opens_at:
            raise HTTPException(422, "closes_at must be after opens_at")
        if body.mode == "cohort" and body.max_attempts != 1:
            raise HTTPException(422, "cohort exams allow one attempt")
        if body.subset_count is not None and (body.subset_count > len(body.question_ids) or not body.subset_seed.strip()):
            raise HTTPException(422, "subset requires a seed and count within the question pool")
        with write_tx(db):
            code = _new_code(db)
            cur = db.execute(
                "INSERT INTO exams (code, title, instructions, mode, scored, duration_s, opens_at, closes_at, late_join_s, "
                "shuffle, marks_correct, marks_wrong, question_ids_json, created_at, max_attempts, subset_count, subset_seed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (code, body.title, body.instructions, body.mode, int(body.scored), body.duration_s, body.opens_at, body.closes_at,
                 body.late_join_s, body.shuffle, body.marks_correct, body.marks_wrong, json.dumps(body.question_ids), now_ms(), body.max_attempts, body.subset_count, body.subset_seed))
            audit(db, f"admin:{admin['admin_id']}", "exam.create", code)
        return {"id": cur.lastrowid, "code": code}

    def _exam(db: sqlite3.Connection, exam_id: int) -> sqlite3.Row:
        row = db.execute("SELECT * FROM exams WHERE id = ?", (exam_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "exam not found")
        return row

    @app.post("/api/admin/exams/{exam_id}/publish")
    def publish_exam(exam_id: int, admin: Admin, db: Db) -> dict[str, Any]:
        owner(admin)
        with write_tx(db):
            exam = _exam(db, exam_id)
            if exam["status"] != "draft":
                raise HTTPException(409, "only draft exams can be published; published snapshots are immutable")
            try:
                snapshot = ex.build_snapshot(db, exam)
            except ex.PublishError as err:
                raise HTTPException(422, str(err)) from err
            digest = ex.snapshot_digest(snapshot)
            db.execute("UPDATE exams SET status='published', snapshot_json=?, snapshot_sha256=?, published_at=? WHERE id=?",
                       (json.dumps(snapshot, ensure_ascii=False), digest, now_ms(), exam_id))
            audit(db, f"admin:{admin['admin_id']}", "exam.publish", exam["code"], sha256=digest)
        return {"code": exam["code"], "status": "published", "snapshot_sha256": digest}

    class ReleaseIn(BaseModel):
        scores: bool | None = None
        answers: bool | None = None
        ranks: bool | None = None

    @app.post("/api/admin/exams/{exam_id}/release")
    def release(exam_id: int, body: ReleaseIn, admin: Admin, db: Db) -> dict[str, Any]:
        owner(admin)
        with write_tx(db):
            exam = _exam(db, exam_id)
            values = {"release_scores": body.scores, "release_answers": body.answers, "release_ranks": body.ranks}
            for col, val in values.items():
                if val is not None:
                    db.execute(f"UPDATE exams SET {col} = ? WHERE id = ?", (int(val), exam_id))
            audit(db, f"admin:{admin['admin_id']}", "exam.release", exam["code"], **{k: v for k, v in values.items() if v is not None})
            exam = _exam(db, exam_id)
        return {"release_scores": bool(exam["release_scores"]), "release_answers": bool(exam["release_answers"]),
                "release_ranks": bool(exam["release_ranks"])}

    @app.get("/api/admin/exams")
    def list_exams(admin: Admin, db: Db) -> dict[str, Any]:
        rows = db.execute(
            "SELECT e.id, e.code, e.title, e.mode, e.status, e.opens_at, e.closes_at, e.duration_s, e.scored, "
            "e.release_scores, e.release_answers, e.release_ranks, e.max_attempts, e.subset_count, e.subset_seed, e.question_ids_json, (SELECT COUNT(*) FROM attempts a WHERE a.exam_id = e.id) AS attempts "
            "FROM exams e ORDER BY e.id DESC").fetchall()
        return {"exams": [dict(r) for r in rows], "server_now": now_ms()}

    @app.get("/api/admin/exams/{exam_id}/attempts")
    def exam_attempts(exam_id: int, admin: Admin, db: Db) -> dict[str, Any]:
        _exam(db, exam_id)
        ex.sweep_expired(db, settings.submit_grace_ms)
        rows = db.execute(
            "SELECT id, alias, attempt_number, status, finish_reason, joined_at, started_at, deadline_at, finished_at, last_seq, "
            "score, correct, wrong, unanswered, (SELECT COUNT(*) FROM answers n WHERE n.attempt_id = a.id AND n.choice IS NOT NULL) AS answered "
            "FROM attempts a WHERE exam_id = ? ORDER BY joined_at", (exam_id,)).fetchall()
        return {"attempts": [dict(r) for r in rows], "server_now": now_ms()}

    class ExtendIn(BaseModel):
        seconds: int = Field(gt=0, le=6*3600)

    @app.post("/api/admin/exams/{exam_id}/extend")
    def extend_exam(exam_id: int, body: ExtendIn, admin: Admin, db: Db):
        owner(admin)
        with write_tx(db):
            exam = _exam(db, exam_id)
            t = now_ms()
            if exam["status"] != "published" or t >= exam["closes_at"]:
                raise HTTPException(409, "only an open published exam can be extended")
            delta = body.seconds * 1000
            db.execute("UPDATE exams SET closes_at=closes_at+?, duration_s=duration_s+? WHERE id=?", (delta, body.seconds, exam_id))
            # Never revive already finished or expired attempts, even if the sweeper is delayed.
            db.execute("UPDATE attempts SET deadline_at=deadline_at+? WHERE exam_id=? AND status='active' AND deadline_at>=?", (delta, exam_id, t))
            audit(db, f"admin:{admin['admin_id']}", "exam.extend", exam["code"], seconds=body.seconds)
        return {"closes_at": exam["closes_at"]+delta}

    @app.post("/api/admin/exams/{exam_id}/close")
    def close_exam(exam_id: int, admin: Admin, db: Db):
        owner(admin)
        with write_tx(db):
            exam = _exam(db, exam_id)
            if exam["status"] == "draft": raise HTTPException(409, "draft exam cannot be closed")
            db.execute("UPDATE exams SET status='closed' WHERE id=?", (exam_id,))
            for row in db.execute("SELECT id FROM attempts WHERE exam_id=? AND status='active'", (exam_id,)).fetchall():
                db.execute("UPDATE attempts SET deadline_at=MIN(deadline_at, ?) WHERE id=?", (now_ms(), row["id"]))
                ex.finalize(db, row["id"], "timeout", in_tx=True)
            audit(db, f"admin:{admin['admin_id']}", "exam.close", exam["code"])
        return {"status": "closed"}

    @app.get("/api/admin/exams/{exam_id}/export.csv")
    def export_exam(exam_id: int, admin: Admin, db: Db):
        attempts = exam_attempts(exam_id, admin, db)["attempts"]
        stream = io.StringIO(newline="")
        writer = csv.writer(stream)
        fields = ["alias", "attempt_number", "status", "score", "correct", "wrong", "unanswered", "answered"]
        writer.writerow(fields)
        for row in attempts:
            # Prevent spreadsheet formula execution from user-controlled aliases.
            writer.writerow([("'" + str(row[k]) if isinstance(row[k], str) and row[k].lstrip().startswith(("=", "+", "-", "@")) else row[k]) for k in fields])
        return Response(stream.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="exam-{exam_id}.csv"'})

    @app.get("/api/admin/exams/{exam_id}/stats")
    def exam_stats(exam_id: int, admin: Admin, db: Db):
        exam = _exam(db, exam_id)
        ex.sweep_expired(db, settings.submit_grace_ms)
        if not exam["snapshot_json"]: return {"questions": [], "ranks": []}
        finished = db.execute("SELECT id, alias, identity_key, score, order_json FROM attempts WHERE exam_id=? AND status!='active' ORDER BY score DESC, alias", (exam_id,)).fetchall()
        questions = []
        for qindex, q in enumerate(json.loads(exam["snapshot_json"])["questions"]):
            choices = {o["key"]: 0 for o in q["options"]}
            offered = 0
            for attempt in finished:
                if qindex not in json.loads(attempt["order_json"]):
                    continue
                offered += 1
                answer = db.execute("SELECT choice FROM answers WHERE attempt_id=? AND qid=?", (attempt["id"], q["qid"])).fetchone()
                if answer and answer["choice"] in choices: choices[answer["choice"]] += 1
            questions.append({"qid": q["qid"], "choices": choices, "correct": choices.get(q["answer_key"], 0), "offered": offered, "unanswered": offered-sum(choices.values())})
        ranks, previous, rank = [], None, 0
        ranked_identities = set()
        ranked_count = 0
        for attempt in finished:
            if attempt["score"] is None or attempt["identity_key"] in ranked_identities: continue
            ranked_identities.add(attempt["identity_key"])
            ranked_count += 1
            if attempt["score"] != previous: rank = ranked_count
            ranks.append({"rank": rank, "alias": attempt["alias"], "score": attempt["score"]})
            previous = attempt["score"]
        return {"questions": questions, "ranks": ranks}

    @app.get("/api/v1/exams/{code}/ranks")
    def public_ranks(code: str, db: Db):
        exam = _exam_by_code(db, code)
        if not exam["release_ranks"]: raise HTTPException(403, "ranks not released")
        return {"ranks": exam_stats(exam["id"], None, db)["ranks"]}

    static_dir = settings.admin_dist
    if static_dir.is_dir():
        app.mount("/admin", StaticFiles(directory=static_dir, html=True), name="admin")
    return app


def _self_origin(request: Request) -> str:
    return f"{request.url.scheme}://{request.headers.get('host', request.url.netloc)}"
