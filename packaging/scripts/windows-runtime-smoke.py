r"""Synthetic bundled-backend smoke on Windows or Wine (not installer/GUI proof).

Run with <installed resources>\runtime\python\python.exe -I -B -X utf8 this-script.py.
All passwords use stdin, data is temporary, and only the spawned process is stopped.
"""
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

assert sys.platform == 'win32' and sys.maxsize > 2**32
python = Path(sys.executable)
runtime = python.parent.parent
args = [str(python), '-I', '-B', '-X', 'utf8', '-m', 'practice_institute.cli']

def free():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]

with tempfile.TemporaryDirectory(prefix='pi-Windows-ünï ') as profile:
    env = dict(os.environ, PI_DATA_DIR=str(Path(profile) / 'data'), PI_ADMIN_DIST=str(runtime / 'admin'), PI_ALLOWED_ORIGINS='https://student.example', PI_COOKIE_SECURE='false')
    def command(command, data=None, json_response=True):
        r = subprocess.run(args + command, env=env, input=data, text=True, encoding='utf-8', capture_output=True, timeout=60)
        assert r.returncode == 0, 'Bundled Windows CLI failed (stderr intentionally not echoed)'
        return json.loads(r.stdout) if json_response else None
    assert not command(['owner-status'])['owner_exists']
    password = 'Synthetic-🔒-' + secrets.token_hex(16)
    assert command(['setup-owner', '--stdin-json'], json.dumps({'username': 'synthetic-owner', 'password': password, 'confirm': password}) + '\n')['ok']
    assert command(['owner-status'])['owner_exists']
    owner, public = free(), free()
    while public == owner: public = free()
    server = subprocess.Popen(args + ['serve-desktop', '--stdin-control', '--owner-port', str(owner), '--public-port', str(public)], env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding='utf-8')
    try:
        event = json.loads(server.stdout.readline())
        assert event['event'] == 'ready', 'No real readiness event'
        for port in (owner, public):
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/v1/health', timeout=5) as response: assert response.status == 200
        for route in ('/admin/', '/api/admin/me', '/api/v10/health', '/docs', '/api%2fv1/health'):
            try:
                urllib.request.urlopen(f'http://127.0.0.1:{public}' + route, timeout=5)
                raise AssertionError('Forbidden public route reached backend')
            except urllib.error.HTTPError as error: assert error.code == 404
        login = urllib.request.Request(f'http://127.0.0.1:{owner}/api/admin/login', data=json.dumps({'username': 'synthetic-owner', 'password': password}).encode(), headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(login, timeout=5) as response: assert response.status == 200
    finally:
        server.communicate('stop\n', timeout=15)
    assert server.returncode == 0
    assert command(['exam-activity']) == {'active_attempts': 0, 'open_exams': 0}
    bundle = Path(profile) / 'full-backup'
    command(['backup', '--full', str(bundle)], json_response=False)
    command(['restore', '--full', str(bundle)], json_response=False)
    assert command(['owner-status'])['owner_exists']
print('Bundled Windows backend smoke PASS: x64 imports/SQLite migrations, Unicode profile + stdin password, real dual readiness/probes, admin/encoded boundary 404, owner login, owned stop, full backup/restore. Wine is not native Windows verification.')
