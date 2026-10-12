#!/usr/bin/env bash
# Developer-only 0.1.1 fixture: same runtime, separate package version/output.
# Never replaces release/ artifacts or changes the source package version.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT/desktop"
rtk npm run build
rtk proxy env ELECTRON_CACHE="$ROOT/.cache/electron" ELECTRON_BUILDER_CACHE="$ROOT/.cache/electron-builder" \
  node node_modules/electron-builder/cli.js --linux deb --x64 --publish never \
  -c.extraMetadata.version=0.1.1 -c.directories.output=../.cache/upgrade-release
