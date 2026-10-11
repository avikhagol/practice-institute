"""Exam snapshots, attempt timing, grading and idempotent finalisation (pure-ish domain logic)."""

from __future__ import annotations

import hashlib
import json
import random
import sqlite3
from typing import Any

from .db import audit, now_ms, write_tx

SNAPSHOT_VERSION = 1


class PublishError(ValueError):
    pass


def _lang(en: str | None, hi: str | None) -> dict[str, str | None]:
    return {"en": en, "hi": hi}


def build_snapshot(conn: sqlite3.Connection, exam: sqlite3.Row) -> dict[str, Any]:
    """Freeze the exam's questions (with keys) so later bank edits cannot change grades."""
    ids: list[int] = json.loads(exam["question_ids_json"])
    if not ids:
        raise PublishError("exam has no questions")
    if len(set(ids)) != len(ids):
        raise PublishError("exam contains duplicate questions")
    rows = {r["id"]: r for r in conn.execute(
        f"SELECT * FROM questions WHERE id IN ({','.join('?' * len(ids))})", ids)}
    questions = []
    for index, qid in enumerate(ids):
        row = rows.get(qid)
        if row is None:
            raise PublishError(f"question {qid} no longer exists")
        if row["status"] != "reviewed":
            raise PublishError(f"question {qid} is not reviewed (status {row['status']})")
        options = json.loads(row["options_json"])
        keys = [o["key"] for o in options]
        if exam["scored"] and (row["answer_key"] not in keys or not row["key_verified"]):
            raise PublishError(f"question {qid} has no verified answer key (required for scored exams)")
        questions.append({
            "qid": f"q{index + 1}",
            "bank_id": row["id"],
            "context": _lang(row["context_en"], row["context_hi"]),
            "stem": _lang(row["stem_en"], row["stem_hi"]),
            "options": [{"key": o["key"], "en": o.get("en"), "hi": o.get("hi")} for o in options],
            "answer_key": row["answer_key"],
            "explanation": _lang(row["explanation_en"], row["explanation_hi"]),
            "source": {"source_id": row["source_id"], "number": row["source_number"], "page": row["source_page"]},
        })
    return {
        "version": SNAPSHOT_VERSION,
        "marks": {"correct": exam["marks_correct"], "wrong": exam["marks_wrong"]},
        "scored": bool(exam["scored"]),
        "questions": questions,
    }


def snapshot_digest(snapshot: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(snapshot, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def public_question(q: dict[str, Any]) -> dict[str, Any]:
    """Student-safe view: no answer key, explanation, bank id or source internals."""
    return {"qid": q["qid"], "context": q["context"], "stem": q["stem"],
            "options": [{"key": o["key"], "en": o["en"], "hi": o["hi"]} for o in q["options"]]}


def attempt_order(attempt_id: str, count: int, shuffle: str, subset_count: int | None = None, seed: str = "") -> list[int]:
    order = list(range(count))
    if subset_count is not None:
        order = random.Random(hashlib.sha256(f"{seed}:{attempt_id}".encode()).digest()).sample(order, subset_count)
        if shuffle == "fixed":
            order.sort()
    if shuffle == "per-attempt":
        # Seeded by the attempt id so a reload returns the same order; keys move with options.
        random.Random(hashlib.sha256(attempt_id.encode()).digest()).shuffle(order)
    return order


def grade(snapshot: dict[str, Any], answers: dict[str, str | None]) -> dict[str, Any]:
    correct = wrong = unanswered = 0
    for q in snapshot["questions"]:
        choice = answers.get(q["qid"])
        if not choice:
            unanswered += 1
        elif q["answer_key"] is not None and choice == q["answer_key"]:
            correct += 1
        else:
            wrong += 1
    marks = snapshot["marks"]
    score = correct * marks["correct"] - wrong * marks["wrong"] if snapshot["scored"] else None
    return {"score": score, "correct": correct, "wrong": wrong, "unanswered": unanswered}


def load_answers(conn: sqlite3.Connection, attempt_id: str) -> dict[str, sqlite3.Row]:
    return {r["qid"]: r for r in conn.execute("SELECT * FROM answers WHERE attempt_id = ?", (attempt_id,))}


def finalize(conn: sqlite3.Connection, attempt_id: str, reason: str, *, in_tx: bool = False, expiry_grace_ms: int | None = None) -> bool:
    """Close an active attempt exactly once. Returns True if this call performed the close."""

    def _do() -> bool:
        row = conn.execute(
            "SELECT a.*, e.snapshot_json FROM attempts a JOIN exams e ON e.id = a.exam_id WHERE a.id = ?",
            (attempt_id,)).fetchone()
        if row is None or row["status"] != "active":
            return False
        # The deadline may have been extended after a caller selected this row.
        # Recheck while holding the same write lock used by owner extensions.
        if expiry_grace_ms is not None and now_ms() <= row["deadline_at"] + expiry_grace_ms:
            return False
        snapshot = json.loads(row["snapshot_json"])
        snapshot = {**snapshot, "questions": [snapshot["questions"][i] for i in json.loads(row["order_json"])]}
        answers = {qid: r["choice"] for qid, r in load_answers(conn, attempt_id).items()}
        result = grade(snapshot, answers)
        status = "submitted" if reason == "submitted" else "expired"
        finished = now_ms() if reason == "submitted" else min(now_ms(), row["deadline_at"])
        cur = conn.execute(
            "UPDATE attempts SET status=?, finished_at=?, finish_reason=?, score=?, correct=?, wrong=?, unanswered=? "
            "WHERE id=? AND status='active'",
            (status, finished, reason, result["score"], result["correct"], result["wrong"], result["unanswered"], attempt_id))
        if cur.rowcount == 1:
            audit(conn, "system" if reason == "timeout" else f"attempt:{attempt_id}", f"attempt.{reason}", attempt_id)
            return True
        return False

    if in_tx:
        return _do()
    with write_tx(conn):
        return _do()


def sweep_expired(conn: sqlite3.Connection, grace_ms: int) -> int:
    """Server-side expiry: finalise every active attempt whose deadline (+grace) has passed."""
    cutoff = now_ms() - grace_ms
    ids = [r[0] for r in conn.execute(
        "SELECT id FROM attempts WHERE status='active' AND deadline_at < ?", (cutoff,))]
    return sum(1 for attempt_id in ids if finalize(conn, attempt_id, "timeout", expiry_grace_ms=grace_ms))
