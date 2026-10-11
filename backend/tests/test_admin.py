"""Admin workflow and security checks against disposable databases."""
import io
from dataclasses import replace

from pypdf import PdfWriter
from fastapi.testclient import TestClient

from practice_institute.app import create_app
from practice_institute.db import connect
from practice_institute.security import hash_password
from conftest import BILINGUAL, make_exam


def pdf_bytes(pages=1, encrypted=False):
    writer = PdfWriter()
    for _ in range(pages): writer.add_blank_page(width=300, height=400)
    if encrypted: writer.encrypt("test-only-password")
    out = io.BytesIO(); writer.write(out)
    return out.getvalue()


def upload(admin, raw=None, **data):
    return admin.post('/api/admin/sources/upload', files={'file': ('../../paper.pdf', raw or pdf_bytes(), 'application/pdf')},
                      data={'label': 'Synthetic source', 'provenance': 'Original test fixture; permission granted', 'consent': 'true', **data})


def test_upload_provenance_dedupe_bounds_and_auth(admin, client, settings):
    assert upload(admin, consent='false').status_code == 422
    assert upload(admin, provenance=' ').status_code == 422
    assert upload(admin, raw=b'%PDF-1.4 invalid').status_code == 422
    assert upload(admin, raw=pdf_bytes(201)).status_code == 422
    assert upload(admin, raw=pdf_bytes(encrypted=True)).status_code == 422
    result = upload(admin)
    assert result.status_code == 201, result.text
    source = result.json()
    duplicate = upload(admin).json()
    assert duplicate['duplicate'] and duplicate['id'] == source['id']
    rows = admin.get('/api/admin/sources').json()['sources']
    assert len(rows) == 1 and rows[0]['consent'] == 1 and rows[0]['filename'] == 'paper.pdf'
    assert len(list((settings.data_dir / 'sources').glob('*.pdf'))) == 1
    assert admin.get(f"/api/admin/sources/{source['id']}/file").content == pdf_bytes()
    client.cookies.clear()
    assert client.get(f"/api/admin/sources/{source['id']}/file").status_code == 401
    assert upload(client).status_code == 401


def test_review_conflict_verified_keys_and_snapshot(admin, clock):
    source = upload(admin).json()['id']
    q = {**BILINGUAL[0], 'origin': 'text-layer', 'status': 'needs-review', 'source_id': source, 'source_page': 1, 'source_number': 1, 'key_verified':False}
    qid = admin.post('/api/admin/questions', json=[q]).json()['ids'][0]
    row = admin.get('/api/admin/questions').json()['questions'][0]
    assert row['key_verified'] == 0
    edited = {**row, 'status': 'reviewed', 'key_verified': False}
    assert admin.patch(f'/api/admin/questions/{qid}', json=edited).status_code == 200
    assert admin.patch(f'/api/admin/questions/{qid}', json=edited).status_code == 409
    draft = admin.post('/api/admin/exams', json={'title': 'Review gate', 'mode': 'independent', 'duration_s': 600, 'opens_at': clock.t, 'closes_at': clock.t+3600000, 'question_ids': [qid]}).json()
    assert admin.post(f"/api/admin/exams/{draft['id']}/publish").status_code == 422
    row = admin.get('/api/admin/questions').json()['questions'][0]
    row['key_verified'] = True
    assert admin.patch(f'/api/admin/questions/{qid}', json=row).status_code == 200
    published = admin.post(f"/api/admin/exams/{draft['id']}/publish").json()
    assert published['status'] == 'published'
    row = admin.get('/api/admin/questions').json()['questions'][0]
    row.update(answer_key='A', status='excluded')
    assert admin.patch(f'/api/admin/questions/{qid}', json=row).status_code == 200
    assert admin.post(f"/api/admin/exams/{draft['id']}/publish").status_code == 409
    assert admin.get(f"/api/v1/exams/{draft['code']}").json()['question_count'] == 1
    assert admin.post('/api/admin/questions', json=[{**q, 'source_id':999}]).status_code == 422


def test_editor_permissions_expiry_csrf_and_cross_origin(admin, settings, clock):
    exam = make_exam(admin, clock)
    conn = connect(settings.db_path)
    conn.execute("INSERT INTO admins(username,password_hash,role,created_at) VALUES ('editor',?,'editor',0)", (hash_password('test-editor-password'),))
    conn.close()
    editor = TestClient(create_app(settings), base_url='http://127.0.0.1:8787')
    login = editor.post('/api/admin/login', json={'username':'editor','password':'test-editor-password'})
    editor.headers['X-CSRF-Token'] = login.json()['csrf_token']
    assert login.json()['role'] == 'editor'
    assert editor.post('/api/admin/questions', json=[BILINGUAL[0]]).status_code == 201
    for action, body in [('publish', {}), ('release', {'scores':True}), ('close', {}), ('extend', {'seconds':60})]:
        assert editor.post(f"/api/admin/exams/{exam['id']}/{action}", json=body).status_code == 403
    assert editor.patch('/api/admin/questions/1', json={}, headers={'Origin':'https://evil.test'}).status_code == 403
    assert editor.get('/api/admin/sources', headers={'Origin':'https://evil.test'}).status_code == 403
    csrf = editor.headers.pop('X-CSRF-Token')
    assert upload(editor).status_code == 403
    editor.headers['X-CSRF-Token'] = csrf
    clock.advance(settings.session_ttl_s)
    assert editor.get('/api/admin/me').status_code == 401
    assert upload(editor).status_code == 401
    editor.close()


def test_seeded_sampling_filters_no_replacement(admin):
    ids = admin.post('/api/admin/questions', json=BILINGUAL).json()['ids']
    request = {'count':2,'seed':'paper-a'}
    first = admin.post('/api/admin/questions/sample', json=request).json()['question_ids']
    assert first == admin.post('/api/admin/questions/sample', json=request).json()['question_ids']
    assert len(set(first)) == 2 and set(first) <= set(ids)
    assert admin.post('/api/admin/questions/sample', json={**request,'language':'both'}).status_code == 422
    assert admin.post('/api/admin/questions/sample', json={**request,'count':1,'language':'hi'}).status_code == 200
    assert admin.get('/api/admin/questions?language=both').json()['questions'][0]['id'] == ids[0]


def test_extend_close_stats_csv_and_alias_only_ranks(admin, clock):
    exam = make_exam(admin, clock)
    joined = admin.post(f"/api/v1/exams/{exam['code']}/join", json={'alias':'=SUM(1,2)'}).json()
    headers = {'Authorization': f"Bearer {joined['token']}"}
    assert admin.post(f"/api/admin/exams/{exam['id']}/extend", json={'seconds':60}).status_code == 200
    assert admin.get(f"/api/v1/attempts/{joined['attempt_id']}", headers=headers).json()['deadline_at'] == joined['deadline_at']+60000
    admin.post(f"/api/v1/attempts/{joined['attempt_id']}/answers", headers=headers, json={'changes':[{'qid':'q1','choice':'B','seq':1}]})
    assert admin.post(f"/api/admin/exams/{exam['id']}/close").status_code == 200
    assert admin.post(f"/api/v1/exams/{exam['code']}/join", json={'alias':'Other'}).status_code == 409
    assert admin.get(f"/api/v1/attempts/{joined['attempt_id']}", headers=headers).json()['phase'] == 'finished'
    assert admin.post(f"/api/admin/exams/{exam['id']}/extend", json={'seconds':60}).status_code == 409
    stats = admin.get(f"/api/admin/exams/{exam['id']}/stats").json()
    assert stats['questions'][0]['correct'] == 1
    assert set(stats['ranks'][0]) == {'rank','alias','score'}
    csv = admin.get(f"/api/admin/exams/{exam['id']}/export.csv").text
    assert "'=SUM(1,2)" in csv and joined['token'] not in csv
    assert admin.get(f"/api/v1/exams/{exam['code']}/ranks").status_code == 403
    admin.post(f"/api/admin/exams/{exam['id']}/release", json={'ranks':True})
    assert admin.get(f"/api/v1/exams/{exam['code']}/ranks").json()['ranks'] == stats['ranks']


def test_extend_never_revives_expired_attempt(admin, clock):
    exam = make_exam(admin, clock, duration_s=10)
    joined = admin.post(f"/api/v1/exams/{exam['code']}/join", json={'alias':'Late student'}).json()
    clock.advance(11)
    assert admin.post(f"/api/admin/exams/{exam['id']}/extend", json={'seconds':60}).status_code == 200
    state = admin.get(f"/api/v1/attempts/{joined['attempt_id']}", headers={'Authorization':f"Bearer {joined['token']}"}).json()
    assert state['deadline_at'] == joined['deadline_at']


def test_manual_key_requires_explicit_verification(admin, clock):
    qid = admin.post('/api/admin/questions', json=[{**BILINGUAL[0], 'key_verified':False}]).json()['ids'][0]
    draft = admin.post('/api/admin/exams', json={'title':'Manual key gate','mode':'independent','duration_s':600,'opens_at':clock.t,'closes_at':clock.t+3600000,'question_ids':[qid]}).json()
    assert admin.post(f"/api/admin/exams/{draft['id']}/publish").status_code == 422
    row = admin.get('/api/admin/questions').json()['questions'][0]
    row['key_verified'] = True
    admin.patch(f'/api/admin/questions/{qid}', json=row)
    assert admin.post(f"/api/admin/exams/{draft['id']}/publish").status_code == 200


def test_upload_size_limit(admin, settings):
    bounded = replace(settings, max_upload_bytes=512)
    with TestClient(create_app(bounded), base_url='http://127.0.0.1:8787') as other:
        other.cookies.update(admin.cookies)
        other.headers['X-CSRF-Token'] = admin.headers['X-CSRF-Token']
        assert upload(other, raw=pdf_bytes(5)).status_code == 413


def test_actual_student_cors_requests(admin, clock):
    exam = make_exam(admin, clock)
    origin = {'Origin':'http://127.0.0.1:4318'}
    lookup = admin.get(f"/api/v1/exams/{exam['code']}", headers=origin)
    assert lookup.headers['access-control-allow-origin'] == origin['Origin']
    assert 'access-control-allow-credentials' not in lookup.headers
    joined = admin.post(f"/api/v1/exams/{exam['code']}/join", headers=origin, json={'alias':'Cross-origin student'})
    assert joined.status_code == 201
    assert joined.headers['access-control-allow-origin'] == origin['Origin']
    assert 'access-control-allow-credentials' not in joined.headers
    blocked = admin.get(f"/api/v1/exams/{exam['code']}", headers={'Origin':'https://evil.test'})
    assert 'access-control-allow-origin' not in blocked.headers


def test_ocr_origin_review_gate_and_crop(admin, clock):
    crop = '{"page":1,"x":0.1,"y":0.2,"w":0.8,"h":0.3}'
    ocr_q = {**BILINGUAL[0], 'origin': 'ocr', 'status': 'needs-review', 'crop_json': crop, 'key_verified': False}
    # OCR origin cannot be created directly as reviewed
    assert admin.post('/api/admin/questions', json=[{**ocr_q, 'status': 'reviewed'}]).status_code == 422
    qid = admin.post('/api/admin/questions', json=[ocr_q]).json()['ids'][0]
    row = admin.get('/api/admin/questions').json()['questions'][0]
    assert row['origin'] == 'ocr'
    assert row['status'] == 'needs-review'
    assert row['crop_json'] == crop
    # Reviewing via PATCH allows transition to reviewed with verified key and updated crop
    new_crop = '{"page":1,"x":0.15,"y":0.25,"w":0.7,"h":0.25}'
    edited = {**row, 'status': 'reviewed', 'key_verified': True, 'crop_json': new_crop}
    res = admin.patch(f'/api/admin/questions/{qid}', json=edited)
    assert res.status_code == 200
    assert res.json()['crop_json'] == new_crop
    assert res.json()['status'] == 'reviewed'


def test_invalid_crop_is_rejected_on_create_and_patch(admin):
    import json
    base = {**BILINGUAL[0], 'origin': 'ocr', 'status': 'needs-review', 'key_verified': False}
    qid = admin.post('/api/admin/questions', json=[base]).json()['ids'][0]
    row = admin.get('/api/admin/questions').json()['questions'][0]
    invalid = ['not json', '[]', '{}', json.dumps(dict(page=0,x=0,y=0,w=1,h=1)),
               json.dumps(dict(page=1,x=-.1,y=0,w=1,h=1)),
               json.dumps(dict(page=1,x=.8,y=0,w=.5,h=1)),
               json.dumps(dict(page=1,x=True,y=0,w=1,h=1)),
               json.dumps(dict(page=1,x=0,y=0,w=0,h=1)),
               '{"page":1,"x":NaN,"y":0,"w":1,"h":1}']
    for crop in invalid:
        assert admin.post('/api/admin/questions', json=[{**base, 'crop_json':crop}]).status_code == 422
        assert admin.patch(f'/api/admin/questions/{qid}', json={**row, 'crop_json':crop}).status_code == 422
    unchanged = admin.get('/api/admin/questions').json()['questions'][0]
    assert unchanged['version'] == row['version']
    assert unchanged['crop_json'] is None
