"""Turn 7: full recovery with source PDFs, relocated paths and unchanged attempts."""
import io
import secrets
import shutil
import sqlite3
from dataclasses import replace

import pytest

from conftest import make_exam
from test_admin import upload, pdf_bytes
from test_api import student, join
from practice_institute import cli
from practice_institute.db import connect
from practice_institute.recovery import DB_NAME, backup_full, restore_full


def full_settings(settings):
    target = settings.data_dir / DB_NAME
    src, out = connect(settings.db_path), sqlite3.connect(target)
    src.backup(out)
    src.close()
    out.close()
    return replace(settings, db_path=target)


def test_full_recovery_retains_sources_attempts_and_owner(admin, admin_password, clock, settings, tmp_path):
    source = upload(admin).json()
    exam = make_exam(admin, clock)
    s = student(admin)
    j = join(s, exam['code'], 'Recovery alias')
    path = f"/api/v1/attempts/{j['attempt_id']}"
    assert s.post(path + '/submit', json={'changes': [{'qid': 'q1', 'choice': 'B', 'seq': 1}]}).status_code == 200
    original = full_settings(settings)
    bundle = tmp_path.parent / (tmp_path.name + '-bundle')
    backup_full(original, bundle)
    assert bundle.stat().st_mode & 0o777 == 0o700
    assert (bundle / DB_NAME).stat().st_mode & 0o777 == 0o600
    moved = replace(original, data_dir=tmp_path / 'relocated', db_path=tmp_path / 'relocated' / DB_NAME)
    keep = restore_full(moved, bundle)
    assert keep is None
    conn = connect(moved.db_path)
    assert conn.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    assert list(conn.execute('PRAGMA foreign_key_check')) == []
    row = conn.execute('SELECT * FROM attempts WHERE id=?', (j['attempt_id'],)).fetchone()
    assert (row['status'], row['score'], row['deadline_at']) == ('submitted', 1, j['deadline_at'])
    stored = conn.execute('SELECT stored_path FROM sources WHERE id=?', (source['id'],)).fetchone()[0]
    from pathlib import Path
    assert Path(stored).parent == moved.data_dir / 'sources'
    assert Path(stored).read_bytes() == pdf_bytes()
    assert conn.execute('SELECT role FROM admins').fetchone()[0] == 'owner'
    assert conn.execute('SELECT COUNT(*) FROM admin_sessions').fetchone()[0] == 0
    conn.close()
    from fastapi.testclient import TestClient
    from practice_institute.app import create_app
    with TestClient(create_app(moved), base_url="http://127.0.0.1:8787") as restarted:
        assert restarted.get(path, headers={"Authorization": f"Bearer {j['token']}"}).json()["answers"]["q1"]["choice"] == "B"
        assert restarted.get(f"/api/admin/sources/{source['id']}/file").status_code == 401
        login = restarted.post("/api/admin/login", json={"username": "owner", "password": admin_password})
        assert login.status_code == 200
        restarted.headers["X-CSRF-Token"] = login.json()["csrf_token"]
        assert restarted.get(f"/api/admin/sources/{source['id']}/file").content == pdf_bytes()
        assert restarted.post(f"/api/admin/exams/{exam['id']}/release", json={"scores": True}).status_code == 200
        assert restarted.get(path + "/result", headers={"Authorization": f"Bearer {j['token']}"}).json()["score"] == 1
    # Replacing existing data keeps the complete previous directory.
    keep = restore_full(moved, bundle)
    assert keep and (keep / DB_NAME).is_file() and (keep / 'sources').is_dir()
    shutil.rmtree(bundle)


def test_corrupt_missing_and_unsafe_bundle_never_replace_live_data(admin, settings, tmp_path):
    upload(admin)
    original = full_settings(settings)
    bundle = tmp_path.parent / (tmp_path.name + '-bundle')
    backup_full(original, bundle)
    with pytest.raises(ValueError, match='overwrite'):
        backup_full(original, bundle)
    before = original.db_path.read_bytes()
    pdf = next((bundle / 'sources').glob('*.pdf'))
    raw = pdf.read_bytes()
    pdf.write_bytes(b'corrupt')
    with pytest.raises(ValueError, match='checksum'):
        restore_full(original, bundle)
    assert original.db_path.read_bytes() == before
    pdf.write_bytes(raw)
    pdf.unlink()
    with pytest.raises(ValueError, match='list mismatch'):
        restore_full(original, bundle)
    pdf.symlink_to(next((original.data_dir / 'sources').glob('*.pdf')))
    with pytest.raises(ValueError, match='symlinks'):
        restore_full(original, bundle)
    pdf.unlink()
    pdf.write_bytes(raw)
    (bundle / 'manifest.json').write_text('[]')
    with pytest.raises(ValueError, match='unsupported'):
        restore_full(original, bundle)
    assert original.db_path.read_bytes() == before
    with pytest.raises(ValueError, match='outside'):
        backup_full(original, original.data_dir / 'backup')
    shutil.rmtree(bundle)


def test_setup_cli_first_owner_editor_and_password_not_logged(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv('PI_DATA_DIR', str(tmp_path))
    monkeypatch.setenv('PI_DB_PATH', str(tmp_path / DB_NAME))
    monkeypatch.setenv('PI_SETUP_ALLOW_STDIN', '1')
    password = secrets.token_urlsafe(18)
    monkeypatch.setattr('sys.stdin', io.StringIO(f'local-owner\n{password}\n{password}\n'))
    assert cli.main(['setup']) == 0
    assert password not in capsys.readouterr().out
    assert cli.main(['setup']) == 1
    monkeypatch.setattr('sys.stdin', io.StringIO(f'local-editor\n{password}\n{password}\n'))
    assert cli.main(['setup', '--add']) == 0
    conn = connect(tmp_path / DB_NAME)
    assert [r[0] for r in conn.execute('SELECT role FROM admins ORDER BY id')] == ['owner', 'editor']
    assert password not in conn.execute('SELECT password_hash FROM admins LIMIT 1').fetchone()[0]
    conn.close()
    bundle = tmp_path.parent / (tmp_path.name + '-cli-bundle')
    assert cli.main(['backup', '--full', str(bundle)]) == 0
    assert cli.main(['restore', '--full', str(bundle)]) == 0
    shutil.rmtree(bundle)
