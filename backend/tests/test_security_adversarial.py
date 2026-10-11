"""Turn 7: token scope, exact cutoffs, rate limits and origin/header spoofing."""
from dataclasses import replace
from fastapi.testclient import TestClient

from conftest import make_exam, STUDENT_ORIGIN
from test_api import student, join
from practice_institute.app import create_app


def test_all_attempt_mutations_and_results_reject_other_token(admin, clock):
    exam = make_exam(admin, clock, max_attempts=2)
    a, b = student(admin), student(admin)
    ja, jb = join(a, exam['code'], 'Alice'), join(b, exam['code'], 'Bilal')
    target = f"/api/v1/attempts/{jb['attempt_id']}"
    for endpoint in ('answers', 'submit', 'reattempt'):
        assert a.post(target + '/' + endpoint, json={'changes': []}).status_code == 404
    assert a.get(target + '/result').status_code == 404
    assert a.get('/api/admin/sources').status_code == 401
    assert a.get('/api/admin/exams/1/export.csv').status_code in (401, 404)
    # A join code, attempt id, or admin cookie cannot substitute for a resume token.
    for token in (exam['code'], ja['attempt_id'], 'forged'):
        assert student(admin).get(target, headers={'Authorization': 'Bearer ' + token}).status_code == 404
    assert admin.get(target).status_code == 401


def test_exact_submit_cutoff_and_client_timestamp_cannot_extend(admin, clock):
    exam = make_exam(admin, clock, duration_s=10)
    a, b = student(admin), student(admin)
    ja, jb = join(a, exam['code'], 'Exact'), join(b, exam['code'], 'After')
    clock.advance(12)
    first = a.post(f"/api/v1/attempts/{ja['attempt_id']}/submit", json={'changes': [{'qid': 'q1', 'choice': 'B', 'seq': 1}]}).json()
    assert first['status'] == 'submitted'
    clock.advance(.001)
    late = b.post(f"/api/v1/attempts/{jb['attempt_id']}/submit", json={
        'client_now': jb['started_at'], 'changes': [{'qid': 'q1', 'choice': 'B', 'seq': 1}],
    }).json()
    assert late['status'] == 'expired' and late['finished_at'] == jb['deadline_at']
    assert b.get(f"/api/v1/attempts/{jb['attempt_id']}").json()['answers'] == {}


def test_rate_limits_ignore_untrusted_forwarded_ip(settings, admin_password, clock, monkeypatch):
    from types import SimpleNamespace
    monkeypatch.setattr("practice_institute.security.time", SimpleNamespace(monotonic=lambda: clock.t / 1000))
    limited = replace(settings, login_rate_per_min=2, join_rate_per_min=2)
    with TestClient(create_app(limited), base_url='http://127.0.0.1:8787') as c:
        for n in range(2):
            assert c.post('/api/admin/login', json={'username': 'owner', 'password': 'invalid'},
                          headers={'CF-Connecting-IP': f'192.0.2.{n}', 'X-Forwarded-For': f'192.0.2.{n}'}).status_code == 401
        assert c.post('/api/admin/login', json={'username': 'owner', 'password': admin_password},
                      headers={'CF-Connecting-IP': '192.0.2.99'}).status_code == 429
        for n in range(2):
            assert c.post('/api/v1/exams/MISSING/join', json={'alias': f'A{n}'}, headers={'X-Forwarded-For': f'192.0.2.{n}'}).status_code == 404
        assert c.post('/api/v1/exams/MISSING/join', json={'alias': 'A3'}).status_code == 429
        clock.advance(61)
        assert c.post('/api/admin/login', json={'username': 'owner', 'password': admin_password}).status_code == 200


def test_cookie_secure_and_origin_spoofing(settings, admin_password):
    secure = replace(settings, cookie_secure=True)
    with TestClient(create_app(secure), base_url='https://api.example.invalid') as c:
        r = c.post('/api/admin/login', json={'username': 'owner', 'password': admin_password})
        assert 'secure' in r.headers['set-cookie'].lower()
        csrf = r.json()['csrf_token']
        for origin in (STUDENT_ORIGIN, 'null', 'https://api.example.invalid.evil.invalid'):
            r = c.post('/api/admin/logout', headers={'Origin': origin, 'X-CSRF-Token': csrf,
                       'X-Forwarded-Host': 'api.example.invalid', 'X-Forwarded-Proto': 'https'})
            assert r.status_code == 403
        assert c.get('/api/admin/me').status_code == 200
        assert c.post('/api/admin/logout', headers={'Origin': 'https://api.example.invalid', 'X-CSRF-Token': csrf}).status_code == 200
        assert c.get('/api/admin/me').status_code == 401
