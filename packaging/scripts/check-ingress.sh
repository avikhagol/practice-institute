#!/usr/bin/env bash
# Offline cloudflared ingress rule check for the desktop tunnel template.
# Usage: packaging/scripts/check-ingress.sh [path/to/cloudflared]
# Uses a dummy UUID and never contacts Cloudflare (ingress validate/rule are local commands).
set -euo pipefail
CF="${1:-cloudflared}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$ROOT/.cache/ingress-check"
rtk proxy mkdir -p "$WORK"
rtk proxy sed -e 's#<TUNNEL-UUID>#00000000-0000-4000-8000-000000000000#g' \
  "$ROOT/backend/deploy/cloudflared.desktop.example.yml" > "$WORK/config.yml"
rtk proxy "$CF" --version
rtk proxy "$CF" tunnel --config "$WORK/config.yml" ingress validate
fail=0
expect() {
  local url="$1" want="$2" got
  got="$(rtk proxy "$CF" tunnel --config "$WORK/config.yml" ingress rule "$url" 2>&1)"
  if rtk proxy grep -q "$want" <<<"$got"; then echo "ok   $url -> $want"; else echo "FAIL $url (wanted $want)"; echo "$got"; fail=1; fi
}
expect https://api.example.invalid/api/v1/health 'http://127.0.0.1:8788'
expect https://api.example.invalid/api/v1 'http://127.0.0.1:8788'
expect https://api.example.invalid/api/v10/health 'http_status:404'
expect https://api.example.invalid/api/v1x 'http_status:404'
expect https://api.example.invalid/admin/ 'http_status:404'
expect https://api.example.invalid/api/admin/me 'http_status:404'
expect https://other.invalid/api/v1/health 'http_status:404'
exit "$fail"
