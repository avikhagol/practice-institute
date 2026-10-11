"""Turn 4: authenticated reattempt policy, stable subsets and concurrency boundaries."""
import json
from concurrent.futures import ThreadPoolExecutor

from conftest import make_exam
from test_api import student, join
from practice_institute.db import connect


def test_reattempt_authorization_limit_and_parallel_creation(admin, clock):
    exam = make_exam(admin, clock, max_attempts=2)
    s = student(admin)
    first = join(s, exam["code"], "Asha")
    path = f"/api/v1/attempts/{first['attempt_id']}"
    assert student(admin).post(path + "/reattempt", json={}).status_code == 401
    assert s.post(path + "/reattempt", json={}).status_code == 409
    assert student(admin).post(f"/api/v1/exams/{exam['code']}/join", json={"alias": "asha"}).status_code == 409
    assert s.post(path + "/submit", json={"changes": []}).status_code == 200
    with ThreadPoolExecutor(4) as pool:
        replies = list(pool.map(lambda _: s.post(path + "/reattempt", json={}), range(4)))
    assert sorted(r.status_code for r in replies) == [201, 409, 409, 409]
    second = next(r.json() for r in replies if r.status_code == 201)
    s.headers["Authorization"] = f"Bearer {second['token']}"
    path2 = f"/api/v1/attempts/{second['attempt_id']}"
    state = s.get(path2).json()
    assert state["attempt_number"] == 2 and state["alias"] == "Asha"
    s.post(path2 + "/submit", json={"changes": []})
    assert s.post(path2 + "/reattempt", json={}).status_code == 409
    assert len(admin.get(f"/api/admin/exams/{exam['id']}/stats").json()["ranks"]) == 1
    # A token for the second attempt cannot operate on the first.
    assert s.get(path).status_code == 404


def test_subset_snapshot_scoring_and_answer_scope(admin, clock, settings):
    exam = make_exam(admin, clock, subset_count=2, subset_seed="fixed-seed", shuffle="per-attempt")
    s = student(admin)
    j = join(s, exam["code"], "Asha")
    path = f"/api/v1/attempts/{j['attempt_id']}"
    state = s.get(path).json()
    assert state["exam"]["question_count"] == 2 and state["exam"]["pool_count"] == 3
    questions = state["questions"]
    assert len({q["qid"] for q in questions}) == 2
    assert s.get(path).json()["questions"] == questions
    missing = ({"q1", "q2", "q3"} - {q["qid"] for q in questions}).pop()
    assert s.post(path + "/answers", json={"changes": [{"qid": missing, "choice": "A", "seq": 1}]}).status_code == 422
    changes = [{"qid": q["qid"], "choice": "B" if q["qid"] == "q1" else "A", "seq": n + 1} for n, q in enumerate(questions)]
    assert s.post(path + "/submit", json={"changes": changes}).status_code == 200
    admin.post(f"/api/admin/exams/{exam['id']}/release", json={"scores": True, "answers": True})
    result = s.get(path + "/result").json()
    assert (result["score"], result["correct"], result["unanswered"], result["total"]) == (2, 2, 0, 2)
    assert [q["qid"] for q in result["review"]] == [q["qid"] for q in questions]
    stats = admin.get(f"/api/admin/exams/{exam['id']}/stats").json()
    assert sum(q["offered"] for q in stats["questions"]) == 2
    assert sum(q["unanswered"] for q in stats["questions"]) == 0
    assert next(q for q in stats["questions"] if q["qid"] == missing)["offered"] == 0
    conn = connect(settings.db_path)
    from practice_institute.exams import attempt_order
    order = json.loads(conn.execute("SELECT order_json FROM attempts WHERE id=?", (j["attempt_id"],)).fetchone()[0])
    assert order == attempt_order(j["attempt_id"], 3, "per-attempt", 2, "fixed-seed")
    conn.close()


def test_extension_never_revives_expired_and_receipt_boundary(admin, clock):
    exam = make_exam(admin, clock, duration_s=10)
    s = student(admin)
    j = join(s, exam["code"], "Asha")
    path = f"/api/v1/attempts/{j['attempt_id']}"
    clock.advance(9)
    assert admin.post(f"/api/admin/exams/{exam['id']}/extend", json={"seconds": 10}).status_code == 200
    assert s.get(path).json()["deadline_at"] == j["deadline_at"] + 10000
    clock.advance(13)  # exact deadline + 2-second server receipt grace
    assert s.post(path + "/answers", json={"changes": [{"qid": "q1", "choice": "B", "seq": 1}]}).status_code == 200
    clock.advance(.001)
    assert s.post(path + "/answers", json={"changes": [{"qid": "q1", "choice": "C", "seq": 2}]}).status_code == 409
    assert admin.post(f"/api/admin/exams/{exam['id']}/extend", json={"seconds": 10}).status_code == 200
    state = s.get(path).json()
    assert state["status"] == "expired" and state["answers"]["q1"]["choice"] == "B"
    assert state["deadline_at"] == j["deadline_at"] + 10000


def test_parallel_save_sequence_and_duplicate_join(admin, clock):
    exam = make_exam(admin, clock)
    with ThreadPoolExecutor(4) as pool:
        replies = list(pool.map(lambda _: student(admin).post(f"/api/v1/exams/{exam['code']}/join", json={"alias": "Asha"}), range(4)))
    assert sorted(r.status_code for r in replies) == [201, 409, 409, 409]
    joined = next(r.json() for r in replies if r.status_code == 201)
    s = student(admin)
    s.headers["Authorization"] = f"Bearer {joined['token']}"
    path = f"/api/v1/attempts/{joined['attempt_id']}"
    with ThreadPoolExecutor(8) as pool:
        replies = list(pool.map(lambda seq: s.post(path + "/answers", json={"changes": [{"qid": "q1", "choice": "B" if seq == 8 else "A", "seq": seq}]}), range(1, 9)))
    assert all(r.status_code == 200 for r in replies)
    assert s.get(path).json()["answers"]["q1"] == {"choice": "B", "marked": False, "seq": 8}


def test_attempt_policy_validation(admin, clock):
    from conftest import BILINGUAL
    ids = admin.post("/api/admin/questions", json=BILINGUAL).json()["ids"]
    body = {"title": "Policy", "mode": "cohort", "duration_s": 60, "opens_at": clock.t, "closes_at": clock.t + 60000, "question_ids": ids}
    for extra in ({"max_attempts": 2}, {"subset_count": 4, "subset_seed": "x"}, {"subset_count": 1}, {"max_attempts": 0}):
        assert admin.post("/api/admin/exams", json={**body, **extra}).status_code == 422


def test_migration_preserves_existing_attempt_and_answer(tmp_path):
    from practice_institute.db import migrate, _migration_files
    conn = connect(tmp_path / "legacy.sqlite3")
    conn.execute("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)")
    for version, name, sql in _migration_files():
        if version <= 2:
            conn.executescript(sql)
            conn.execute("INSERT INTO schema_migrations VALUES (?, ?, 0)", (version, name))
    conn.execute("INSERT INTO exams(id,code,title,mode,duration_s,opens_at,closes_at,question_ids_json,created_at) VALUES (1,'ABCDEF','Legacy','independent',60,0,60000,'[]',0)")
    conn.execute("INSERT INTO attempts(id,exam_id,alias,alias_key,token_hash,joined_at,started_at,deadline_at,order_json) VALUES ('legacy',1,'Asha','asha','old-hash',0,0,60000,'[0]')")
    conn.execute("INSERT INTO answers VALUES ('legacy','q1','B',1,3,1)")
    assert migrate(conn) == ["0003_attempt_policy.sql"]
    assert migrate(conn) == []
    row = conn.execute("SELECT identity_key, attempt_number, token_hash, deadline_at, order_json FROM attempts").fetchone()
    assert tuple(row) == ('asha', 1, 'old-hash', 60000, '[0]')
    assert tuple(conn.execute("SELECT choice, marked, seq FROM answers").fetchone()) == ('B', 1, 3)
    assert list(conn.execute("PRAGMA foreign_key_check")) == []
    conn.close()


def test_join_close_race_and_ended_cohort(admin, clock, settings):
    exam = make_exam(admin, clock)
    with ThreadPoolExecutor(2) as pool:
        joining = pool.submit(lambda: student(admin).post(f"/api/v1/exams/{exam['code']}/join", json={"alias": "Race student"}))
        closing = pool.submit(lambda: admin.post(f"/api/admin/exams/{exam['id']}/close", json={}))
        assert joining.result().status_code in (201, 409)
        assert closing.result().status_code == 200
    conn = connect(settings.db_path)
    assert conn.execute("SELECT COUNT(*) FROM attempts WHERE exam_id=? AND status='active'", (exam["id"],)).fetchone()[0] == 0
    conn.close()
    cohort = make_exam(admin, clock, mode="cohort", duration_s=10, window_s=600, late_join_s=120)
    clock.advance(11)
    assert student(admin).post(f"/api/v1/exams/{cohort['code']}/join", json={"alias": "Too late"}).status_code == 409


def test_parallel_submit_save_and_atomic_invalid_batch(admin, clock, settings):
    exam = make_exam(admin, clock)
    s = student(admin)
    j = join(s, exam["code"], "Concurrent")
    path = f"/api/v1/attempts/{j['attempt_id']}"
    # A valid first item must roll back when a later item is invalid.
    assert s.post(path + "/answers", json={"changes": [
        {"qid": "q1", "choice": "A", "seq": 1}, {"qid": "q2", "choice": "Z", "seq": 2}
    ]}).status_code == 422
    assert s.get(path).json()["answers"] == {}
    assert s.post(path + "/answers", json={"changes": [{"qid": "q1", "choice": "B", "seq": 8}]}).status_code == 200
    # A replay with a conflicting payload cannot change an accepted sequence.
    assert s.post(path + "/answers", json={"changes": [{"qid": "q1", "choice": "C", "seq": 8}]}).status_code == 200
    def submit(_):
        return s.post(path + "/submit", json={"changes": [{"qid": "q2", "choice": "A", "seq": 9}]})
    with ThreadPoolExecutor(8) as pool:
        replies = list(pool.map(submit, range(8)))
    assert all(r.status_code == 200 for r in replies)
    assert len({(r.json()["status"], r.json()["finished_at"]) for r in replies}) == 1
    assert s.post(path + "/answers", json={"changes": [{"qid": "q1", "choice": "C", "seq": 10}]}).status_code == 409
    # Duplicate submit acknowledges the first finish and never applies new changes.
    assert s.post(path + "/submit", json={"changes": [{"qid": "q1", "choice": "C", "seq": 10}]}).status_code == 200
    assert s.get(path).json()["answers"]["q1"]["choice"] == "B"
    conn = connect(settings.db_path)
    assert conn.execute("SELECT COUNT(*) FROM audit_events WHERE action='attempt.submitted' AND target=?", (j["attempt_id"],)).fetchone()[0] == 1
    assert tuple(conn.execute("SELECT correct,wrong,unanswered FROM attempts WHERE id=?", (j["attempt_id"],)).fetchone()) == (2, 0, 1)
    conn.close()


def test_save_submit_race_serializes_final_grade(admin, clock, settings):
    exam = make_exam(admin, clock)
    s = student(admin)
    j = join(s, exam["code"], "Save submit race")
    path = f"/api/v1/attempts/{j['attempt_id']}"
    with ThreadPoolExecutor(2) as pool:
        saving = pool.submit(lambda: s.post(path + "/answers", json={"changes": [{"qid": "q1", "choice": "B", "seq": 1}]}))
        submitting = pool.submit(lambda: s.post(path + "/submit", json={"changes": []}))
        saved, submitted = saving.result(), submitting.result()
    assert submitted.status_code == 200 and saved.status_code in (200, 409)
    conn = connect(settings.db_path)
    row = conn.execute("SELECT correct,unanswered FROM attempts WHERE id=?", (j["attempt_id"],)).fetchone()
    assert tuple(row) == ((1, 2) if saved.status_code == 200 else (0, 3))
    conn.close()


def test_expiry_rechecks_extended_deadline_under_lock(admin, clock, settings):
    from practice_institute.exams import finalize, sweep_expired
    exam = make_exam(admin, clock, duration_s=10)
    s = student(admin)
    j = join(s, exam["code"], "Expiry race")
    conn = connect(settings.db_path)
    clock.advance(13)
    # Simulate an expiry caller holding a stale candidate after an extension won.
    conn.execute("UPDATE attempts SET deadline_at=deadline_at+30000 WHERE id=?", (j["attempt_id"],))
    assert not finalize(conn, j["attempt_id"], "timeout", expiry_grace_ms=2000)
    assert sweep_expired(conn, 2000) == 0
    clock.advance(29)  # inclusive exact new deadline + grace
    assert sweep_expired(conn, 2000) == 0
    clock.advance(.001)
    assert sweep_expired(conn, 2000) == 1
    assert sweep_expired(conn, 2000) == 0
    assert conn.execute("SELECT finished_at FROM attempts WHERE id=?", (j["attempt_id"],)).fetchone()[0] == j["deadline_at"] + 30000
    conn.close()


def test_save_waiting_for_write_lock_misses_cutoff(admin, clock, settings, monkeypatch):
    from contextlib import contextmanager
    from threading import Event
    from practice_institute import app as app_mod
    from practice_institute.db import write_tx
    from practice_institute.exams import sweep_expired
    exam = make_exam(admin, clock, duration_s=10)
    s = student(admin)
    j = join(s, exam['code'], 'Queued save')
    waiting = Event()
    @contextmanager
    def observed_tx(conn):
        waiting.set()
        with write_tx(conn):
            yield conn
    monkeypatch.setattr(app_mod, 'write_tx', observed_tx)
    conn = connect(settings.db_path)
    with ThreadPoolExecutor(1) as pool:
        with write_tx(conn):
            saving = pool.submit(lambda: s.post(f"/api/v1/attempts/{j['attempt_id']}/answers",
                json={'changes': [{'qid': 'q1', 'choice': 'B', 'seq': 1}]}))
            assert waiting.wait(5), 'request did not reach write transaction'
            clock.advance(12.001)
        assert saving.result(timeout=5).status_code == 409
    assert conn.execute('SELECT COUNT(*) FROM answers WHERE attempt_id=?', (j['attempt_id'],)).fetchone()[0] == 0
    assert sweep_expired(conn, 2000) == 1
    conn.close()
