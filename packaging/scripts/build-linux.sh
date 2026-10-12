#!/usr/bin/env bash
# Local developer tooling only; no publication, no host install.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
[[ -f "$ROOT/packaging/output/runtime-linux/manifest.json" ]] || { echo 'Build the Linux runtime first.' >&2; exit 2; }
cd "$ROOT/desktop"
rtk npm run build
rtk proxy env ELECTRON_CACHE="$ROOT/.cache/electron" ELECTRON_BUILDER_CACHE="$ROOT/.cache/electron-builder" \
  node node_modules/electron-builder/cli.js --linux deb --x64 --publish never
