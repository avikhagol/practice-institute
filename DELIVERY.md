# Practice Institute — delivery

Practice Institute is a bilingual (English/Hindi) mock-exam platform. It has three parts:

- **Student app.** A static Vite/React site served under `/practice-institute/`, ready for GitHub Pages.
- **Local backend.** FastAPI + SQLite on the owner's machine. It holds exams, server-authoritative deadlines, answers, grades and release controls.
- **Admin desk.** Authenticated and same-origin at `http://127.0.0.1:8787/admin/`. It covers source upload, text-layer import, optional Tesseract.js OCR, review, the exam builder, results and release.

A separate browser-only PDF practice mode remains at `#/local`.

Contract: [ARCHITECTURE.md](ARCHITECTURE.md). Checklist: [PROGRESS-task-practice-institute.md](PROGRESS-task-practice-institute.md). Owner operations: [backend/deploy/README.md](backend/deploy/README.md). Turn reports are in [reports/](reports/).

## Exam builder select-all (2026-10-12)

**Exams → Build an exam** now has a checkbox above the manual question list to select or deselect all reviewed questions matching the current filters. It shows a partial-selection mark when some matching questions are selected. Questions selected under other filters stay selected; **Clear selection** removes the whole selection. Unreviewed questions remain ineligible.

Validation: all **86 Vitest tests** passed, including filtered selection, partial state, deselection, unique draft question IDs and empty matches. TypeScript and the admin production build passed. Browser verification remains unavailable due to the localhost restriction described below.

## Question bank bulk review (2026-10-11)

After uploading a paper, open **Sources → Review questions** to filter the bank to that paper, or choose a source from **Question bank**.

1. Select individual question checkboxes or **Select all matching questions**. This selects every question matching the current source, status and search filters. Changing a filter clears the selection.
2. Choose **Mark as reviewed**, **Mark as needs review**, or **Exclude questions** from **Bulk action**.
3. For reviewed status, tick the acknowledgement that you checked all selected questions against the originals, then choose **Apply to selected**.

Bulk actions preserve answer keys and their verification flags. Scored exams still require individually verified keys. Updates use the existing version checks; if an update fails, completed changes remain saved and the remaining questions stay selected for retry after the bank refreshes. Published exam snapshots remain unchanged.

Validation: TypeScript and the admin production build passed; all **85 Vitest tests** passed, including bulk selection, filtered scope, key preservation and partial-failure retry. Added desktop/mobile Playwright coverage (including 320px reflow), but it could not execute in this restricted environment because localhost HTTP access returned `EPERM`. No browser visual verification is claimed for this change.

## Status at a glance

| Area | Status |
| --- | --- |
| Local two-user cohort + independent exams, admin, release, grading | **Verified locally (Turn 8)** |
| Server restart, timeout without browser, cutoff, idempotent submit, token isolation | **Verified locally (Turn 8)** |
| Full database + source backup/restore | **Verified locally (Turn 8 rehearsal + Turn 7 tests)** |
| Pages subpath build, CSP, CORS allow/deny, asset leak audit | **Verified locally** (CORS browser test re-run in Turn 8; build audit re-run on final bundle) |
| Real English/Hindi OCR after real asset download | **Inherited evidence** (T3 benchmark, T6 real papers; admin OCR browser test re-run in Turn 8) |
| Accessibility | **Manual alternative only** (keyboard, 320px reflow, focus, contrast). Automated axe and real screen reader **not performed** |
| Public GitHub Pages / Cloudflare Tunnel / domain / HTTPS | **Deferred to owner. Not performed** |

## Turn 8 executed results (2026-10-11)

These checks were all run in this turn on this machine (i7-12700H, Node 22.22.2, Python 3.12):

| Check | Result |
| --- | --- |
| Backend `uv run --locked pytest -q` | **44 passed**, 1 inherited Starlette/httpx deprecation warning |
| Vitest | **84 passed** (33 suites) |
| `npm run typecheck` | Passed |
| Student production Playwright (real backend, two isolated contexts, desktop + Pixel 7) | **7 passed / 1 intentional skip** |
| Admin/OCR Playwright (genuine eng+hin OCR, crop correction, cancel, 320px keyboard) | **10 passed / 2 intentional skips**. Run before and again after the Turn 8 admin fixes |
| Inherited Pages Playwright (PDF worker, local practice) | **50 passed / 2 intentional skips** |
| Independent owner-path rehearsal (below) | **26/26 API checks + restore check passed** |
| Real-browser demo on the documented preview + default API 8787 | Desktop and mobile: joined, Hindi shown, save acknowledged, no horizontal overflow, 0 console errors |
| `npm run check:student-build` on the final bundle | Passed: 247 files, API `http://127.0.0.1:8787`, base `/practice-institute/` |
| Disposable ports 4317/8787/8789/8791 after the run | All free. Disposable data deleted |

### Independent owner-path rehearsal

This rehearsal used the shipped `pi-admin` commands with a disposable `PI_DATA_DIR`. The owner's `backend/data/` was never touched. The driver (not shipped) made real HTTP calls; there were no TestClient or synthetic responses.

1. `migrate` and `setup` were run with a random throwaway password. `serve` ran on 8787. Health and the `/admin/` page returned 200.
2. The owner created four reviewed bilingual questions with verified keys, then published one **cohort** exam and one **independent** exam.
3. Two students joined the same cohort. Save before start was rejected. Neither the public facts nor the running payload contained answer keys or explanations.
4. Student A could not read B's attempt. A student bearer token got no admin access. The join code alone could not read an attempt.
5. A saved 4 answers and submitted early. A repeated submit returned the same finish and ignored the new change.
6. B saved 2 correct answers, 1 wrong answer and 1 marked-but-unanswered question. A stale replayed sequence did not overwrite B's newer answer.
7. Results stayed hidden before release.
8. **The API process was stopped and restarted mid-exam.** After the deadline, B's save was rejected. The sweeper finalized B as `timeout` with no browser callback.
9. The admin saw A `submitted` with score 4 and B `timeout` with score 2. After release, A saw 4/4 and B saw 2 (1 wrong, 1 unanswered). Each review contained only that student's answers.
10. Independent mode: the attempt got its own 10-minute deadline. The student submitted, the owner released, and the student saw score 2. A reattempt beyond the limit was refused.
11. **Recovery:** the server was stopped and `backup --full` was run. The bundle had 0700/0600 permissions and a manifest. All attempts and answers were then deleted to simulate loss, and `restore --full` was run. The previous data dir was kept. After restart, owner login worked, both attempts came back with the same scores, and B's original token still resumed B's released result.

### Screenshots inspected this turn

These were refreshed by this turn's runs and inspected visually:

- `screenshots/turn4/cohort-hindi-desktop.png`, `cohort-pending-mobile.png`, `independent-bilingual-mobile.png`
- `screenshots/turn5/cohort-review-desktop.png`
- `screenshots/turn6/lobby-mobile.png`, `admin-results-320.png`
- New: `screenshots/turn8/final-exam-hindi-{desktop,mobile}.png`, taken on the default 8787 bundle

Devanagari shaping, the online/offline pill, pending vs acknowledged saves, the lost-change warning after timeout, released review and 320px admin reflow all looked correct.

## Defects found and fixed in Turn 8

1. **The owner deploy doc's preview command produced a blank student page.** `npm run preview` without `--base` served `/practice-institute/assets/*.js` as `text/html`, because of the SPA fallback. The doc now passes `--base /practice-institute/`. Re-verified: the JS is served as `text/javascript`, and the browser demo passed on that exact command. File: `backend/deploy/README.md`.
2. **Admin release notice was lowercase** ("answers released."). It now reads "Answers released." / "Scores hidden." Files: `app/src/admin/main.tsx` and the two admin specs asserting it.
3. **The admin "Alias-only ranks" heading had no empty state.** It now says "No finished, scored attempts to rank yet." when there are no ranks. File: `app/src/admin/main.tsx`.

Observed but **not changed**:

- The lobby prints start and finish times to the minute. In the 15–30-second test exams they look identical. Real exams last minutes or more, so this was left as is.
- The admin attempts table scrolls horizontally inside its labelled region at 320px. This is by design and was tested in T5/T6.

## Inherited evidence (not re-measured in Turn 8)

- **OCR (T3):** synthetic eng/hin/eng+hin benchmark in [reports/ocr-benchmark.md](reports/ocr-benchmark.md).
  - CER: eng 0%, hin 2.22%, eng+hin 0%.
  - Browser OCR payload: about 6.9 MB. The full copied OCR directory is about 53 MB.
  - Language assets are pinned with hashes ([reports/ocr-asset-download.json](reports/ocr-asset-download.json)).
- **Optional Hugging Face OCR:** no verified, eligible, lightweight Hindi model was found, so none is integrated ([reports/huggingface-eval.md](reports/huggingface-eval.md)).
- **Real papers (T6):** three hash-pinned official CTET papers, text-layer diagnostics and real OCR of six pages ([reports/turn6-real-ocr-qa.md](reports/turn6-real-ocr-qa.md)). Restricted text and pixels are not redistributed.
- **Security, cutoff and recovery details (T7):** [reports/turn7-security-deployment.md](reports/turn7-security-deployment.md).
- **Accessibility manual alternative (T5/T6):** [reports/turn6-accessibility.md](reports/turn6-accessibility.md).

## Run the local demo

Requirements:

- Node ≥ 22.13 and `uv`.
- Playwright Chromium, for tests only.
- About 60 MB of disk for OCR assets.

Keep the backend machine awake and online for the whole cohort.

**Terminal 1 — API + admin.** Run from `backend/`. Do the one-time steps first, then serve:

```bash
rtk uv sync --locked
rtk proxy cp .env.example .env            # placeholders only; edit PI_ALLOWED_ORIGINS if needed
set -a; . ./.env; set +a                  # the app reads process env, not .env directly
rtk uv run pi-admin migrate
rtk uv run pi-admin setup                 # interactive owner username/password (never echoed)
# (first time) in app/: rtk npm ci && rtk npm run build:admin   [optional: rtk npm run assets:ocr:download first]
rtk uv run pi-admin serve                 # http://127.0.0.1:8787 — admin at /admin/
```

**Terminal 2 — student app.** Run from `app/`:

```bash
rtk npm run build:pages
rtk npm run preview -- --base /practice-institute/ --host 127.0.0.1 --port 4317 --strictPort
```

**Demo steps:**

1. Sign in at `http://127.0.0.1:8787/admin/`.
2. Add or review questions in the Question bank. Verify the keys and mark them reviewed.
3. In Exams, build a cohort exam and publish it. Note the 6-character code.
4. Open `http://127.0.0.1:4317/practice-institute/#/join/CODE` in two separate browser profiles, or one normal and one private window. Join with two aliases.
5. Answer, switch between English, हिन्दी and Both, then submit one attempt early and let the other time out.
6. In Results, watch the attempts, then release scores and/or answers. Both students select **Check for results**.

**Stop:** press Ctrl-C in each terminal. Accepted answers and deadlines persist, and the expiry sweeper resumes when the server restarts.

**Tests:** run from the matching directory.

- From `backend/`: `rtk uv run pytest -q`
- From `app/`:
  - `rtk npm test`
  - `rtk npx playwright test --config playwright.student.config.ts`
  - `rtk npx playwright test --config playwright.admin.config.ts`
  - `rtk npx playwright test`

All suites use disposable databases and throwaway accounts.

## Data recovery

Back up before and after every cohort exam:

- **Online, database only:** `rtk uv run pi-admin backup ~/pi-backups/pi-$(date +%F).sqlite3`
- **Full database + source PDFs:** stop the server first, then run `rtk uv run pi-admin backup --full /abs/private/backups/NAME`.
- **Full restore:** with the server stopped, run `rtk uv run pi-admin restore --full /abs/private/backups/NAME`. The old data dir is kept as `data.pre-restore-<ts>`, and admin sessions are revoked, so log in again.

Never restore during an active exam: it rolls back answers and deadlines. Store bundles privately and encrypted. They contain aliases, token hashes, answer keys and restricted originals.

Full details, including the custom `PI_DB_PATH` caveats, are in [backend/deploy/README.md](backend/deploy/README.md#full-private-backup-and-restore).

## Owner-only publication steps (not performed)

1. **Rehearse first.** Do a private two-user rehearsal locally, using the demo above.
2. **Tunnel.** Create a named Cloudflare Tunnel on the owner machine with a domain the owner controls.
   - Copy `backend/deploy/cloudflared.example.yml` to a private path. It routes **only** `/api/v1` and returns 404 for everything else.
   - Run `cloudflared ... ingress validate`/`ingress rule` exactly as the deploy README lists.
   - Create DNS and run the tunnel.
3. **Backend settings.** Set `PI_ALLOWED_ORIGINS=https://YOUR-USER.github.io` (origin only) and restart the API. Keep admin on local HTTP with `PI_COOKIE_SECURE=false`, and keep `PI_TRUST_PROXY_HEADERS=false` unless the owner accepts that trust boundary.
4. **GitHub Pages.** Set the repository Actions variable `VITE_PI_API_BASE=https://api.your-domain.example`. This is a public URL, not a secret. The workflow rejects a missing or non-HTTPS value. Publish only `app/dist/`.
5. **Verify publicly.**
   - Join, save and submit from the Pages origin.
   - A disallowed origin fails.
   - Public `/admin/` and `/api/admin/*` return 404.
   - Source originals are unreachable.
   - The PDF worker and Hindi fonts load under the subpath.

None of these public steps, nor any GitHub Actions run, was executed in this project.

## Known limitations (preserved)

- **Accessibility:** no automated axe run and no NVDA, VoiceOver or Orca test. There is no WCAG claim. The lobby countdown is not a live region.
- **OCR:**
  - Unnumbered Hindi needs manual crop correction against the original page.
  - Full-page OCR accuracy, RAM and wire bytes are not quantified.
  - Table and math OCR can be wrong even at high confidence.
  - Imported OCR is always needs-review with unverified keys.
- **Identity:** aliases are not verified identities, and there is no proctoring.
- **Single process:** rate limits are in memory, per IP and per process. A shared school IP may need a higher join limit. Run one uvicorn worker only.
- **Cutoff:** the cutoff grace (2 s by default) is a uniform server allowance checked under the write lock. It cannot prove a request was already in flight.
- **Public infrastructure** (domain, tunnel, HTTPS, Pages deployment) is unverified.
