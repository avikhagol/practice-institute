#!/usr/bin/env bash
# Wine cross-build is artifact evidence, not native Windows installation proof.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE='electronuserland/builder:wine@sha256:41ae540902461b6cbc988987db79547fcc10cda04d2a6c6367504f59d4b37c64'
[[ -f "$ROOT/packaging/output/runtime-win/manifest.json" ]] || { echo 'Build the Windows runtime first.' >&2; exit 2; }
cd "$ROOT/desktop"
rtk npm run build
rtk proxy docker run --rm --network bridge \
  --mount "type=bind,source=$ROOT,target=/project" --workdir /project/desktop \
  --env ELECTRON_CACHE=/project/.cache/electron \
  --env ELECTRON_BUILDER_CACHE=/project/.cache/electron-builder --env WINEDEBUG=-all \
  "$IMAGE" node node_modules/electron-builder/cli.js --win nsis --x64 --publish never
