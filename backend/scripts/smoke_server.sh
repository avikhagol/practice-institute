#!/usr/bin/env bash
# Real-process smoke test: disposable DB, loopback server, health/auth/CORS/backup checks.
# Usage: bash scripts/smoke_server.sh [port]   (run from backend/)
set -euo pipefail
PORT="${1:-8799}"
DATA="$(mktemp -d /tmp/pi-smoke-XXXXXX)"
export PI_DATA_DIR="$DATA" PI_ALLOWED_ORIGINS="http://127.0.0.1:4318"
pass="smoke-$(head -c 12 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9')"

uv run pi-admin migrate
printf 'smokeowner\n%s\n%s\n' "$pass" "$pass" | PI_SETUP_ALLOW_STDIN=1 uv run pi-admin setup > /dev/null
echo "setup: ok (disposable owner)"

uv run pi-admin serve --port "$PORT" > "$DATA/server.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true; wait $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do curl -sf "http://127.0.0.1:$PORT/api/v1/health" > /dev/null && break; sleep 0.25; done

echo "health: $(curl -s "http://127.0.0.1:$PORT/api/v1/health")"
echo "admin without session: $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/admin/exams")"
code=$(curl -s -o /dev/null -w '%{http_code}' -c "$DATA/jar" -H 'Content-Type: application/json' \
  -d "{\"username\":\"smokeowner\",\"password\":\"$pass\"}" "http://127.0.0.1:$PORT/api/admin/login")
echo "admin login: $code"
echo "admin with session: $(curl -s -o /dev/null -w '%{http_code}' -b "$DATA/jar" "http://127.0.0.1:$PORT/api/admin/exams")"
echo "admin mutation without CSRF: $(curl -s -o /dev/null -w '%{http_code}' -b "$DATA/jar" -H 'Content-Type: application/json' -d '[]' "http://127.0.0.1:$PORT/api/admin/questions")"
echo "CORS allowed origin: $(curl -s -D - -o /dev/null -X OPTIONS -H 'Origin: http://127.0.0.1:4318' -H 'Access-Control-Request-Method: POST' "http://127.0.0.1:$PORT/api/v1/health" | grep -i '^access-control-allow-origin' | tr -d '\r')"
echo "CORS disallowed origin header present: $(curl -s -D - -o /dev/null -X OPTIONS -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: POST' "http://127.0.0.1:$PORT/api/v1/health" | grep -ci '^access-control-allow-origin' || true)"
echo "listening: $(ss -ltn 2>/dev/null | awk -v p=":$PORT" '$4 ~ p {print $4}')"
uv run pi-admin backup "$DATA/backup.sqlite3"
echo "backup tables: $(sqlite3 "$DATA/backup.sqlite3" 'SELECT COUNT(*) FROM admins' 2>/dev/null || python3 -c "import sqlite3,sys;print(sqlite3.connect(sys.argv[1]).execute('SELECT COUNT(*) FROM admins').fetchone()[0])" "$DATA/backup.sqlite3") admin row(s)"
