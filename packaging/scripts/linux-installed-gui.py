"""Disposable-container test only. Run with the INSTALLED bundled interpreter.

No Node, system Python, uv or pip is installed for the owner. xdotool/ImageMagick/Xvfb
are test instruments, not package dependencies. No real profile or public tunnel.
"""
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import time
import urllib.request

root = Path('/opt/Practice Institute')
python = root / 'resources/runtime/python/bin/python3'
data = Path.home() / '.local/share/practice-institute/data'
env = dict(os.environ, PI_DATA_DIR=str(data), PI_ADMIN_DIST=str(root / 'resources/runtime/admin'))
cli = [str(python), '-I', '-B', '-X', 'utf8', '-m', 'practice_institute.cli']

def run(args, **kwargs):
    return subprocess.run(['rtk', 'proxy', *map(str, args)], check=True, **kwargs)

def wait(predicate, label, seconds=40):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            value = predicate()
            if value: return value
        except (OSError, ValueError, subprocess.CalledProcessError): pass
        time.sleep(.2)
    raise AssertionError(label)

def health(port=8787):
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/v1/health', timeout=1) as response:
            return response.status == 200
    except OSError: return False

def start_gui(label, injected=False):
    log = open('/tmp/' + label + '.log', 'wb')
    # Docker denies Chromium namespace operations. This fixture explicitly disables
    # OS sandboxing; shipping launcher and desktop entry never include this flag.
    launch_env = dict(os.environ)
    args = [str(root / 'practice-institute'), '--no-sandbox']
    if injected:
        Path('/tmp/pi-node-injection.cjs').write_text("require('fs').writeFileSync('/tmp/pi-node-injected', 'unsafe')")
        launch_env.update(ELECTRON_RUN_AS_NODE='1', NODE_OPTIONS='--require=/tmp/pi-node-injection.cjs')
        args += ['--inspect=127.0.0.1:19229']
    app = subprocess.Popen(args, env=launch_env, stdout=log, stderr=log)
    window = wait(lambda: run(['xdotool', 'search', '--onlyvisible', '--name', '^Practice Institute$'], capture_output=True).stdout.decode().splitlines()[0], 'No installed owner window')
    time.sleep(4)
    run(['import', '-window', window, '/results/' + label + '.png'])
    wm = run(['xprop', '-id', window, 'WM_CLASS'], capture_output=True).stdout.decode()
    Path('/results/' + label + '-wm-class.txt').write_text(wm)
    entry = dict(line.split('=', 1) for line in Path('/results/installed.desktop').read_text().splitlines() if '=' in line)
    assert entry['StartupWMClass'] in [part.strip() for part in wm.split('"')[1::2]], wm
    if injected:
        assert not Path('/tmp/pi-node-injected').exists(), 'NODE_OPTIONS executed code'
        with socket.socket() as probe:
            assert probe.connect_ex(('127.0.0.1', 19229)) != 0, 'CLI inspector is listening'
    return app, window, log

def stop_gui(app, log):
    app.terminate()
    try: app.wait(timeout=3)
    except subprocess.TimeoutExpired:
        # Fixture teardown after stopped writers. This is not proof of a user's
        # native quit-dialog interaction and no owner process is touched.
        app.kill()
        app.wait(timeout=15)
    log.close()

password = 'Synthetic-' + secrets.token_hex(16)
created_this_run = not data.joinpath('practice-institute.sqlite3').exists()
if created_this_run:
    first, window, log = start_gui('installed-first-run')
    try:
        assert data.joinpath('practice-institute.sqlite3').is_file(), 'First-run GUI did not initialize profile'
        # Xvfb has no window manager to assign keyboard focus after a mouse click.
        run(['xdotool', 'windowfocus', '--sync', window])
        # Type secrets through stdin, never argv or logs. Use the shipped forms.
        for x, y, value in [(150, 211, 'synthetic-owner'), (150, 289, password), (150, 431, password)]:
            run(['xdotool', 'mousemove', '--window', window, str(x), str(y), 'click', '1'])
            run(['xdotool', 'type', '--clearmodifiers', '--file', '-'], input=value.encode())
        # The live password hint expands the form. Submit by keyboard from the
        # confirmation field rather than relying on the button's original Y.
        run(['xdotool', 'key', 'Tab', 'Return'])
        time.sleep(2)
        run(['import', '-window', window, '/results/installed-account-submit.png'])
        wait(lambda: json.loads(run(cli + ['owner-status'], env=env, capture_output=True).stdout)['owner_exists'], 'GUI account creation failed')
        time.sleep(2)
        run(['import', '-window', window, '/results/installed-website-step.png'])
        # Saving the optional blank addresses keeps local-only use and writes the
        # real settings file whose bytes the upgrade/purge test will preserve.
        run(['xdotool', 'mousemove', '--window', window, '150', '443', 'click', '1'])
        time.sleep(2)
        assert Path.home().joinpath('.config/practice-institute/config.json').is_file(), 'GUI settings were not saved'
    finally:
        stop_gui(first, log)
# Relaunch uses the persisted owner. With fuses off even these hostile environment
# options must still open the normal packaged launcher and no inspector/code hook.
app, window, log = start_gui('installed-home', injected=True)
try:
    run(['xdotool', 'mousemove', '--window', window, '150', '265', 'click', '1'])
    wait(health, 'GUI Start server failed')
    assert health(8788)
    if created_this_run:
        login = urllib.request.Request('http://127.0.0.1:8787/api/admin/login',
            data=json.dumps({'username': 'synthetic-owner', 'password': password}).encode(),
            headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(login, timeout=5) as response:
            assert response.status == 200, 'GUI-created credentials did not authenticate'
    try:
        urllib.request.urlopen('http://127.0.0.1:8788/api/admin/me', timeout=2)
        raise AssertionError('Public admin exposed')
    except urllib.error.HTTPError as error: assert error.code == 404
    # HTTP becomes ready before Electron finishes its own probes + activity refresh.
    # Let the Running banner/controls settle before positional X11 test input.
    time.sleep(4)
    run(['import', '-window', window, '/results/installed-running.png'])
    def click_stop():
        if not health(): return True
        run(['xdotool', 'mousemove', '--window', window, '285', '355', 'click', '1'])
        return False
    wait(click_stop, 'GUI Stop server failed')
finally:
    stop_gui(app, log)
assert json.loads(run(cli + ['owner-status'], env=env, capture_output=True).stdout)['owner_exists']
print('Installed non-root Ubuntu GUI PASS: account creation through forms (fresh profile), restart/persisted owner, Start/Stop, public admin 404, WM_CLASS, RunAsNode/NODE_OPTIONS/inspect disabled. Container uses --no-sandbox; OS sandbox unverified.')
