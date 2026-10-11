# Practice Institute — architecture, API contract and design system

Turn 1 (Claude), 2026-10-11. This is the contract later turns build on. Change it deliberately and note changes in the handoff.

## 1. Components

| Part | Where | Tech | Trust |
|---|---|---|---|
| Student frontend | `app/` → static `dist/` for GitHub Pages at `/practice-institute/` | Vite 8, React 19, TS, hash routing | Public. No secrets. API origin baked in at build (`VITE_PI_API_BASE`) and allowed in the CSP. |
| Local backend | `backend/` | FastAPI + SQLite (WAL), run with `uv`, bound to `127.0.0.1:8787` | The single authority for exams, attempts, deadlines, answers, grades and releases. |
| Admin UI | served by the backend, same origin (to build in turn 2) | Separate Vite bundle (`build:admin`) mounted by FastAPI under `/admin/`, calling `/api/admin/*` | Requires an authenticated session. A hidden link is not authorisation. |
| Personal PDF practice | `#/local`, `#/library`, `#/review`, … (inherited PDF Smart code) | Browser only, localStorage | Separately labelled. Never the shared-exam authority. |

The public deployment path is: GitHub Pages (frontend) → `https://api.<owner-domain>` → Cloudflare Tunnel → `127.0.0.1:8787`. It is **not started** in this run; turn 7 supplies the template.

## 2. Permission domains

- **Student API `/api/v1/*`**
  - Cross-origin access only for the exact origins in `PI_ALLOWED_ORIGINS`. CORS uses `allow_credentials=False`, only GET/POST, and only the `Authorization` and `Content-Type` headers.
  - A join code allows enrolment only.
  - Each attempt is authorised by a random 256-bit **resume secret**, returned once at join and sent as `Authorization: Bearer`. The server stores only its SHA-256.
  - An unknown attempt id and a wrong token both return the same 404.
- **Admin API `/api/admin/*`**
  - Same-origin only: any request whose `Origin` differs from the backend's own origin is rejected with 403.
  - Session: a 256-bit `pi_admin_session` cookie (HttpOnly, SameSite=Strict, Secure when `PI_COOKIE_SECURE=true`). It is stored hashed and expires after 8 h.
  - CSRF: every mutation needs `X-CSRF-Token` (per session, from `/login` or `/me`). That header is not in the CORS allowlist, so a cross-site page cannot even preflight it.
  - Passwords are hashed with argon2id (`argon2-cffi`), minimum 12 characters. The owner is created by the interactive `uv run pi-admin setup`. There are no default credentials.
  - Editors upload/review questions and create drafts. Only owners publish, release, close or extend exams.
  - Login uses a dummy-hash comparison for unknown users, a rate limit and an audit event on failure.
- **Global protections**
  - Requests over the body limit are rejected with 413 (`PI_MAX_BODY_BYTES`, 256 KB; the `/upload` routes use `PI_MAX_UPLOAD_BYTES`). Chunked bodies without a length get 411.
  - Every response is sent with `no-store`, `nosniff`, `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`.
  - OpenAPI and docs UI are disabled.

## 3. Time and fairness policy

- All times are UTC epoch milliseconds on the **server clock**. The UI shows local time plus explicit UTC (`formatWhen`).
- **Deadline:**
  - Cohort: `started_at = opens_at` (common start) and `deadline = min(opens_at + duration, closes_at)`.
  - Independent: `started_at = join time`, and the deadline is `min(join + duration, closes_at)`.
  - The deadline is stored on the attempt at join, so reloads and restarts cannot change it.
- **Cohort lobby / late join:**
  - Joining before `opens_at` puts the student in the lobby. Questions are withheld until the start.
  - Joining is refused after `opens_at + late_join_s` (default 600 s).
  - Late joiners still end at the common deadline.
- **Cutoff and grace:**
  - A save or first submit is accepted only if server time at the open check under the SQLite write lock is ≤ `deadline + PI_SUBMIT_GRACE_MS` (default 2000 ms). This is a uniform allowance; it cannot prove the request was already in flight. A request queued behind another write may miss cutoff even if it arrived earlier.
  - Client timestamps are never trusted. Nothing is accepted retroactively after the cutoff.
- **Expiry:**
  - A server-side sweeper thread (every `PI_EXPIRY_SWEEP_S`, 2 s) finalises expired attempts with no browser involvement.
  - Any access to an expired attempt also finalises it on the spot.
  - Finalisation is `UPDATE … WHERE status='active'`, so it happens exactly once, and `finished_at` is clamped to the deadline.
- **Outage policy (default):**
  - If the backend or tunnel is down, students see "Server unreachable" and keep answering locally (shown as *not yet saved*). Retries are automatic.
  - Only changes the server acknowledges before the cutoff count.
  - After a server outage, the owner may extend the exam *before* it closes. The owner extension endpoint adds time only to active attempts whose deadline has not passed; it never revives finished attempts. Late acceptance is never automatic.
  - The backend machine must stay awake and online for the whole exam window.
- **Randomisation:**
  - The cohort default is the same paper in the same order (`shuffle: fixed`).
  - With `per-attempt`, each attempt gets a question order seeded from its id. It is stable across reloads, and the answer keys move with the options because they are keyed by option key, not position.
  - Optional seeded subsets sample without replacement from the immutable published pool using SHA-256(seed + attempt ID). Selection/order is stored per attempt and survives reload/restart. Fixed order keeps snapshot order within a subset. Papers may differ in difficulty; the join screen explicitly discloses this. Grades, answer validation and released review use only assigned questions. Ranks should remain hidden when equal difficulty is not established.
- **Re-attempts:** cohort exams allow one attempt; independent exams allow an owner-configured 1–10 attempts within availability. The authenticated `/api/v1/attempts/{id}/reattempt` endpoint requires the latest finished attempt’s resume secret. A serialized transaction enforces identity/attempt number uniqueness and limits; unfinished attempts cannot be replaced. Migration 0003 preserves legacy alias/answer rows and adds an explicit identity key. Aliases are not verified people: a different alias can enroll separately, so this is a per-saved-identity limit, not proctoring or account enforcement. Lost secrets cannot be recovered with just a name.

## 4. Save protocol (idempotent, sequenced)

```
POST /api/v1/attempts/{id}/answers   {changes:[{qid, choice|null, marked, seq}]}
→ 200 {acked:{qid:seq}, last_seq, server_now, deadline_at}   | 409 closed/deadline | 422 bad qid/choice
```

- **Client side:**
  - Each edit takes the next `seq`. Only the newest change per question stays pending.
  - The client retries every 5 s while anything is pending.
  - Pending state is mirrored to localStorage (`practice-institute-pending-<id>`), so a reload re-sends edits that were never acknowledged.
- **Server side:**
  - The server applies a change only if `seq > stored seq` for that question. Replays and late duplicates are therefore no-ops.
  - Writes run in `BEGIN IMMEDIATE`, so parallel saves and submits for one attempt are serialised.
- **UI:** shows "N changes not yet saved" until the server acknowledges, and "All answers saved ✓" only after it does.
- **Submit:** `POST …/submit {changes}` applies the final changes and then finalises. Repeating it returns the same final state.

## 5. API contract (implemented in turn 1 unless marked *planned*)

Student (`Authorization: Bearer <resume secret>` where noted):

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/health` | `{status, service, api_version, server_now}` |
| GET | `/api/v1/time` | `{server_now}` |
| GET | `/api/v1/exams/{code}` | Public info for a published or closed exam: title, mode, schedule, duration, count, languages, marks. No questions. |
| POST | `/api/v1/exams/{code}/join` | `{alias}` → `{attempt_id, token, exam, started_at, deadline_at}`. Rate-limited. Returns 409 for a duplicate alias, a closed exam or late-join closed. |
| GET | `/api/v1/attempts/{id}` 🔒 | Phase `lobby` / `running` / `finished`. `questions` contains only stems and options in en/hi (no keys, explanations, bank ids or source internals), plus your own answers. |
| POST | `/api/v1/attempts/{id}/answers` 🔒 | See §4. |
| POST | `/api/v1/attempts/{id}/submit` 🔒 | Idempotent. |
| POST | `/api/v1/attempts/{id}/reattempt` | Resume-token protected; latest finished independent attempt only, within availability and configured limit. |
| GET | `/api/v1/attempts/{id}/result` 🔒 | Score only if `release_scores`; per-question key and explanation only if `release_answers`. Only ever this attempt, restricted to its assigned subset in the order the student saw. The student finished screen renders this as "Review answers" (outcome filter, key/your-answer tags, explanation or explicit absence, en/hi/both). |

Admin (session cookie, plus `X-CSRF-Token` on mutations):

| Method | Path | Notes |
|---|---|---|
| POST | `/api/admin/login`, `/api/admin/logout`; GET `/api/admin/me` | |
| POST, GET | `/api/admin/questions` | Bulk create (≤500) or list. OCR-origin questions cannot be created as `reviewed`. PATCH `/questions/{id}` requires the current `version`; edits bump it, and stale writes get 409. `key_verified` is explicit; imports stay needs-review. |
| POST, GET | `/api/admin/exams` | Create a draft or list exams. |
| POST | `/api/admin/exams/{id}/publish` | Requires that every question is `reviewed` and, for scored exams, has a verified key. Freezes an immutable snapshot with its SHA-256. |
| POST | `/api/admin/exams/{id}/release` | `{scores?, answers?, ranks?}` |
| GET | `/api/admin/exams/{id}/attempts` | Sweeps expired attempts first. |
| GET, POST | `/api/admin/sources`, `/api/admin/sources/upload` | Multipart PDF + label/provenance/consent; 40 MB / 200 pages defaults, sha256 dedupe. GET `/sources/{id}/file` is session-protected. |
| POST | `/api/admin/questions/sample` | Reviewed bank filters (source/year/subject/language), count, seed; sampling without replacement. |
| POST | `/api/admin/exams/{id}/close`, `/extend` | Owner only. Extend takes `{seconds}` before exam close; finished/expired attempts never reopen. |
| GET | `/api/admin/exams/{id}/export.csv`, `/stats` | Alias-only CSV (formula-escaped), finished-attempt question counts and tied ranks. |
| GET | `/api/v1/exams/{code}/ranks` | Public alias-only ranks only after owner release. |
| Browser-local | OCR scan/crop jobs | Turn 3: explicitly requested by authenticated admins; original download + needs-review question POST/PATCH reuse existing routes. Turn 4 subsets and authenticated independent reattempts operate on frozen snapshots. |

## 6. Data model

`backend/practice_institute/migrations/0001_init.sql`: `admins`, `admin_sessions`, `sources`, `questions`, `exams`, `attempts`, `answers`, `audit_events`, `schema_migrations`.

- **Bilingual questions:** stored as parallel original `*_en` / `*_hi` columns. Options are `[{key, en, hi}]`. NULL means the text is not in the source. Nothing is machine-translated or labelled original.
- **Question status:** `needs-review | reviewed | excluded`.
- **Question origin:** `manual | text-layer | ocr | import`.
- **Migrations:** forward-only numbered SQL files, applied at startup or by `pi-admin migrate`.

## 7. Design system (Product Designer)

The app keeps the inherited **"Paper & Ink"** tokens (`app/src/styles/tokens.css`), whose contrast was measured in the PDF Smart baseline. Shared-exam components are in `app/src/styles/institute.css`.

- **Tone:** a calm, warm, paper-like look. It is meant to read as a study desk rather than a proctoring system.
- **Trust signals are explicit:**
  - a connection pill in the header (Connecting / Server connected / Server unreachable, with text and not colour alone)
  - a save state ("N changes not yet saved" in amber vs "All answers saved ✓" in sage)
  - the timer, which turns danger-coloured under 1 minute.
- **Student flow:** `#/` Home (join by code, resume list, explanation of the local mode) → `#/join/CODE` (exam facts in local time + UTC, instructions, display-name field) → `#/exam/ID`:
  - **Lobby:** big countdown.
  - **Running:** a sticky status bar (timer, save state, answered count, English / हिन्दी / Both toggle) above a question card and a navigator grid. Navigator cells show answered (fill), marked (dot) and saving (dashed border).
  - **Confirm submit:** an alertdialog with counts and pending changes.
  - **Finished:** the result if released, otherwise a "results appear when released" message.
- **Bilingual rendering:**
  - "Both" shows English, then Hindi below it in Noto Sans Devanagari at line-height 1.8.
  - When a language is missing from the source, the available original is shown with a small note (for example "Hindi version not in source"). Nothing is ever auto-translated.
- **Accessibility:**
  - real radio inputs inside a `fieldset`/`legend`
  - a 44 px minimum target
  - a visible 3 px focus outline on options
  - `aria-live` for save and connection status
  - `aria-pressed` on the language toggle
  - navigator buttons with full labels (for example "Question 3, answered, marked for review, saving")
  - reduced motion through the tokens
- **Mobile (≤860 px):** a single column with the navigator below the question. The status bar stays sticky and wraps.
- **Admin (turn 2):**
  - **Layout:** the same tokens with a denser layout — a left rail (Dashboard, Sources, Question bank, Exams, Results) and a main table or detail area.
  - **Review screen:** side-by-side source crop | English | Hindi editors, with status chips (needs-review amber, reviewed sage, excluded grey) and warnings listed inline. Publishing is disabled until the checks pass, and the button explains why.


## 8. Turn 2 implementation notes

The admin entry lives in `app/admin/index.html` and `app/src/admin/`; build with
`rtk npm run build:admin`, then start the backend. Its CSP allows same-origin
connections only. Build output is `app/dist-admin/`, distinct from the student Pages
bundle. API endpoints enforce authorisation independently of static assets.

Sources have a consent flag; question keys have a verification flag (migration
0002). Existing v1 manual reviewed keys retain verification for compatibility.
All non-manual imports must enter needs-review. Duplicate source files return their existing id; duplicate source/question-number
imports return 409; the browser retry skips already imported numbers. Review uses
full-page PDF.js canvas previews; Turn 3 adds normalized crop selection, OCR and draft correction.
Admin import parses separate original-script streams before pairing; inline mixed-script
blocks remain preserved and flagged for manual separation. The local PDF routes no longer poll the backend; mobile nav wraps, with a static
header so sticky attempt controls and touch targets remain reachable.

## 9. Turn 3 OCR implementation notes (Codex replacement)

Admin OCR uses locked Tesseract.js 7.0.0 with pinned tessdata_fast eng/hin assets. Explicit downloader + browser Start authorize asset transfer; no external inference receives source data. Assets are served at the configured build base, streamed with a 16 MB per-language cap and SHA-256 checks, then cached locally. Runtime auto-selects plain/SIMD/relaxed-SIMD LSTM; all shipped variants are copied. CSP allows WASM compilation via `wasm-unsafe-eval`, not JavaScript eval.

Jobs process 1–20 distinct pages with 1–2 concurrent renders and an 8 MP/page ceiling. A dedicated host worker owns Tesseract's nested worker so cancel/timeout/unmount stops initialization as well as recognition. Cancelled jobs do not import pending candidates; acknowledged imports remain stored. PDF resources are destroyed in finally paths.

OCR candidates carry origin=ocr, needs-review, unverified keys, confidence and pairing warnings. Existing source numbers are skipped. Normalized page/x/y/w/h crops are bounded in UI and validated by the API (≤500-character JSON); crop correction clears draft review/key verification. Unnumbered Hindi and multi-column options require human matching. No translations or answer keys are generated.

Exact benchmark/download evidence, synthetic retained fixtures and metadata-only HF evaluation are in reports/ and fixtures/ocr/. Real CTET source/text/crops remain private fixtures/real; the smoke summary does not claim measured full-page accuracy. The optional HF provider is absent because evaluated candidates lack verified Hindi/license/browser support or exceed the ≤250 MB download cap.

Turn 4 results policy: rank each saved identity once using its best completed score (equal scores tie). Per-question stats count only attempts assigned that question; absence from a subset is never counted as unanswered. Admin attempt table/CSV include attempt numbers.
