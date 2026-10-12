# Practice Institute — delivery

## Final delivery status (Turn 8, Claude) — 2026-10-12

**What the owner gets** (local, ignored `release/`, unsigned, nothing published):

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `Practice-Institute-Setup-0.1.0-x64.exe` (Windows 10/11 x64, per-user NSIS, no elevation) | 158228841 | `e23ccd7c5f84440b9544ca982b930b2d553b7308a09951d0768c237bf825f4be` |
| `practice-institute_0.1.0_amd64.deb` (Ubuntu 22.04 / Debian 12 target) | 176921612 | `32c5cc0529d9d42451cd595f9a8eb7a54dff19c9b07e7ce394317fb6e028b13c` |

Both bundle Python 3.12.10, the FastAPI backend, the admin build and cloudflared 2025.4.0
behind an Electron launcher with first-run owner setup, Start/Stop, status, keep-awake,
backup/restore, tunnel import/verify and Help. Data lives in per-user OS folders and is kept
on upgrade/uninstall. Owner instructions: [docs/OWNER-GUIDE.md](docs/OWNER-GUIDE.md).
Developer/rebuild steps: [packaging/README.md](packaging/README.md), [PACKAGING.md](PACKAGING.md).

**Final checks re-run this turn on the unchanged tree** (no packaged code changed after
the Turn 7 build; `diff -rq` of `backend/practice_institute` against the packaged
`release/linux-unpacked/resources/runtime/app/practice_institute` is empty, and no file
under `backend/practice_institute`, `desktop/src`, `desktop/electron-builder.yml` or `app/src`
is newer than the `.deb`):

| Command | Result |
| --- | --- |
| `release/`: `rtk proxy sha256sum --check SHA256SUMS` | `.exe`, `.deb`, `manifest.json` **OK** |
| `backend/`: `rtk proxy .venv/bin/python -m pytest -q` | **116 passed**, 1 inherited Starlette warning |
| `desktop/`: `rtk proxy npx vitest run`; `rtk proxy npx tsc --noEmit -p .` | **91 passed**; tsc clean |
| `app/`: `rtk proxy npx vitest run` | **83 passed / 3 skipped** (bulk review, select-all preserved) |
| `app/`: `rtk proxy npx playwright test -c playwright.packaged.config.ts` (built linux-unpacked runtime) | **4 passed (1.7 min)**: owner upload/bulk review/select-all/publish, two isolated students, restart/timeout/release/full recovery, gateway/CORS/encoded-path, raw target + Host guard, CF-IP identity |
| Root: `rtk proxy node --test packaging/tests/audit-public.test.mjs` | **21 passed** |

The installed-`.deb` Playwright run, Ubuntu apt install/0.1.0→0.1.1 upgrade/purge, installed
GUI first run, fuses, WM_CLASS and Wine checks are Turn 7 measurements (below). They were
**not** repeated this turn.

**Doc-only change this turn:** owner guide now has the per-user/no-admin install note, a
checksum check, unsigned-installer SmartScreen wording (marked unverified on native
Windows) and a "Before every real exam" checklist. The guide is not packaged, so no rebuild
was needed. The guide's control labels were cross-checked against `desktop/src/renderer/app.ts`/`copy.ts`.

**Owner-only steps still to do** (guide §7; nothing done here): choose the Cloudflare account,
`<your-domain>`, `<tunnel-name>`, `<your-repository>`. Then a setup helper creates a locally
managed named tunnel + `<tunnel-id>.json` and DNS for `api.<your-domain>`, and the owner enters
hostname/origin in Setup and imports credentials in Tunnel. Next, the helper creates the
repository, pushes the audited sources, sets Pages source to GitHub Actions and
`VITE_PI_API_BASE=https://api.<your-domain>`, and manually dispatches `.github/workflows/pages.yml`.
Finally, Verify and a two-browser rehearsal.

**Not verified (must not be relabelled as passing):** native Windows 10/11 install, GUI,
SmartScreen, ACLs, shortcuts and uninstall (Wine/extraction only). Also unverified: the
production OS sandbox (container runs use `--no-sandbox`), native quit/tray interaction,
screen-reader/axe accessibility, Debian (only Ubuntu 22.04 installed), real Cloudflare
tunnel/DNS/HTTPS, and GitHub Pages publication. The owner has not yet reviewed the guide.
No code signing. The Turn 2 `npm audit` moderate findings in the dev-only builder chain
were not re-checked. Nothing staged, committed, pushed or published.

## Turn 7 (Codex) — installer refresh and adversarial verification — 2026-10-12

This turn rebuilt both runtime payloads and both 0.1.0 installers with Turn 5/6 fixes,
Electron fuses and staged-restore revalidation. Work remains local and uncommitted.
Native Windows and public deployment are still unperformed. Measured checks, Linux rehearsal results and remaining limits are recorded below.

Measured unit, browser and artifact checks:

- Backend: `rtk proxy .venv/bin/python -m pytest -q --basetemp=/tmp/pi-turn7-backend`
  → **116 passed**, one inherited Starlette httpx deprecation warning. Two added
  tests mutate a valid database or insert a source symlink between checking/copying;
  both fail before live-data replacement. A preliminary assertion used a parent-wide
  glob and was corrected to this fixture's profile name before the passing run.
- Desktop: `rtk npm test` → **91 passed**; `rtk proxy npx tsc --noEmit -p .` clean.
  Development Electron smoke passed real setup, IPC rejection, readiness, keep-awake,
  full recovery/restart/stop and secret-log checks. This is development inspection,
  not installed GUI proof. Packaged CLI inspection is intentionally disabled; the
  old `smoke-electron.mjs --packaged` command now explains the installed alternative.
- App: `rtk npm test` → **83 passed / 3 skipped**, preserving bulk review/select-all.
- Rebuilt `release/linux-unpacked` packaged Playwright suite → **4 passed (1.7 min)**.
  The existing owner upload/review/select-all/publish/two-browser/restart/timeout/
  release/recovery flow stays green. Added tests preserve raw request-target bytes,
  reject DNS-rebinding Host values, and measure student CF-IP limits (same-IP 429,
  distinct IPv4/IPv6 201, invalid-header peer fallback, owner cannot use CF identity).
- Both packaged binary fuse wires audited: RunAsNode, NODE_OPTIONS and CLI inspector
  disabled. Reference: [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses).
- Windows: pinned scoped Wine build produced actual unsigned NSIS x64-payload installer;
  fresh installer extraction matches **every** release-manifest Windows payload hash.
  PE architecture, bootstrap signing absence and isolated Python `_pth` passed.
  Offline pinned Wine bundled-backend smoke passed Unicode profile/stdin credentials,
  migrations, both listeners, public boundaries, login, stop and full recovery.
  Wine is explicitly **not native Windows 10/11 installer/GUI verification**.
- Release hash/manifest checks pass. 0.1.0 artifacts:
  - `Practice-Institute-Setup-0.1.0-x64.exe`: **158,228,841 bytes**;
    SHA256 `e23ccd7c5f84440b9544ca982b930b2d553b7308a09951d0768c237bf825f4be`.
  - `practice-institute_0.1.0_amd64.deb`: **176,921,612 bytes**;
    SHA256 `32c5cc0529d9d42451cd595f9a8eb7a54dff19c9b07e7ce394317fb6e028b13c`.
  - Fresh runtime licenses/manifests plus Electron/Chromium notices: **119 Windows /
    141 Linux files in the license/notice inventory**. GLIBC audit: **14 ELF files**, max requirement **2.25**;
    supported target remains Ubuntu 22.04 / Debian 12, not a broader compatibility claim.
- Public audit: **21 tests passed**, **237 source paths / 247 manifest-bound student
  files** pass. Student build uses a reserved HTTPS placeholder, not a real deployment.
  Staged audit: **0 staged paths**. No staging, commit, remote upload or publication.
- Sandboxed socket/child-process/network restrictions blocked preliminary local runs;
  successful measured suites/builds used reviewed escalations. A redundant sandboxed
  pytest process was stopped by its confirmed PID; no unrelated process was stopped.

Installed rehearsal fixture corrections (not application defects):

- Initial Xvfb input needed explicit keyboard focus. The live password hint also
  moves the submit button, so the fixture now submits by keyboard from confirmation.
  The subsequent fresh installed GUI run created the owner through the real forms,
  authenticated that generated password, restarted and passed Start/Stop, WM_CLASS
  and hostile RunAsNode/NODE_OPTIONS/inspect checks.
- An initial installed browser run passed the two HTTP-only boundary tests but could
  not launch the missing Playwright browser revision 1248. The fixture now explicitly
  uses the same cached full **Chrome for Testing 153.0.8010.12 (revision 1243)** that
  the host configuration fell back to. It does not download or substitute an owner
  runtime. The rate-limit test now seeds its own exam; its first independent fixture
  omitted required opens/closes fields (422), which were added before the final run.

Scope of evidence: S1 unexpected tunnel shutdown and S2 restored-with-failed-restart
branches are covered by desktop unit/renderer tests and included in the rebuilt ASAR.
The live installed GUI rehearsal covers normal setup/start/stop/relaunch; no public
or real configured Cloudflare tunnel was activated. Public HTTPS/DNS/Pages behavior,
Windows native GUI/ACL/SmartScreen, desktop screen-reader use and production OS sandbox
execution remain unperformed. The 0.1.1 Linux fixture changes package version with the
same runtime; it verifies package-manager upgrade/persistence, not a future migration.

Installed Ubuntu 22.04 rehearsal: **PASS, container exit 0**. Command and mounts are
reproducible in `packaging/README.md`; no host installation was performed.

- Real apt install of release 0.1.0. Non-root installed GUI created the owner through
  the account form, saved optional blank website settings through **Save and continue**,
  and the generated credentials authenticated. Relaunch + GUI Start/Stop passed.
- Hostile `ELECTRON_RUN_AS_NODE=1`, `NODE_OPTIONS=--require=<synthetic hook>` and
  `--inspect=127.0.0.1:19229` still opened the normal installed GUI; no hook marker and
  no listening inspector. The same checks passed again after the version upgrade.
- Actual `xprop WM_CLASS`: **"practice-institute", "practice-institute"**, matching
  installed `.desktop` **StartupWMClass=practice-institute**. Installed Comment:
  **Private exam server and owner launcher**, matching `linux.description`, the entry
  definition and the fixture. Actual installed desktop-entry audit passed all fields.
- Installed release 0.1.0 runtime (`PI_PACKAGED_ROOT=/opt/Practice Institute/resources/runtime`):
  **4 Playwright tests passed (1.7 min)**, same journey/adversarial coverage as unpacked.
- A separately built ignored 0.1.1 package exercised a real apt **0.1.0→0.1.1 upgrade**.
  `dpkg-query` confirmed 0.1.1; installed GUI relaunched and Start/Stop/owner-status passed.
  SHA-256 of **both database and saved config.json** matched the pre-upgrade snapshot.
- Real apt purge then preserved both files and their SHA-256 hashes. Owner/config/data
  were synthetic and container-local. The default/deferred profile initially had no
  config.json, so the final fixture deliberately saved optional blank settings through
  the GUI before hashing; no developer-written configuration substituted for the UI.
- Evidence: `.cache/linux-install/{apt-install.log,packaged-installed.log,apt-upgrade.log,
  apt-uninstall.log,installed.desktop,installed-first-run-wm-class.txt,
  installed-home-wm-class.txt,owner-after-upgrade.json,profile-before-upgrade.sha256}`
  and fresh first-run/website/Home/Running screenshots. Tests/renderer use **--no-sandbox**
  due to Docker namespace restrictions; shipping Exec never includes that flag.
  This is a real container apt/GUI rehearsal, not a native Windows or full clean desktop
  OS sandbox test. Native quit/tray interaction and screen-reader checks are unperformed.

Owner/deploy guides now use the real installer names and controls, distinguish Connected
from Verified, and explain the locally managed JSON credentials/setup-helper requirement.
Both listeners explicitly bind 127.0.0.1 with uvicorn proxy processing off. Any local
process can spoof the public CF-IP rate-limit header; this trusted-laptop assumption is
documented without changing authentication or widening public routes. Owner account,
domain, DNS, repository and publishing details remain placeholders. Guide is still an
owner-review draft. No public tunnel/Pages activation, Git remote action, staging or commit.

## Laptop packaging Turn 5 (Claude: packaged acceptance + trust boundary) — 2026-10-12

**Packaged owner + two-student acceptance (measured).** New `app/packaged-e2e/packaged-journey.spec.ts`
(`app/playwright.packaged.config.ts`) launches the BUILT Turn 4 runtime
`release/linux-unpacked/resources/runtime` the way the launcher does: `-I -B -X utf8`, env allowlist,
`serve-desktop --stdin-control`, owner 8797 / public 8798. The profile is a disposable Unicode path,
and the owner is created through `setup-owner --stdin-json` with a Unicode password. The student
Pages build is served on 4327 with `VITE_PI_API_BASE` set to the public gateway. Port 4317 was taken
by another project's preview server, which was left running.
Run: `cd app && rtk proxy npx playwright test -c playwright.packaged.config.ts` → **2 passed (1.6 min)**:
- Owner admin UI (served from packaged `PI_ADMIN_DIST`): login, synthetic PDF upload and extraction (12 candidates), **bulk review** (select all matching → acknowledgement → 4 reviewed, keys preserved, other candidates untouched), **exam builder select-all** (Subject filter, 4 of 4), scored draft, publish.
- Two isolated student browser contexts join through the gateway. Answers stay isolated; another student's token gets 404; `/api/admin/*` through the gateway gets 404; no answer keys reach students.
- Managed `stop` mid-exam (`ready → stopping → stopped`, exit 0). An unsaved student edit survives and syncs after `start`.
- Student A submits. Student B expires server-side (1-minute duration), then sees "Time is up" after reload. The owner session survives the restart; the owner sees both attempts and releases scores in the UI. Results: A "2 correct · 0 wrong · 2 unanswered of 4", B "1 correct · 0 wrong · 3 unanswered of 4".
- A second runtime on the same profile exits with code 4 (`already-running`).
- `backup --full` with the runtime stopped, a post-backup join, then `restore --full` (prints "previous data kept at"), restart, and a fresh owner login. The attempts match the backup and the post-backup change is gone.
- Gateway: admin, static and encoded/dot/NUL/empty-segment paths and PUT/DELETE/PATCH all return 404. CORS allows only the configured origin. The owner listener rejects cross-origin admin requests (403) and serves `/admin/`.
- Screenshots: `screenshots/packaged/` (now gitignored, along with `reports/`).

**Latent test defect fixed.** The admin bulk-review Playwright test had never run: an earlier turn hit EPERM. It used `getByLabel('Status', {exact:true})`, but a `<select>` wrapped in its `<label>` has the accessible name "Status All statuses", so it could never match. The selectors now use role plus a name prefix. `rtk proxy npx playwright test -c playwright.admin.config.ts admin-e2e/admin.spec.ts` → **5 passed, 1 skipped** (desktop and mobile bulk review included). The UI was not changed.

**Trust-boundary review.** No critical or high findings. Fixed this turn:
- DNS rebinding on the owner listener: new `OwnerHostGuard` (`backend/practice_institute/gateway.py`), wired in `desktop.py`. Only `127.0.0.1:<ownerPort>` and `localhost:<ownerPort>` Host headers reach the app; everything else gets a bare 404. +9 tests in `backend/tests/test_gateway.py`.
- Windows AppUserModelID is now set to the electron-builder `appId` (`APP_USER_MODEL_ID` in `desktop/src/main/paths.ts`), with a test. `second-instance` now restores a minimized window.
- `backend/deploy/README.md` warns desktop owners never to tunnel the owner port and points to the 8788 template.

Open, handed to later turns:
- All tunnelled students share one rate-limit identity (127.0.0.1) when `trustProxyHeaders=false`.
- A runtime crash leaves the tunnel running.
- A restore whose restart fails is reported as failed.
- Linux WM_CLASS vs `StartupWMClass` is unverified.
- No Electron fuses.
- The restore check and the copy are not atomic (trusted-bundle assumption).

**Checks:** backend **110 passed**. Desktop vitest **87 passed**, `tsc --noEmit` clean.

**Not done:** the installers were **not rebuilt**. The Host guard and AppUserModelID changes are not yet inside `release/*`; Turn 7 must rebuild and regenerate SHA256SUMS and the manifest. The packaged acceptance ran on Linux unpacked only, not on Windows, and only in the desktop viewport.

## Laptop packaging Turn 4 (Codex P1–P5) — 2026-10-12

Actual Windows NSIS and Linux Debian installers were built locally. The Windows build
uses `electronuserland/builder:wine@sha256:41ae540902461b6cbc988987db79547fcc10cda04d2a6c6367504f59d4b37c64`
with only the repository mounted; all builds pass `--publish never`. Native Windows
10/11 installation/GUI verification is still **unperformed**. No files were staged,
committed, pushed or published; no real profile, account/domain or public tunnel was used.

Files in ignored `release/`: `Practice-Institute-Setup-0.1.0-x64.exe`,
`practice-institute_0.1.0_amd64.deb`, `SHA256SUMS`, `manifest.json`. The manifest records
exact sizes/hashes, every unpacked resource, runtime pin/wheel information, license lists
and ELF symbol evidence. Rebuilds require regenerating it. The owner installer has no
Authenticode certificate; builder's generic "signing with signtool" messages do not prove
signing. Structural audit confirmed an unsigned x86 NSIS bootstrap containing the x64
launcher/Python/cloudflared payload. This is artifact evidence, not native Windows proof.

Icons are now explicit installer resources, window and tray use the packaged icon, and
the actual installed Linux desktop entry matches the fixture's seven functional fields.
The `.deb` metadata uses a reserved `https://practice-institute.invalid` homepage and
an explicitly local-build maintainer string because no owner contact was supplied.
No fictitious account, publisher or real website was substituted.

The installed Ubuntu rehearsal found an owner-status initialization race: the first
renderer snapshot could contain placeholder `ownerExists=false`, causing an existing
owner to see onboarding Step 2 at every start. `getState` now waits for initialization
to finish before choosing the initial screen. IPC types/channels and renderer's
`window.pi` boundary are unchanged. A regression test covers the withheld snapshot.

| Measured command/check | Result |
| --- | --- |
| `desktop/`: `rtk npm run build` (also run through `build-linux.sh`) | Strict tsc and bundles passed |
| `desktop/`: `rtk proxy npm test` with local loopback allowed | **86 passed**, 5 test files |
| `backend/`: `rtk proxy uv run pytest -q` | **101 passed**, one existing FastAPI/Starlette deprecation warning |
| `app/`: `rtk npm test` | **83 passed, 3 skipped** |
| Windows pinned `docker run … node node_modules/electron-builder/cli.js --win nsis --x64 --publish never` (command in `build-windows.sh`) | Actual `.exe` built; repeated after startup fix. Wrapper syntax checked; Docker command executed directly against already compiled dist |
| `rtk proxy bash packaging/scripts/build-linux.sh` | Actual `.deb` built; repeated after startup fix |
| `desktop/`: `rtk proxy xvfb-run -a node scripts/smoke-electron.mjs --packaged` after startup fix | Unpacked IPC/preload/preferences, Unicode owner password, real readiness, keep-awake, validation, full backup/restore/restart and stopped process passed. Playwright adds `--no-sandbox` |
| `desktop/`: `rtk proxy xvfb-run -a node scripts/screenshots.mjs` | 10 refreshed synthetic screenshots; inspected Setup, Tunnel and corrected Restore. The script now polls typed state with a bound and reliably tears down a failed run |
| Pinned Wine container, `--network none`, installed-payload `python.exe -I -B -X utf8 …windows-runtime-smoke.py` | Real Windows backend imports/SQLite, Unicode profile/stdin password, dual listeners, health, forbidden/encoded public routes, login, owned stop and full recovery passed. **Wine, not native Windows** |
| `rtk proxy node --test --test-reporter=spec packaging/tests/audit-public.test.mjs` | **21 passed**, including disposable Git index/worktree and symlink checks |
| `rtk proxy node packaging/scripts/public-manifest.mjs` + `audit-public.mjs` | **247** student files bound to reviewed policy; tracked + nonignored new source scanned. Staged variant passed with **0 staged files**; no index changes |
| `app/`: placeholder HTTPS API build + `npm run check:student-build` with `/practice-institute/` base | 247 files; CSP, worker/asset paths and private-route checks passed |
| `rtk proxy bash packaging/scripts/check-ingress.sh packaging/output/runtime-linux/cloudflared/cloudflared` | Bundled **2025.4.0** offline validator and 7 ingress-rule cases passed; no tunnel started |
| `release-manifest.mjs` + NSIS extraction + `check-artifacts.py` | Final rebuilt installer checksums, all 1102 embedded Windows payload file hashes, x64 PE files, isolated `_pth`, notices and real installed desktop fields passed |
| Pinned Ubuntu 22.04 container: `bash /test-scripts/linux-install-container.sh` (full scoped Docker command in `packaging/README.md`) | **Real apt installation passed**, non-root installed GUI first-run screen, GUI Start/Stop, both health probes, public admin 404, same-version apt reinstall preserved owner, apt purge preserved SQLite/data and config. No host install; `--no-sandbox` test flag |
| Root Pages YAML parsed locally | Manual dispatch only, `APP_DIR=app`, upload only `app/dist`; **no Actions run or Pages publication** |

Public audit deliberately fails closed. The checked-in policy pins PDF/OCR/font/ICC/CMap
assets and synthetic-demo bytes, with individual benign long-token hashes for React/PDF.js.
Generated HTML/JS/CSS has narrowly named paths and private marker checks. Manifest edits
cannot grant opaque-file or token exemptions. The source audit rejects private-data/key/
environment paths, recognizable credential contents and symlinks, and the index audit
checks staged bytes. This cannot prove absence of every arbitrary secret; review remains
required before any owner-authorized future publication. See `packaging/README.md`.

Final artifacts after the startup fix:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `Practice-Institute-Setup-0.1.0-x64.exe` | 158227925 | `411f731a14f718779c4705313c33869e64923282fd54cac2eb63193f8b6865b5` |
| `practice-institute_0.1.0_amd64.deb` | 176919616 | `087bec23461e7201001dcd408e2301c631d14812e35a4f0f2c8fa6c07daad6e3` |

`rtk proxy sha256sum --check SHA256SUMS` from `release/` passed for both installers and
`manifest.json`. The final NSIS payload was re-extracted and all 1102 files matched the
final manifest. ELF audit measured maximum `GLIBC_2.25` over 14 ELF files, including static
cloudflared detection; runtime wheel target stays conservatively `manylinux_2_28`. No
older-distro support is claimed. License inventory: 119 Windows and 141 Linux notice files,
including Electron/Chromium and bundled runtime/admin dependencies.

Ubuntu image: `ubuntu:22.04@sha256:5ec03bb3441e8b0bf3b4f9cd4629a1ae763010dc3035bb8da3ae6cf026486401`.
This fixture captures the installed first-run window, seeds a synthetic owner using the
installed bundled CLI as test instrumentation, then restarts the GUI and clicks Start/
Stop. It does **not** prove typing the account form in the installed GUI. No Node, system
Python, uv or pip was needed by the installed app. Inspected `installed-running.png`
shows Running, the keep-awake banner and enabled Stop/Open admin. Reinstall was the same
0.1.0 artifact, **not a different-version upgrade**. Results are in ignored
`.cache/linux-install/{apt-install,apt-reinstall,apt-uninstall}.log`, `installed.desktop`,
`owner-after-reinstall.json` and screenshots. The Docker namespace probe's `unshare`
failure is recorded; production OS sandbox remains unverified.

Earlier failed attempts were corrected and rerun: sandbox loopback blocked one desktop
test (rerun with permission passed); `.deb` needed explicit local package metadata;
screenshot/GUI fixture teardown could hang on native close; the Wine harness incorrectly
parsed recovery's existing text output as JSON; and positional installed-GUI input needed
to wait for readiness/layout before clicking Stop. The actual product startup race found
by installation was fixed in IPC and both final installers rebuilt afterward.

Remaining work: packaged owner plus two independent student browsers,
native Windows 10/11 installer/GUI/ACL/shortcuts, production OS sandbox, native quit/tray,
different-version Linux upgrade, Debian install and screen-reader/accessibility checks.
Docker GUI tests explicitly disable the OS sandbox and force-close only stopped fixture
launchers during teardown. These limits must not be relabelled native acceptance.

## Laptop packaging Turn 3 (Sonnet U1–U4) — 2026-10-12

Implemented the guided owner renderer (`desktop/src/renderer/{app,copy,dom,renderer}.ts`,
`index.html`, `style.css`), icons (`desktop/build/icon.{png,ico}` via `scripts/make-icons.py`),
a Linux `.desktop` fixture and screenshots script. Only `window.pi` is used; IPC contract,
main/preload, gateway and recovery were not touched. jsdom 30.1.2 added as exact dev dependency.

| Check (from `desktop/` unless noted) | Result |
| --- | --- |
| `rtk npm run build` | tsc strict + bundles passed |
| `rtk npm test` | **85 passed**, 5 files (39 prior + 41 renderer + 5 asset/desktop-entry) |
| `rtk proxy xvfb-run -a node scripts/smoke-electron.mjs` | development IPC smoke passed (run before the final CSS-only change) |
| `rtk proxy xvfb-run -a node scripts/screenshots.mjs` | 10 screenshots in ignored `.cache/screenshots/` (synthetic temp profile, removed after run); viewed 02, 05, 09 |
| `backend/`: pytest | 101 passed |
| `app/`: `rtk npm test` | 83 passed, 3 skipped |

Not done / limits: no native-close dialog UI exists in the renderer (native `dialog` in main).
No separate "Validate" action exists in the IPC contract; the Tunnel checklist is derived live from
`missing`. electron-builder.yml and tray icon were not changed to reference the new icons (senior
turn). Packaged `--packaged` smoke not re-run. No installers built; no Windows runtime verification.
Screenshots are on Linux/Chromium only.

## Laptop packaging Turn 2 — 2026-10-12 (current repository)

The older application-delivery sections below are inherited evidence, **not installer or
native Windows verification for this new packaging project**. Turn 2 implemented B2/B3/D1/D2
from PACKAGING.md. No commits, pushes, remote repositories, tunnel activation, DNS changes,
Pages publication or owner-data operations were performed.

- `exam-activity` is a read-only database snapshot, with active attempts through grace and
  currently open published exams. Missing profiles are not created by this command.
- Managed desktop runtime and full recovery CLI share a stable sibling writer guard.
  Recovery can rename the data directory on Windows without an open lock handle inside it.
  The original profile lock is retained. Legacy `serve` and external writers remain owner
  stop requirements. `recovery.py` and gateway path rules were not changed.
- Concurrent migration versions are now rechecked after `BEGIN IMMEDIATE`; a deterministic
  concurrent-first-run test covers the real startup race found by Electron IPC smoke.
- Both runtime payloads built from checksummed official downloads and hashed wheel locks:
  CPython 3.12.10 (Astral Linux build 20250409), cloudflared 2025.4.0. Manifests hash every
  regular file and record symlink targets, wheel tags and licenses. Linux: 4,397 regular
  resource files; Windows: 1,026 (manifest itself excluded). Measured Python/wheel ELF
  requirements max at GLIBC_2.25; chosen wheel target/baseline is glibc 2.28. This evidence
  does **not** establish the Electron shell's distro baseline; test its assembled .deb later.
- Electron 44.7.0 and electron-builder 26.15.3 are pinned in `desktop/package-lock.json`.
  Isolated main/preload bridge implements all existing IPC channels. Config validation,
  per-user folders, atomic private writes, stdin owner setup, runtime probes, child-only stop,
  tunnel status/probes, recovery, keep-awake and native close warning are implemented.
  `-I -B -X utf8` prevents installation bytecode writes and explicitly preserves Unicode
  credentials over Windows pipes (the PYTHON* environment is ignored by isolation).
- Renderer remains an intentional bridge placeholder. The nontechnical owner forms,
  screens, final icons and screenshot review belong to Sonnet U1–U4. `closeBehavior` is
  validated/persisted but automatic preferences are reserved; native close while serving
  always warns. Awake/multiple-laptop contextual help needs renderer content in U1.
- `release/linux-unpacked/` is a real local unpacked Electron application with the bundled
  backend/admin/Python/cloudflared resources and Electron/Chromium license notices.
  **No .exe or .deb installer has been built in Turn 2. No clean-OS installation is claimed.**

Measured checks in this turn:

| Check (commands run from the stated directory) | Result |
| --- | --- |
| `backend/`: `rtk proxy .venv/bin/python -m pytest -q` | **101 passed**, one inherited Starlette/httpx deprecation warning |
| `app/`: `rtk proxy npm test -- --run` | **83 passed, 3 skipped**; bulkReview/examSelection preserved |
| `desktop/`: `rtk npm run build` | Strict TypeScript check + main/preload/browser bundles passed |
| `desktop/`: `rtk proxy node node_modules/vitest/vitest.mjs run` | **39 passed**, 3 files; config/credentials/paths/redaction/event parsing, IPC sender/payload/activity guards, background coordination and real payload lifecycle |
| Root: `rtk proxy bash packaging/scripts/build-runtime.sh linux` and `win` | Both payloads actually built; pinned SHA-256 downloads, binary-only hashed wheel installs, admin build and licenses/manifests completed |
| Root: `rtk proxy python3 packaging/scripts/smoke-runtime.py` | Passed copied Unicode/spaces path: isolated bundled Python, owner-status, exam-activity, ready event, both health 200, local admin 200, public admin 404, stdin stopping/stopped and exit 0, empty stderr |
| Offline ingress using bundled Linux cloudflared | Ingress validates; **7/7** canonical/boundary/private/other-host rule cases correct |
| Windows payload structural audit | Correct isolated `_pth`, 20 runtime distributions, **35 PE32+ AMD64** exe/dll/pyd binaries, cp312/abi3 Windows wheel tags, migrations and admin assets |
| Both final runtime manifests | Every recorded file hash matches; zero mismatches or unmanifested regular files |
| `desktop/`: electron-builder `--linux --x64 --dir --publish never` with repo-scoped caches | Unpacked Linux app produced; no publication |
| `desktop/`: `rtk proxy xvfb-run -a node scripts/smoke-electron.mjs` and `--packaged` | Development and unpacked IPC smoke: Unicode owner creation and actual login, starting/probing/running probes, keep-awake, invalid payload rejection, full backup/restore with retained old folder/restart, stopped and password absent from logs |
| `rtk proxy git diff --check` and app scope check | Passed; no tracked app source changed; no staging/commit performed |

The GUI smoke uses generated synthetic credentials and private temporary profiles on the
tool scratch POSIX filesystem, removed afterward. The repository's NTFS mount reports
fixed ownership/permissive mode bits and correctly fails private-profile validation. Early
smokes exposed a migration race and a harness async-readiness mistake; both were fixed and
rerun. Failed automation cleanup was corrected to stop its own synthetic processes rather
than await a native close warning. Playwright adds `--no-sandbox`, so the smoke verifies
Electron security preferences/preload isolation, **not production OS sandbox enforcement**.
Initial sandboxed loopback attempts failed/blocked (`EPERM`); measured passing runtime/backend
checks used approved local execution with loopback access. Initial `uv run` could not write
the default user cache; the existing locked dev venv was used directly for the measured suite.

Unperformed: native Windows Python/Electron execution and Windows 10/11 installation;
Wine execution; .exe/.deb assembly and clean-OS first-run/upgrade/uninstall preservation;
assembled Electron/glibc baseline; final GUI screenshots and full packaged owner plus two
student browser rehearsal; live tunnel metrics/HTTPS connectivity; public Pages/DNS/account
setup. `npm audit` reports 8 moderate findings in the **development-only builder dependency
chain** (sprintf-js/roarr/global-agent); no Node production dependencies are shipped in
app.asar. Review the tooling remediation before release; no unreviewed forced downgrade was
applied. See `desktop/README.md` for exact developer commands and Sonnet's U1–U4 contracts.

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

## Turn 6 (Sonnet) — tickets S1–S5
- S1: Runtime now emits closed with an unexpected flag; Bridge stops the tunnel once on unexpected exit only (desktop/src/main/ipc.ts, runtime.ts).
- S2: a restore that succeeds but whose restart fails returns ok with restarted:false; renderer shows "Your data was restored. The server did not start — choose Start." (role=status).
- S3: StudentGateway marks forwarded scopes pi_public; client_id() uses a valid cf-connecting-ip only for those. The owner listener no longer reads cf-connecting-ip (X-Forwarded-For still honoured under trust_proxy_headers).
- S4: removed awake/multiple-laptops guide topics and buttons; Help shows inline text.
- S5: docs/OWNER-GUIDE.md drafted (not owner-reviewed; Windows steps unverified on native Windows).
- Checks: backend pytest 114 passed; desktop vitest 91 passed, tsc --noEmit clean; packaged Playwright 2 passed. The packaged spec ran against the Turn 4 runtime build, so S1-S3 are NOT in the installers and not exercised by it; Turn 7 must rebuild.
