# Practice Institute backend

FastAPI + SQLite. It stores exams, question banks, attempts, server-authoritative deadlines, answers, grades and release controls. The design is in [../ARCHITECTURE.md](../ARCHITECTURE.md).

## Setup (run from `backend/`)

```bash
rtk uv sync --locked                     # creates .venv from uv.lock
rtk proxy cp .env.example .env                     # edit placeholders; no secrets go in this file
set -a; . ./.env; set +a                 # the app reads process env vars (it does not auto-load .env)
rtk uv run pi-admin migrate                  # create or upgrade the database
rtk uv run pi-admin setup                    # INTERACTIVE: owner username + password (min 12 chars, never echoed)
rtk uv run pi-admin serve                    # http://127.0.0.1:8787 (loopback only)
```

To stop the server, press Ctrl-C. In-flight requests finish, and the expiry sweeper resumes when the server starts again.

## Tests

```bash
rtk uv run pytest -q                         # disposable temp databases with random throwaway admin passwords
rtk proxy bash scripts/smoke_server.sh 8799        # real uvicorn process on loopback: health, auth, CSRF, CORS, backup
```

## Backup and restore

```bash
rtk uv run pi-admin backup ~/pi-backups/pi-$(date +%F).sqlite3     # online, consistent (SQLite backup API)
# Stop the server before restoring:
rtk uv run pi-admin restore ~/pi-backups/pi-2026-10-11.sqlite3     # integrity-checks first; keeps the old DB as *.pre-restore-*.sqlite3
```

For a complete database + original-source bundle, stop the server and run
`rtk uv run pi-admin backup --full /absolute/private/backups/cohort-before`.
Restore it while stopped using `rtk uv run pi-admin restore --full /absolute/private/backups/cohort-before`.
The full commands require the default database filename inside `PI_DATA_DIR`,
verify checksums/integrity, relocate source paths, revoke admin sessions, and keep
the previous complete data directory. See [owner deployment and recovery](deploy/README.md)
for privacy, layout, cutoff, outage and tunnel instructions.

Back up before and after every cohort exam. `data/` (the database and uploaded source PDFs) is git-ignored and must never be published.


## Admin browser UI (Turn 2)

Build the separate same-origin admin bundle before starting/restarting the backend:

```bash
# From app/
rtk npm ci
rtk npm run build:admin
# From backend/
rtk uv sync
rtk uv run pi-admin setup                 # first owner only; interactive
rtk uv run pi-admin serve
```

Open `http://127.0.0.1:8787/admin/`. Sign in with the account created by setup.
The cookie is HttpOnly; the CSRF token stays in page memory and is recovered via
`/api/admin/me` after a reload. Editors may upload, review, and create drafts.
Only owners may publish, release results, extend, or close exams. Add an editor
with `rtk uv run pi-admin setup --add`.

Upload requires a source label, provenance note, and permission checkbox. Originals
are limited to `PI_MAX_UPLOAD_BYTES` (40 MB) and `PI_MAX_SOURCE_PAGES` (200), rejected
if invalid/encrypted, deduplicated by SHA-256, and stored in `PI_DATA_DIR/sources/`.
Source downloads require an admin session. Browser text extraction uses the inherited
PDF.js pipeline; all candidates enter as `needs-review`. Re-uploading the same file
retries extraction and skips question numbers already imported. Scans and legacy
Hindi use explicit admin OCR and manual crop correction (see app/README.md). Pairing is by question number
and option key; ambiguous mixed-script text is preserved with a warning.

Review shows the full original page beside English and Hindi editors. Verify the
answer key separately, acknowledge text/warnings, and mark reviewed. A stale version
gets 409 instead of silently overwriting another editor. Publish freezes the paper;
subsequent edits never alter existing grades. Extension only affects attempts whose
stored deadline has not passed and never reopens a finished attempt. Closing an exam
finalises active attempts immediately. CSV aliases are escaped to prevent formulas.
Ranks contain aliases, ranks, and scores only, and public ranks require explicit release.

The default SQLite backup command backs up the database only. Prefer the stopped
`backup --full` bundle to retain source originals and restore their paths together;
never publish originals or the database in the static bundle.

Browser acceptance uses a temporary database and test-only account, and removes the
server data at shutdown:

```bash
# From app/ (Playwright Chromium must be installed or set PW_CHROMIUM)
rtk npx playwright test --config playwright.admin.config.ts
rtk npx playwright test
rtk npm test
rtk npm run build:pages
```
