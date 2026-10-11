from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

from conftest import STUDENT_ORIGIN, make_exam
from practice_institute import exams as ex
from practice_institute.db import connect


def student(client: TestClient) -> TestClient:
    """A separate browser-like client with no admin cookie."""
    return TestClient(client.app, base_url="http://127.0.0.1:8787")


def join(c: TestClient, code: str, alias: str) -> dict:
    r = c.post(f"/api/v1/exams/{code}/join", json={"alias": alias})
    assert r.status_code == 201, r.text
    data = r.json()
    c.headers["Authorization"] = f"Bearer {data['token']}"
    return data


def test_health_and_migrations_idempotent(client, settings):
    r = client.get("/api/v1/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"
    from practice_institute.db import migrate
    assert migrate(connect(settings.db_path)) == []


def test_admin_requires_login_and_csrf(client, admin_password):
    assert client.get("/api/admin/exams").status_code == 401
    assert client.post("/api/admin/login", json={"username": "owner", "password": "wrong-password-x"}).status_code == 401
    r = client.post("/api/admin/login", json={"username": "owner", "password": admin_password})
    assert r.status_code == 200
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie
    assert client.get("/api/admin/exams").status_code == 200
    # Mutation without CSRF header is rejected even with a valid session cookie.
    assert client.post("/api/admin/questions", json=[]).status_code == 403
    client.headers["X-CSRF-Token"] = "forged"
    assert client.post("/api/admin/questions", json=[]).status_code == 403


def test_admin_rejects_cross_origin(admin):
    r = admin.get("/api/admin/exams", headers={"Origin": STUDENT_ORIGIN})
    assert r.status_code == 403
    r = admin.post("/api/admin/questions", json=[], headers={"Origin": "https://evil.example"})
    assert r.status_code == 403


def test_cors_allowlist(client):
    ok = client.options("/api/v1/health", headers={"Origin": STUDENT_ORIGIN, "Access-Control-Request-Method": "POST",
                                                   "Access-Control-Request-Headers": "authorization,content-type"})
    assert ok.status_code == 200 and ok.headers["access-control-allow-origin"] == STUDENT_ORIGIN
    assert "access-control-allow-credentials" not in ok.headers
    bad = client.options("/api/v1/health", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in bad.headers
    # CSRF header is not an allowed cross-origin header, so admin mutations cannot be preflighted.
    csrf = client.options("/api/admin/logout", headers={"Origin": STUDENT_ORIGIN, "Access-Control-Request-Method": "POST",
                                                        "Access-Control-Request-Headers": "x-csrf-token"})
    assert "x-csrf-token" not in csrf.headers.get("access-control-allow-headers", "").lower()


def test_body_limit(client):
    r = client.post("/api/v1/exams/ABC/join", content=b"x" * (300 * 1024), headers={"Content-Type": "application/json"})
    assert r.status_code == 413


def test_publish_requires_reviewed_and_keys(admin, clock):
    ids = admin.post("/api/admin/questions", json=[{"stem_en": "Q?", "options": [{"key": "A", "en": "a"}, {"key": "B", "en": "b"}]}]).json()["ids"]
    exam = admin.post("/api/admin/exams", json={"title": "t", "mode": "independent", "duration_s": 60, "opens_at": clock.t,
                                               "closes_at": clock.t + 60000, "question_ids": ids}).json()
    r = admin.post(f"/api/admin/exams/{exam['id']}/publish")
    assert r.status_code == 422 and "not reviewed" in r.text
    # OCR output cannot be imported as already reviewed.
    r = admin.post("/api/admin/questions", json=[{"stem_hi": "प्रश्न", "origin": "ocr", "status": "reviewed",
                                                  "options": [{"key": "A", "hi": "क"}, {"key": "B", "hi": "ख"}]}])
    assert r.status_code == 422


def test_student_payload_has_no_answers_and_preserves_hindi(admin, clock):
    exam = make_exam(admin, clock)
    s = student(admin)
    info = s.get(f"/api/v1/exams/{exam['code'].lower()}").json()
    assert info["languages"] == ["en", "hi"] and info["question_count"] == 3
    j = join(s, exam["code"], "Asha")
    assert "answer_key" not in json.dumps(j)
    body = s.get(f"/api/v1/attempts/{j['attempt_id']}").text
    for leak in ("answer_key", "explanation", "bank_id", "divisible", "source_id"):
        assert leak not in body
    data = json.loads(body)
    stems = {q["stem"]["hi"] for q in data["questions"]}
    assert "कौन-सी संख्या सम है?" in stems and "भारत का राष्ट्रीय पशु कौन है?" in stems
    assert any(q["stem"]["hi"] is None for q in data["questions"])  # honest missing-language fallback


def test_attempt_isolation_and_duplicate_join(admin, clock):
    exam = make_exam(admin, clock)
    a, b = student(admin), student(admin)
    ja, jb = join(a, exam["code"], "Asha"), join(b, exam["code"], "Bilal")
    assert a.get(f"/api/v1/attempts/{jb['attempt_id']}").status_code == 404  # A's token on B's attempt
    anon = student(admin)
    assert anon.get(f"/api/v1/attempts/{ja['attempt_id']}").status_code == 401
    assert anon.post(f"/api/v1/exams/{exam['code']}/join", json={"alias": " asha "}).status_code == 409
    # Students cannot reach admin routes with their bearer token.
    assert a.get("/api/admin/exams").status_code == 401


def test_sequenced_saves_are_idempotent_and_ordered(admin, clock):
    exam = make_exam(admin, clock)
    s = student(admin)
    j = join(s, exam["code"], "Asha")
    url = f"/api/v1/attempts/{j['attempt_id']}/answers"
    assert s.post(url, json={"changes": [{"qid": "q1", "choice": "A", "seq": 2}]}).json()["acked"] == {"q1": 2}
    # A delayed older write (seq 1) must not overwrite the newer answer.
    s.post(url, json={"changes": [{"qid": "q1", "choice": "C", "seq": 1}]})
    s.post(url, json={"changes": [{"qid": "q1", "choice": "A", "seq": 2}]})  # replay
    state = s.get(f"/api/v1/attempts/{j['attempt_id']}").json()
    assert state["answers"]["q1"]["choice"] == "A" and state["last_seq"] == 2
    assert s.post(url, json={"changes": [{"qid": "q1", "choice": "Z", "seq": 3}]}).status_code == 422
    assert s.post(url, json={"changes": [{"qid": "q99", "choice": "A", "seq": 3}]}).status_code == 422


def test_submit_idempotent_and_grading_hidden_until_release(admin, clock):
    exam = make_exam(admin, clock)
    s = student(admin)
    j = join(s, exam["code"], "Asha")
    aid = j["attempt_id"]
    s.post(f"/api/v1/attempts/{aid}/answers", json={"changes": [
        {"qid": "q1", "choice": "B", "seq": 1}, {"qid": "q2", "choice": "C", "seq": 2}]})
    first = s.post(f"/api/v1/attempts/{aid}/submit", json={"changes": []}).json()
    again = s.post(f"/api/v1/attempts/{aid}/submit", json={"changes": []}).json()
    assert first == {**again, "server_now": first["server_now"]} and first["status"] == "submitted"
    assert s.post(f"/api/v1/attempts/{aid}/answers", json={"changes": [{"qid": "q3", "choice": "A", "seq": 9}]}).status_code == 409
    hidden = s.get(f"/api/v1/attempts/{aid}/result").json()
    assert hidden["scores_released"] is False and "score" not in hidden and "review" not in hidden
    admin.post(f"/api/admin/exams/{exam['id']}/release", json={"scores": True, "answers": True})
    res = s.get(f"/api/v1/attempts/{aid}/result").json()
    assert (res["correct"], res["wrong"], res["unanswered"]) == (1, 1, 1)
    assert res["score"] == 0.75  # 1 - 0.25 negative marking
    assert {r["qid"]: r["your_choice"] for r in res["review"]}["q1"] == "B"


def test_deadline_cutoff_and_server_side_expiry(admin, clock, settings):
    exam = make_exam(admin, clock, duration_s=60)
    s = student(admin)
    j = join(s, exam["code"], "Asha")
    silent = student(admin)
    js = join(silent, exam["code"], "Silent")
    silent.post(f"/api/v1/attempts/{js['attempt_id']}/answers", json={"changes": [{"qid": "q1", "choice": "B", "seq": 1}]})
    aid = j["attempt_id"]
    url = f"/api/v1/attempts/{aid}/answers"
    clock.advance(60 + 1.9)  # inside 2 s server-receipt grace
    assert s.post(url, json={"changes": [{"qid": "q1", "choice": "B", "seq": 1}]}).status_code == 200
    clock.advance(0.2)  # past deadline + grace
    assert s.post(url, json={"changes": [{"qid": "q2", "choice": "A", "seq": 2}]}).status_code == 409
    conn = connect(settings.db_path)
    row = conn.execute("SELECT status, finish_reason, finished_at, correct FROM attempts WHERE id = ?", (aid,)).fetchone()
    assert tuple(row) == ("expired", "timeout", j["deadline_at"], 1)  # finalised lazily on access
    # The silent student's browser never calls back: the server sweeper alone finalises it.
    assert ex.sweep_expired(conn, settings.submit_grace_ms) == 1
    assert ex.sweep_expired(conn, settings.submit_grace_ms) == 0  # idempotent
    row = conn.execute("SELECT status, finish_reason, correct FROM attempts WHERE id = ?", (js["attempt_id"],)).fetchone()
    assert tuple(row) == ("expired", "timeout", 1)
    assert s.post(f"/api/v1/attempts/{aid}/submit", json={"changes": []}).json()["status"] == "expired"


def test_cohort_lobby_late_join_and_common_end(admin, clock):
    exam = make_exam(admin, clock, mode="cohort", duration_s=1800, opens_in_s=300, window_s=1800, late_join_s=120)
    a = student(admin)
    j = join(a, exam["code"], "Early")
    state = a.get(f"/api/v1/attempts/{j['attempt_id']}").json()
    assert state["phase"] == "lobby" and state["questions"] == []
    assert a.post(f"/api/v1/attempts/{j['attempt_id']}/answers", json={"changes": [{"qid": "q1", "choice": "A", "seq": 1}]}).status_code == 409
    clock.advance(300 + 100)
    late = student(admin)
    jl = join(late, exam["code"], "Late")
    assert jl["deadline_at"] == j["deadline_at"]  # everyone ends together
    clock.advance(30)
    assert student(admin).post(f"/api/v1/exams/{exam['code']}/join", json={"alias": "Too late"}).status_code == 409


def test_parallel_submits_finalise_once(admin, clock, settings):
    exam = make_exam(admin, clock)
    s = student(admin)
    j = join(s, exam["code"], "Asha")
    aid = j["attempt_id"]
    with ThreadPoolExecutor(8) as pool:
        results = list(pool.map(lambda _: s.post(f"/api/v1/attempts/{aid}/submit", json={"changes": [
            {"qid": "q1", "choice": "B", "seq": 1}]}).status_code, range(8)))
    assert all(code == 200 for code in results)
    conn = connect(settings.db_path)
    events = conn.execute("SELECT COUNT(*) FROM audit_events WHERE action = 'attempt.submitted' AND target = ?", (aid,)).fetchone()[0]
    assert events == 1


def test_restart_preserves_state(admin, clock, settings):
    exam = make_exam(admin, clock)
    s = student(admin)
    j = join(s, exam["code"], "Asha")
    s.post(f"/api/v1/attempts/{j['attempt_id']}/answers", json={"changes": [{"qid": "q1", "choice": "B", "seq": 1}]})
    from practice_institute.app import create_app
    with TestClient(create_app(settings), base_url="http://127.0.0.1:8787") as fresh:
        state = fresh.get(f"/api/v1/attempts/{j['attempt_id']}", headers={"Authorization": s.headers["Authorization"]}).json()
    assert state["deadline_at"] == j["deadline_at"] and state["answers"]["q1"]["choice"] == "B"


def test_published_snapshot_immutable(admin, clock, settings):
    exam = make_exam(admin, clock)
    assert admin.post(f"/api/admin/exams/{exam['id']}/publish").status_code == 409
    conn = connect(settings.db_path)
    conn.execute("UPDATE questions SET answer_key = 'C'")  # later bank edit
    s = student(admin)
    j = join(s, exam["code"], "Asha")
    s.post(f"/api/v1/attempts/{j['attempt_id']}/submit", json={"changes": [{"qid": "q1", "choice": "B", "seq": 1}]})
    row = conn.execute("SELECT correct FROM attempts WHERE id = ?", (j["attempt_id"],)).fetchone()
    assert row[0] == 1
