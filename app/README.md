# Practice Institute

Practice Institute runs shared mock exams through a local FastAPI/SQLite backend and a static student frontend. Students join by code and alias; their resume secret authorises their own attempt. Admins upload originals, review English/Hindi text, verify keys, build papers, and manage results in a separate same-origin desk.

The optional **personal PDF practice** mode at `#/local` runs in the browser and stores its own bank/attempts on that device. It is separate from shared exams. The inherited PDF details below apply to that local mode.

## Start shared exams and the admin desk

```bash
# From app/
rtk npm ci
rtk npm run build:admin
# From backend/ (in another terminal)
rtk uv sync
rtk uv run pi-admin setup        # interactive owner setup, first run only
rtk uv run pi-admin serve        # loopback http://127.0.0.1:8787
# From app/
rtk npm run dev                  # student UI; VITE_PI_API_BASE defaults to loopback:8787
```

Open `http://127.0.0.1:8787/admin/` for the admin desk. Set `PI_ALLOWED_ORIGINS` to the exact student dev/preview origin (for example `http://localhost:5173`); configure it before starting the backend. Process environment variables are read directly; `.env` is not auto-loaded. Student API requests use Bearer auth without cookies. Admin API requests use an HttpOnly same-origin session plus a CSRF token held in page memory. Editors prepare questions/drafts; owners publish/release/close/extend exams. Releasing answers shows each student a review of only their assigned questions (correct answer, their answer, explanation) on the finished screen, even when scores stay unreleased.

For the student release build, set `VITE_PI_API_BASE` to the intended backend origin and run `rtk npm run build:pages`. `dist/` serves under `/practice-institute/`; `dist-admin/` is served separately by FastAPI under `/admin/`. The admin CSP allows only same-origin connections. API permissions remain enforced if someone downloads the static admin assets.

See [owner deployment and full recovery](../backend/deploy/README.md), [backend setup and tests](../backend/README.md), [API/design contract](../ARCHITECTURE.md), and [current checklist](../PROGRESS-task-practice-institute.md). Backend tests and admin browser tests use disposable databases. Production credentials must be created interactively; no defaults exist. There has been no public deployment or tunnel. The backend machine must stay online during exams; only server-acknowledged answers before the cutoff count.

## Admin OCR (English / Hindi / both)

Text-layer extraction runs first on upload. OCR is an explicit admin action for scans or legacy-font Hindi; it does not upload pixels to an inference service. Source originals are stored by the authenticated backend, while Tesseract runs in the admin browser.

```bash
# From app/, once after dependency install (explicit public model download)
rtk npm run assets:ocr:download   # ~5.24 MB raw; two pinned Apache-2.0 models
rtk npm run build:admin
# Restart the backend if this is its first admin build.
# Open Sources -> Run OCR scan; choose English, Hindi or both.
```

The downloader pins tessdata_fast revision `87416418657359cb625c412a48b6e1d6d41c29bd`, checks SHA-256, and refuses >16 MB per language or >32 MB total. Builds copy the locked Tesseract 7.0.0 runtime locally; they do not automatically fetch models. The browser checks both requested languages, shows availability versus browser cache and compressed size, and downloads only after Start. Bytes are streamed with a size cap, checksum verified, and cached in CacheStorage plus Tesseract's IndexedDB cache. All worker/model URLs use the configured build base. WASM CSP uses `wasm-unsafe-eval`, without enabling JavaScript `unsafe-eval`.

Each job accepts **1–20 distinct pages**, **1–2 concurrent pages**, and caps rendering at **8 megapixels**. Individual recognition has a 120-second timeout. Cancel stops downloads/rendering/worker startup/recognition; an import already acknowledged by the backend remains in the bank. Close/Escape and unmount cancel active work. The backend must be online to retrieve originals or save corrections; a browser cache does not make the whole admin desk offline-capable.

Imports always enter `needs-review`, carry `origin=ocr`, and do not verify keys. Confidence is not accuracy. Existing source question numbers are skipped to preserve edits; OCR does not silently replace previously extracted English or fill Hindi. Unnumbered Hindi blocks, assertion labels, formulas, two-column options and diagrams require manual matching. To correct an existing question, open **Crop & OCR correction**, use the four percentage controls or presets, compare the crop, run OCR, edit its output, and apply it to the desired draft field. Apply resets review/key verification; save explicitly and verify before publishing. Saved normalized crop geometry survives reload.

Reproduce actual measurements from app/:

```bash
rtk npm run benchmark:ocr        # Chromium-shaped original PNG fixtures + genuine Node WASM OCR
rtk proxy node scripts/make-ocr-fixture.mjs   # image-only synthetic PDF for browser tests
rtk proxy npx playwright test --config playwright.admin.config.ts
rtk proxy node scripts/ocr-real-smoke.mjs    # optional ignored local CTET fixture + Poppler
```

See [measured OCR report](../reports/ocr-benchmark.md), [actual model downloads](../reports/ocr-asset-download.json), [official-paper smoke summary](../reports/ocr-real-smoke.json), [UX specification](../reports/ocr-ux.md), and [optional Hugging Face evaluation](../reports/huggingface-eval.md). Synthetic images are deliberately small clean samples, not general exam accuracy. Official-paper text/crops remain ignored under fixtures/real and are never bundled. The HF evaluation is documentation/metadata only: no evaluated candidate establishes licensed, lightweight Hindi browser inference, so there is no HF provider or automatic model download.

## Personal PDF practice details

## Commands
Requires Node ≥ 22.13.

```bash
rtk proxy npm ci                 # locked install
rtk proxy npm run dev            # dev server (copies PDF.js cmaps/fonts/wasm into public/pdfjs first)
rtk proxy npm test               # unit + PDF.js extraction tests (vitest)
rtk proxy npm run typecheck      # tsc -b
rtk proxy npm run build          # relocatable production build -> dist/ (base './')
rtk proxy npm run build:pages    # build for https://<user>.github.io/practice-institute/ (BASE_PATH=/practice-institute/)
rtk proxy npx playwright test    # e2e against build:pages served at /practice-institute/
rtk proxy npm run fixtures:synthetic   # regenerate public/demo/pdf-smart-synthetic-demo.pdf
```

**Playwright browsers:** if the browsers aren't installed, run `rtk proxy npx playwright install chromium`. Alternatively, set `PW_CHROMIUM=/path/to/chrome` (the config also falls back to a cached `~/.cache/ms-playwright/chromium-*`).

## GitHub Pages deployment
The supplied workflow is a template; no remote repository or public deployment has been created.

1. Put the contents of `app/` at the repository root, including its hidden `.github/` directory. Keep `APP_DIR: .` in `.github/workflows/pages.yml`. If keeping this project in a subfolder instead, copy the workflow to the **repository root's** `.github/workflows/pages.yml` and set `APP_DIR` to the app's relative path (for this workspace layout, `task-practice-institute/app`). GitHub does not discover workflows nested inside app subfolders. Keep real fixtures, extraction reports and screenshots out of the deployed artifact.
2. In **Settings → Pages → Build and deployment → Source**, choose **GitHub Actions**. The workflow requires `pages: write`, `id-token: write` and the `github-pages` environment, as described in [GitHub's custom workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
3. Set the repository Actions variable `VITE_PI_API_BASE` to your public HTTPS API origin (no path or secret); the workflow validates and injects it into the student bundle and CSP. When ready to publish, push to `main` or manually run **Deploy to GitHub Pages** from Actions. It installs locked dependencies, runs unit tests, configures Pages, builds with `BASE_PATH=/<repository-name>/`, uploads only `dist/`, then deploys after the build succeeds. Typechecking runs inside the build. The workflow has not been exercised on GitHub in this task.
4. Open the deployment URL shown in Actions and verify the example upload, original-page preview, review, practice, timed exam and results. The local browser suite verifies this journey under `/practice-institute/`, including the PDF worker and support assets. A different repository name gets its base automatically in Actions. Custom-domain/root hosting needs `BASE_PATH=/` instead.

For a local release check, run the unit tests and `rtk proxy npx playwright test` (which builds and serves `/practice-institute/`), then `rtk proxy npm run build:pages`. Preview with `rtk proxy npm run preview -- --base /practice-institute/ --host 127.0.0.1 --port 4317` and open `http://127.0.0.1:4317/practice-institute/`. The built `dist/` uses `/practice-institute/`; do not open it via `file://`. For another project path use `rtk proxy env BASE_PATH=/your-repo/ npm run build`.

Routing is hash-based (`#/review`), so no `404.html` fallback is needed. The student production CSP allows its own origin and the exact configured API origin. Local PDF routes do not poll that backend.

## PDF.js configuration
- `pdfjs-dist` 6.4.299 is lazy-loaded the first time a PDF is opened (`src/lib/pdf/pdfjs.ts`).
- Vite emits the worker as a hashed asset via `pdf.worker.min.mjs?url`, so it resolves under any base path.
- `scripts/copy-pdfjs-assets.mjs` copies the CMaps, standard fonts, wasm decoders and ICC profiles to `public/pdfjs/`. They are addressed through `import.meta.env.BASE_URL`.
- XFA is disabled and PDF scripts are never executed. Extracted strings are rendered only as React text.

## Supported PDFs and limits
- **Limits:** up to 10 files, 40 MB each, and the first 200 pages of each file. Files are processed one at a time, page by page, and can be cancelled.
- **Text layer required:** PDFs need selectable text. Scanned or image-only PDFs are detected and flagged, and **OCR is not implemented**.
- **Legacy Hindi fonts:** Hindi set in fonts such as Kruti Dev or Chanakya (common in CTET papers) cannot be converted to Unicode. Those lines are hidden and reported. Hindi that is already Unicode is preserved.
- **Question detection:** the parser looks for numbered questions with `(1)–(4)`, `(A)–(D)`, `A.`/`A)` or `(a)–(d)` option labels.
  - It handles wrapped lines, two options per line, repeated headers and footers, numbered cover instructions, "Directions"/passage blocks and page breaks.
  - Identical repeated option sets are collapsed with an advisory bilingual warning; differing sets still require review. References inside option text such as “Both (1) and (3)” remain in that option. “Read the extract” passages and bounded question ranges keep passages attached only to their intended questions; the end-of-paper marker stops back-cover instructions being appended.
  - Unreadable punctuation-only options (for example, stacked fractions) require manual correction. Ordinary uses of “bar graph” or “picture stories” alone do not imply a missing figure.
  - Anything ambiguous is marked **Needs review** with reasons. Nothing is invented, and answers are never guessed.

## Review and saved banks
- Edit question text, passage and printed option labels; add/remove options (2–5). Canonical A–E keys remain stable. Saving for review keeps the item out of practice; **Save and accept** explicitly acknowledges parsing warnings after checking the source. Missing stems, empty options or fewer than two options cannot be accepted.
- Exclude/restore questions without deleting them. Add questions manually. Source labels and years are editable in the library and shown on each question.
- JSON uses `format: pdf-smart-question-bank`, `version: 1`. Import is atomic and validates fields, IDs, source/page references, option keys, answers and ready status. Limits: 10 MB, 5,000 questions, 500 sources. Imports append; colliding IDs are remapped. The compact source metadata from the initial version-1 export is also accepted.
- Duplicates across documents require matching NFC/lowercase/whitespace-normalized passage, stem, ordered option keys/text and answer key. Diagram questions, differing options, different passages and conflicting keys remain separate. A checked copy takes precedence. Copies are hidden from the default list and practice pool, remain inspectable in **Duplicates**, and are included in exports. Editing/excluding a copy recalculates the summary.
- The bank and source metadata are saved in **localStorage** (`pdf-smart-bank-v1`), with no PDF bytes, PDF.js handles or reader pages. This small bounded bank uses localStorage for simplicity; IndexedDB is not implemented. Quotas vary by browser and large banks can exceed them. Read/save failures stay visible, with retry and JSON export as a backup. Browser storage is not guaranteed durable: clearing site data, private browsing or another tab writing the same bank can remove/replace it.
- After reload or import, source previews and reader pages are unavailable until a PDF is opened again. Opening it creates a new source; duplicate review keeps matching questions out of the pool. PDFs are never restored from storage.
- **Clear saved bank** requires an in-app confirmation. It does not affect exported JSON files.

## Practice, exams and answer keys
- From Questions choose **Supply answer keys**, or **Set up practice**. Setup filters by selected files and optional year **before** eligibility/duplicate detection, so selecting a duplicate source alone still works. Only checked, non-excluded questions without blocking warnings are sampled, without replacement. A seed reproduces order for an unchanged pool; options retain their source order.
- Practice is untimed. Navigate, clear an answer and mark for later; supplied keys/explanations can be revealed. Missing answers and explanations are stated explicitly. Exam mode first shows instructions, then starts an absolute deadline (1–1,440 whole minutes). Leaving the page or backgrounding the tab does not pause time. Native radio cards support keyboard selection; numbered navigation exposes answered, unanswered and marked states in text. Mobile uses a question drawer.
- Opening the mobile drawer focuses **Close navigator**. Escape closes it and restores focus to **Questions**. Opening submit confirmation focuses **Keep answering**; Escape or that button closes it and restores focus to **Submit attempt**. Question navigation focuses the new question heading. Source lines avoid duplicate filename/label announcements and use `p. N` for a single page.
- Starting freezes deep question/source/key/explanation/marking snapshots. Later bank edits, imports, source removal or clearing the bank cannot change a saved attempt. Finish an active attempt before starting another. Early submission requires confirmation, locks answers, and cannot be undone.
- Attempts use separate localStorage (`pdf-smart-attempts-v1`), with at most 20 attempts and a 10 MB serialized bound. Answers, marks, current question, start/deadline and submission reason persist. Every event checks the deadline before changing answers; reload/focus/visibility changes reconcile expiry, with an idempotent final submission timestamp at the deadline. If the browser is closed, no code runs until reopening; reopening after the deadline immediately locks and submits the saved attempt. This is a personal study timer, not a secure/proctored exam clock. Use **one tab** for attempts; cross-tab merging is not implemented.
- Storage failures show retry and backup controls. Quotas can be smaller than the app’s bound. Keep the tab open if saving fails. Corrupt saved attempts are left intact until an explicit clear/start/retry action. Results offers a raw saved-copy export as well as exports of attempts still in memory. Browser data can be cleared/evicted and is not guaranteed durable.
- Answer-key templates use `format: pdf-smart-answer-key`, `version: 1`, `sourceId`, and `entries: [{questionId, number, key, explanation}]`. Download a template for the chosen source, fill canonical A–E keys (not printed labels), and import it. Both stable ID and printed Q number must match within that source. Repeated printed numbers require distinct IDs. `key: null` clears a key; omitted explanations retain the bank’s current explanation. Import validates the entire file (up to 1 MB) before applying any entry. Individual keys and explanations can also be edited manually. No official answers are inferred or verified.
- Results show attempted/unanswered counts, elapsed time, submission reason and frozen per-question provenance. Unkeyed questions remain **ungraded**, including answered ones. Partial keys are labelled **partially graded**. Correct/incorrect counts only use keyed questions. Numeric points appear only when keys and your optional marking scheme were supplied; setup has no claimed official scheme defaults. Custom point values can be negative, and unanswered points apply only to keyed questions.
- Export one result or all attempts as JSON, including snapshots, answers and grading details. Result JSON is an export/backup format; result re-import is not implemented. **Clear saved attempts** requires confirmation and leaves the bank intact; **Clear saved bank** leaves attempts intact. Exported files are unaffected by either control.

## Error fixtures
Small distributable synthetic fixtures are in `../fixtures/synthetic/`. Playwright regenerates the ignored sparse 41 MB bounds fixture automatically. To regenerate the image-only and password fixtures, see that folder's README; qpdf is only needed to regenerate encryption, not to run the app or tests. Password-protected files are rejected with instructions to remove the password locally; scans report that OCR is unavailable and suggest manual entry/import.

## Accessibility and verification
- At 320 CSS px the navigation wraps, the Library grid shrinks to available width, and labels/chips wrap. The header scrolls with the page at this width so it cannot cover sticky exam controls. Automated checks cover populated Library/Review pages, their editors, and a real-paper exam, including Submit after scrolling.
- A 200% root-font enlargement stress check covers Library, Review and practice, including radio selection and submit focus. This simulates enlarged text.
- Chromium's own font-size preference (a real profile with default font size 32px instead of 16px) was used for a full journey at 1280px: landing → example extraction → Review → timed exam → submit confirmation → results. There was no sideways scrolling and Submit remained visible after scrolling (`e2e/final-acceptance.spec.ts`). Sizes are rem-based, so this setting scales the app. Firefox/Safari text-only zoom was not run.
- Accessibility-tree audit: on Landing, Library, Review, the editor, Setup, Exam and Results, Chromium's accessibility tree (captured to `../reports/a11y/*.yaml`) has no unnamed buttons, links or fields. Each screen has a main landmark and a heading, and every visible field is labelled. Options form a "Your answer" group. The timer is `role="timer"` with live updates off, and a separate status region announces only at 10/5/1 minutes remaining. **No real screen reader (NVDA, VoiceOver or Orca) has been used yet.** That pass is still open.
- Browser error coverage includes mixed malformed/scanned/password/valid queues, multiple valid PDFs with duplicate review, invalid JSON, blocked reads, quota failures, retry recovery and saved answers after reload. Deadline tests cover reload before/after expiry, background expiry, exactly-once submission and locked results.
- Visual evidence: [320px Library](../screenshots/turn5/library-320-mobile.png), [320px Review editor](../screenshots/turn5/review-editor-320-mobile.png), [200% text practice](../screenshots/turn5/practice-text-200-desktop.png); real-paper journey images are under `../screenshots/turn4/`.

## Demo and real-paper provenance
- The bundled example `public/demo/pdf-smart-synthetic-demo.pdf` is an **original synthetic** paper generated by `scripts/make-synthetic-demo.mjs`. It is **not** a CTET or UGC NET paper.
- Real official CTET papers were used **only as local, git-ignored validation fixtures** (`../fixtures/real/PROVENANCE.md`). The CTET copyright policy requires CBSE permission to reproduce its material, so no real paper content is bundled.
- All three tested Paper I sets produce 150 four-option candidates: December 2024 Set H has 1 remaining review item, Set I has 1, and July 2024 Set A has 2. These are three unreadable fraction questions and one match-the-columns table, verified against their original pages. Counts are evidence for these fixtures, not a guarantee for arbitrary papers.
- To use real papers, download them yourself from https://ctet.nic.in/question-paper-dec-2024/ or https://ctet.nic.in/archive/ and upload them.

## Privacy
PDF bytes stay in memory in your tab; question text, metadata and attempt snapshots/answers are saved on this device. No user content is uploaded. App assets (including the lazy PDF engine) load from the app origin; full offline support is not claimed. Shared-exam routes also contact the configured API; admin source uploads are stored privately by the backend. These are separate from personal PDF practice.

## Licences
- **Practice Institute:** MIT.
- **pdfjs-dist:** Apache-2.0. The licence is copied to `public/pdfjs/LICENSE` at build time.
- **Fonts:** Fraunces, Source Sans 3 and Noto Sans Devanagari are all under the SIL Open Font License, via @fontsource.
- **React:** MIT.

- **tesseract.js / tesseract.js-core / idb-keyval / tessdata_fast eng+hin:** Apache-2.0. Runtime and model licence files are retained with local assets.


### Shared student acceptance (Turn 4)

From `app/`, run `rtk npm run assets:ocr:download`, `rtk npm run build:admin`, then
`rtk proxy npx playwright test --config playwright.student.config.ts`.
The suite builds production Pages assets at `/practice-institute/`, serves them on
4317, and starts a disposable real FastAPI/SQLite process on 8791. It uses two
isolated browser contexts for each desktop/mobile journey and kills/restarts only
its own process with the same temporary database. Never point this fixture at an
owner database. Production defaults and API secrets stay outside the student build.
The admin/OCR regression suite remains `rtk proxy npx playwright test --config playwright.admin.config.ts`.
For normal use, build admin first, then run `rtk uv run pi-admin serve` from `backend/`;
configure `VITE_PI_API_BASE` and `PI_ALLOWED_ORIGINS` for the student origin.

Independent exams can allow 1–10 attempts per saved identity. After finishing,
use “Try again” while availability is open; the resume secret authorizes the new
attempt. Cohorts allow one attempt. Aliases are not verified accounts and another
alias can enroll separately. Optional subsets have a required seed, no repeated
questions, stable selection on resume, and grading over assigned questions only.
Different subsets may differ in difficulty; leave ranks hidden unless appropriate.
Active students poll every five seconds to discover owner extensions/closures.
Unsaved changes remain visibly pending through disconnect/reload and are retried;
a closed attempt explicitly warns if changes never reached the server. The server
uses receipt time and its configured grace, never client timestamps, for cutoff.

### Turn 6 OCR and accessibility QA

`rtk npm run qa:real-ocr` runs an opt-in local check of the three hash-pinned official
CTET fixtures described in `../fixtures/real/PROVENANCE.md`. It performs actual
eng+hin OCR on pages 4 and 10 of each, checks the production admin importer, and
writes a content-free `../reports/turn6-real-ocr-qa.json`. Restricted page PNGs and
recognized text remain only in ignored `fixtures/real/`; they are never demo/build assets.
Poppler (`pdftoppm`) and the locally downloaded Tesseract languages are required.
This check deliberately fails when its optional local papers are absent; the normal
unit suite still skips absent real-paper fixtures.

Unnumbered Hindi cannot be reliably matched by question number. The importer keeps
English options separate and requires original-page crop correction for missing Hindi.
Different option-key sets and spatial OCR content (tables/figures) receive explicit
warnings. Confidence is not accuracy: table values and mathematical labels can be
missing even at high confidence. All extracted imports remain needs-review with no
inferred key.

The admin keyboard suite includes `admin-e2e/z-accessibility.spec.ts`: a 320px Tab-only
journey through login, editor, policy controls, publishing, table scrolling, CSV and
release. Wide tables are named keyboard-scrollable regions. Student phase headings
receive focus once, countdowns are not live announcements, and mobile exam status
stays in the document flow. `../reports/turn6-accessibility.md` records the documented
manual pass and its limits; no axe dependency or screen-reader certification is claimed.
