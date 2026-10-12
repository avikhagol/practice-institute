#!/usr/bin/env bash
# Developer build only. The installed owner never needs Python, Node, uv or a shell.
set -euo pipefail
if [[ $# != 1 || ( "$1" != win && "$1" != linux ) ]]; then
  echo 'Usage: build-runtime.sh {win|linux}' >&2
  exit 2
fi
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
rtk proxy python3 - "$ROOT" "$1" <<'PY'
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from datetime import datetime, timezone

root, platform = Path(sys.argv[1]), sys.argv[2]
pins = json.loads((root / 'packaging/pins.json').read_text())['downloads']
vendor = root / 'packaging/vendor'
vendor.mkdir(parents=True, exist_ok=True)
output = root / 'packaging/output'
output.mkdir(parents=True, exist_ok=True)
destination = output / f'runtime-{platform}'
stage = Path(tempfile.mkdtemp(prefix=f'.runtime-{platform}-', dir=output))

def run(args, **kwargs):
    subprocess.run(['rtk', 'proxy', *map(str, args)], check=True, **kwargs)

def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def download(key):
    pin = pins[key]
    path = vendor / pin['filename']
    if not path.exists():
        partial = path.with_suffix(path.suffix + '.partial')
        run(['curl', '--fail', '--location', '--retry', '3', '--max-time', '300',
             '--proto', '=https', '--proto-redir', '=https', pin['url'], '--output', partial])
        if sha(partial) != pin['sha256']:
            partial.unlink()
            raise ValueError(f'Checksum mismatch: {key}')
        partial.replace(path)
    if sha(path) != pin['sha256']:
        raise ValueError(f'Cached checksum mismatch: {key}')
    return path

try:
    archive = download(f'python-{platform}')
    python = stage / 'python'
    if platform == 'win':
        python.mkdir()
        with zipfile.ZipFile(archive) as z:
            z.extractall(python)
        (python / 'python312._pth').write_text(
            'python312.zip\n.\nsite-packages\n../app\n', encoding='ascii')
        packages = python / 'site-packages'
        target = 'x86_64-pc-windows-msvc'
    else:
        with tarfile.open(archive) as t:
            t.extractall(stage, filter='data')
        packages = python / 'lib/python3.12/site-packages'
        # The standalone image contains build-time pip. Ship only the locked runtime set.
        shutil.rmtree(packages)
        packages.mkdir()
        for executable in ('pip', 'pip3', 'pip3.12'):
            (python / 'bin' / executable).unlink(missing_ok=True)
        target = 'x86_64-manylinux_2_28'
    lock = root / f'backend/requirements-runtime-{platform}.txt'
    run(['uv', 'pip', 'install', '--no-config', '--index-url', 'https://pypi.org/simple',
         '--cache-dir', vendor / 'uv-cache', '--target', packages,
         '--python-platform', target, '--python-version', '3.12', '--only-binary', ':all:',
         '--require-hashes', '--no-deps', '--no-compile-bytecode', '-r', lock])
    shutil.copytree(root / 'backend/practice_institute', stage / 'app/practice_institute',
                    ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '*.pyo'))
    if platform == 'linux':
        shutil.copytree(stage / 'app/practice_institute', packages / 'practice_institute')
    # Build admin from the locked, installed dependencies. Include OCR/worker/font assets.
    for language in ('eng', 'hin'):
        if not (root / f'app/public/tesseract/lang-data/{language}.traineddata').is_file():
            raise ValueError('Download pinned OCR models with app assets:ocr:download first')
    run(['npm', 'run', 'build:admin'], cwd=root / 'app')
    shutil.copytree(root / 'app/dist-admin', stage / 'admin')
    cloud = stage / 'cloudflared'
    cloud.mkdir()
    cloudbin = cloud / ('cloudflared.exe' if platform == 'win' else 'cloudflared')
    shutil.copyfile(download(f'cloudflared-{platform}'), cloudbin)
    cloudbin.chmod(0o755)
    licenses = stage / 'licenses'
    licenses.mkdir()
    shutil.copyfile(download('python-license'), licenses / 'CPython-LICENSE')
    shutil.copyfile(download('cloudflared-license'), licenses / 'cloudflared-LICENSE')
    distribution_notice = (python / 'LICENSE.txt' if platform == 'win'
                           else python / 'lib/python3.12/LICENSE.txt')
    shutil.copyfile(distribution_notice, licenses / 'CPython-distribution-LICENSE.txt')
    if platform == 'linux':
        # install_only omits the standalone distribution's bundled-library notices.
        # Read only metadata/notices from the matching checksum-pinned full archive.
        full = download('python-linux-licenses')
        with subprocess.Popen(['rtk', 'proxy', 'zstd', '-dc', str(full)],
                              stdout=subprocess.PIPE) as decompressor:
            with tarfile.open(fileobj=decompressor.stdout, mode='r|') as t:
                for member in t:
                    if not member.isfile():
                        continue
                    if member.name == 'python/PYTHON.json':
                        relative = Path('PYTHON.json')
                    elif member.name.startswith('python/licenses/'):
                        relative = Path(member.name).relative_to('python/licenses')
                    else:
                        continue
                    if relative.is_absolute() or '..' in relative.parts:
                        raise ValueError('Unsafe license archive member')
                    notice = licenses / 'python-standalone' / relative
                    notice.parent.mkdir(parents=True, exist_ok=True)
                    with t.extractfile(member) as src, notice.open('wb') as dst:
                        shutil.copyfileobj(src, dst)
            if decompressor.wait() != 0:
                raise ValueError('Standalone license archive decompression failed')
    wheels = []
    for info in sorted(packages.glob('*.dist-info')):
        shutil.copytree(info, licenses / 'python-wheels' / info.name,
                        ignore=shutil.ignore_patterns('RECORD', 'INSTALLER', 'REQUESTED',
                                                    'entry_points.txt', 'top_level.txt'))
        wheel = (info / 'WHEEL').read_text()
        wheels.append({'distribution': info.name,
                       'tags': re.findall(r'^Tag: (.+)$', wheel, re.M)})
    for relative in ('pdfjs-dist', 'tesseract.js', 'tesseract.js-core',
                     '@fontsource-variable/fraunces', '@fontsource-variable/source-sans-3',
                     '@fontsource/noto-sans-devanagari', 'react', 'react-dom', 'idb-keyval'):
        source = root / 'app/node_modules' / relative
        folder = licenses / 'admin' / relative
        folder.mkdir(parents=True, exist_ok=True)
        for path in source.iterdir():
            if path.is_file() and path.name.lower().startswith(('license', 'copying', 'notice')):
                shutil.copyfile(path, folder / path.name)
        shutil.copyfile(source / 'package.json', folder / 'package.json')
    shutil.copyfile(root / 'app/public/tesseract/lang-data/LICENSE', licenses / 'tessdata-LICENSE')
    # Electron/Chromium notices are supplied by electron-builder at installer assembly.
    glibc = set()
    if platform == 'linux':
        for path in python.rglob('*'):
            if path.is_file() and not path.is_symlink() and path.open('rb').read(4) == b'\x7fELF':
                result = subprocess.run(['rtk', 'proxy', 'objdump', '-T', str(path)],
                                        capture_output=True, text=True, check=True)
                glibc.update(re.findall(r'GLIBC_(\d+\.\d+(?:\.\d+)?)', result.stdout))
    files = {str(path.relative_to(stage)): sha(path) for path in sorted(stage.rglob('*'))
             if path.is_file() and not path.is_symlink()}
    symlinks = {str(path.relative_to(stage)): os.readlink(path)
                for path in sorted(stage.rglob('*')) if path.is_symlink()}
    manifest = {'schema': 1, 'platform': platform, 'architecture': 'x86_64',
                'builtAt': datetime.now(timezone.utc).isoformat(),
                'downloads': {key: pins[key] for key in
                              (f'python-{platform}', f'cloudflared-{platform}',
                               'python-license', 'cloudflared-license',
                               *(['python-linux-licenses'] if platform == 'linux' else []))},
                'requirementsSha256': sha(lock), 'wheels': wheels,
                'glibcBaseline': '2.28' if platform == 'linux' else None,
                'glibcMaxRequired': max(glibc, key=lambda v: tuple(map(int, v.split('.'))))
                                    if glibc else None,
                'electronLicenses': 'Provided by electron-builder at installer assembly',
                'files': files, 'symlinks': symlinks}
    (stage / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    if destination.exists():
        shutil.rmtree(destination)
    stage.replace(destination)
    print(json.dumps({'runtime': str(destination), 'files': len(files),
                      'glibcMaxRequired': manifest['glibcMaxRequired']}))
finally:
    if stage.exists():
        shutil.rmtree(stage)
PY
