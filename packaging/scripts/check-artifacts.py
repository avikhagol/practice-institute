"""Structural/extraction audit; never labels Wine or extraction native installation."""
import hashlib
import json
from pathlib import Path
import struct
import sys

root = Path(__file__).resolve().parents[2]
release = root / 'release'
manifest = json.loads((release / 'manifest.json').read_text())
for artifact in manifest['artifacts']:
    p = release / artifact['name']
    assert p.stat().st_size == artifact['bytes']
    assert hashlib.file_digest(p.open('rb'), 'sha256').hexdigest() == artifact['sha256']

def pe(path, machine):
    data = path.read_bytes()
    assert data[:2] == b'MZ'
    offset = struct.unpack_from('<I', data, 0x3c)[0]
    assert data[offset:offset+4] == b'PE\0\0'
    assert struct.unpack_from('<H', data, offset+4)[0] == machine, path.name
    magic = struct.unpack_from('<H', data, offset+24)[0]
    cert = offset+24+(112 if magic == 0x20b else 96)+8*4
    return struct.unpack_from('<II', data, cert)

installer = release / manifest['artifacts'][0]['name']
assert pe(installer, 0x14c) == (0, 0), 'Owner installer unexpectedly has a certificate'
# NSIS is a 32-bit bootstrap carrying a 64-bit application; do not confuse the two.
for name in ['Practice Institute.exe', 'resources/runtime/python/python.exe', 'resources/runtime/cloudflared/cloudflared.exe']:
    pe(release / 'win-unpacked' / name, 0x8664)

extracted = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root / '.cache/windows-installed-payload'
if not extracted.is_dir(): raise AssertionError('Extract the NSIS app-64.7z first; see packaging/README.md')
expected = manifest['resources']['win']['files']
actual = {str(p.relative_to(extracted)) for p in extracted.rglob('*') if p.is_file()}
assert actual == set(expected), 'NSIS embedded payload differs from unpacked file list'
for name, record in expected.items():
    p = extracted / name
    with p.open('rb') as stream: assert hashlib.file_digest(stream, 'sha256').hexdigest() == record['sha256'], name
assert (extracted / 'resources/runtime/python/python312._pth').read_text() == 'python312.zip\n.\nsite-packages\n../app\n'

def entries(path):
    return dict(line.split('=', 1) for line in path.read_text().splitlines() if '=' in line)
fixture = entries(root / 'desktop/build/linux/practice-institute.desktop.fixture')
installed = entries(root / '.cache/linux-install/installed.desktop')
for key in ('Name', 'Exec', 'Terminal', 'Type', 'Icon', 'StartupWMClass', 'Categories', 'Comment'):
    assert installed[key] == fixture[key], key
assert '--no-sandbox' not in installed['Exec']
print('Artifact audit PASS: installer hashes; unsigned NSIS bootstrap; x64 launcher/Python/cloudflared; all embedded Windows payload hashes; isolated _pth; real installed Linux desktop entry matches fixture. Native Windows runtime not tested.')
