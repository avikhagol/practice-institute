# Packaging architecture — Practice Institute laptop installer

Status: Turn 1 decision + first implementation (backend runtime side). Later turns implement
the tickets at the end. Do not redesign the security boundaries below without a senior turn.

## 1. Decision

**Electron launcher (isolated renderer) + bundled CPython runtime running the unchanged
FastAPI backend, packaged with electron-builder: NSIS `.exe` (Windows x64, per-user) and
`.deb` (Ubuntu/Debian amd64).** Both artifacts are built on this Linux host.

Why:
- electron-builder produces both NSIS and deb from Linux. NSIS on Linux needs Wine only for
  `rcedit` (exe icon/version resources); the official `electronuserland/builder:wine` image
  (pin by digest) provides it in a disposable container. No remote CI.
- The backend stays Python. PyInstaller cannot cross-compile Windows, so we **do not freeze**:
  - Windows: python.org **embeddable** CPython 3.12.x amd64 zip (official, checksum pinned),
    third-party packages vendored at build time with
    `uv pip install --target <payload>/site-packages --python-platform x86_64-pc-windows-msvc --python-version 3.12 --only-binary :all: -r requirements-runtime.txt`
    and `python312._pth` edited to add `site-packages` and `app` (no `import site`, no pip).
  - Linux: python-build-standalone `cpython-3.12.x+<date>-x86_64-unknown-linux-gnu-install_only`
    (Astral, pinned SHA-256; glibc baseline 2.17), packages vendored with
    `--python-platform x86_64-manylinux_2_28` (documented glibc ≥ 2.28 → Ubuntu 20.04+/Debian 10+;
    record the real max manylinux tag in the manifest after build).
  - Runtime requirement set = `argon2-cffi fastapi pypdf python-multipart uvicorn` (plain uvicorn +
    h11; **no** `[standard]`, so no uvloop/httptools/watchfiles/websockets on the owner laptop).
    Generate a hashed lock: `uv pip compile backend/pyproject.toml --no-deps-extra ... --generate-hashes`.
- No backend/admin UI rewrite. Admin UI is the existing `app/dist-admin`, served by the backend
  and opened in the owner's **system browser** at `http://127.0.0.1:<owner_port>/admin/`
  (not inside Electron: keeps the launcher renderer free of remote content and cookies).
- Electron version: newest stable that still supports Windows 10 x64 (pin exact version in
  `desktop/package.json`, record in DELIVERY.md). macOS: not built (optional, out of scope).
- Unsigned. Disclose SmartScreen "Unknown publisher". `--publish never`. No auto-update.

## 2. Process model (implemented in Turn 1, `backend/practice_institute/desktop.py`)

```
Electron main (launcher)                 bundled python  (one process per profile)
 ├─ renderer (sandboxed, static UI)      pi-admin serve-desktop --stdin-control
 │    ↕ typed IPC (preload, contextBridge)  ├─ owner  listener 127.0.0.1:8787  full app
 ├─ spawns runtime with absolute paths      └─ public listener 127.0.0.1:8788  StudentGateway (/api/v1 only)
 └─ spawns cloudflared (optional, owner-initiated) → http://127.0.0.1:8788 only
```

- One FastAPI app instance, one SQLite writer, the sweeper runs once (owner listener lifespan).
- `StudentGateway` (`backend/practice_institute/gateway.py`): only methods GET/HEAD/POST/OPTIONS
  and raw request target matching `^/api/v1(?:/[A-Za-z0-9_-]{1,128})*/?$`, raw == decoded path,
  ASCII, ≤512 bytes. Everything else → `404 {"error":"not-found"}` before the app. `Cookie`
  header is dropped. CORS/auth/cutoff behaviour unchanged (same app).
- The tunnel config template `backend/deploy/cloudflared.desktop.example.yml` targets **8788**
  with final `http_status:404`; `packaging/scripts/check-ingress.sh` validates it offline.
  Original `backend/deploy/cloudflared.example.yml` (8787) stays for the CLI/dev deployment.

### Runtime process protocol (contract — launcher MUST follow)

Command (absolute paths; never `python` from PATH; `cwd` = runtime resources dir):

| Platform | Executable | Args |
|---|---|---|
| Windows | `<resources>\runtime\python\python.exe` | `-I -m practice_institute.cli serve-desktop --stdin-control --owner-port P --public-port Q` |
| Linux | `<resources>/runtime/python/bin/python3` | same |

The launcher also passes `-B -X utf8`: `-I` ignores `PYTHONDONTWRITEBYTECODE` and
`PYTHONUTF8`, so the explicit flags prevent installation bytecode writes and ensure
Unicode stdin credentials survive Windows pipe encoding. `-I` isolates from user site/env PYTHON*; the `_pth` (Windows) / `sitecustomize`-free
`PYTHONPATH`-less layout must make `practice_institute` importable from `<resources>/runtime/app`.
On Linux with `-I`, put backend + deps under `<python>/lib/python3.12/site-packages` at build time.

Environment passed (built from validated launcher config; nothing else from the parent except
`SystemRoot`, `TEMP`/`TMP`, `PATH` minimal, `HOME`/`USERPROFILE`, `LANG`):

| Var | Value |
|---|---|
| `PI_DATA_DIR` | `<dataDir>` (see §3) |
| `PI_ADMIN_DIST` | `<resources>/runtime/admin` (built `app/dist-admin`) |
| `PI_ALLOWED_ORIGINS` | exact student origin from config, e.g. `https://user.github.io` (may be empty before setup) |
| `PI_COOKIE_SECURE` | `false` (admin is local http) |
| `PI_TRUST_PROXY_HEADERS` | `false` default; owner opt-in toggle later |
| `PYTHONDONTWRITEBYTECODE`, `PYTHONUTF8` | `1` |

Stdout: one JSON object per line. Events:
- `{"event":"ready","pid":N,"owner_url":"http://127.0.0.1:P","public_url":"http://127.0.0.1:Q"}`
- `{"event":"error","code":"port-in-use","port":P,"listener":"owner"|"public"}` → exit 3
- `{"event":"error","code":"already-running","data_dir":"..."}` → exit 4 (profile lock held)
- `{"event":"error","code":"config","message":"..."}` → exit 2
- `{"event":"stopping"}`, `{"event":"stopped","ok":true}` → exit 0
Stderr: warning-level logs (no access log). Launcher appends stderr to `<logDir>/backend.log`
with rotation (5 × 2 MB). Never log request bodies, env, or cloudflared args.

Stop: write `stop\n` to stdin or close stdin; wait 10 s; only then kill **the child PID it spawned**
(never by port or name). Runtime death also releases the OS file lock `<dataDir>/runtime.lock`.

Turn 2 adds a stable sibling writer guard at `<dataDir parent>/.<dataDir name>-writer-guard/runtime.lock`.
The managed runtime and full recovery CLI both acquire it. Keeping that handle outside
the swapped directory allows Windows restore to rename the data directory. The existing
runtime profile lock remains in place. Legacy `serve` and external SQLite writers still
must be stopped manually. Startup migrations recheck versions under the SQLite write lock
to prevent concurrent first-run CLI processes from creating the same tables.

Readiness for the UI (state machine, not "spawned = green"):
`stopped → starting (spawned) → ready-event → probing → running` where `probing` =
`GET owner_url/api/v1/health` 200 **and** `GET public_url/api/v1/health` 200 and
`GET public_url/api/admin/me` == 404 (self-check of the gateway). Re-probe every 10 s;
3 failures → `failed`. Exit → `stopped` or `failed(code)`.

Other runtime CLI used by the launcher (implemented):
- `-I -m practice_institute.cli owner-status` → `{"owner_exists":bool,"migrations":[...]}`
- `-I -m practice_institute.cli setup-owner --stdin-json` + stdin one line
  `{"username","password","confirm"}` → `{"ok":bool,"code":"created|bad-input|bad-username|mismatch|weak-password|owner-exists","message":...}`.
  Password policy = server's `MIN_PASSWORD_LENGTH` (12). Password only travels over the pipe.
- Backup/restore (runtime **must be stopped**, launcher enforces): existing
  `backup --full <abs dir>` / `restore --full <abs dir>` (`recovery.py`, unchanged semantics).

## 3. Per-user data layout (outside install dir; preserved on upgrade/uninstall)

| | Windows | Linux |
|---|---|---|
| config | `%APPDATA%\Practice Institute\config\` | `$XDG_CONFIG_HOME/practice-institute/` (`~/.config/...`) |
| data (`PI_DATA_DIR`) | `%LOCALAPPDATA%\Practice Institute\data\` | `$XDG_DATA_HOME/practice-institute/data/` |
| logs | `%LOCALAPPDATA%\Practice Institute\logs\` | `$XDG_STATE_HOME/practice-institute/logs/` |
| backups default | `Documents\Practice Institute Backups\` (owner can choose) | `~/Practice Institute Backups/` |
| tunnel creds | `<config>\tunnel\<uuid>.json` (copied in by GUI import) | same under config |

Electron `app.setPath('userData', <config>/electron)` before ready so Chromium caches live there.
Permissions: POSIX dirs 0700 / files 0600. Windows: dirs under the user profile inherit the user's
ACL; additionally run `icacls <dir> /inheritance:r /grant:r "%USERNAME%:(OI)(CI)F"` once at
creation (spawned with arg array, no shell). Config writes: write `*.tmp` + fsync + rename.

`config.json` (schema v1, validated on load; unknown keys rejected):
```json
{ "version": 1, "ownerPort": 8787, "publicPort": 8788,
  "studentOrigin": "" , "publicApiHost": "",
  "tunnel": { "mode": "none" | "named", "tunnelId": "", "credentialsFile": "" },
  "trustProxyHeaders": false, "keepAwakeWhileServing": true, "closeBehavior": "ask" }
```
Validation: ports 1024–65535 distinct; `studentOrigin` `^https://[a-z0-9-]+\.github\.io$` **or**
any `https://host[:port]` origin with no path (or `http://127.0.0.1:<port>` for rehearsal);
`publicApiHost` bare hostname (no scheme/path); `tunnelId` UUID; `credentialsFile` must be inside
`<config>/tunnel/`, regular file, not symlink, owned by the user, ≤ 64 KB, JSON with `TunnelID`.

## 4. Package resource layout (electron-builder `extraResources`)

```
<resources>/
  app.asar                      launcher main/preload/renderer (desktop/dist)
  runtime/
    python/                     CPython (win embeddable or linux standalone) + site-packages
    app/practice_institute/     backend package incl. migrations/*.sql (Windows: on _pth)
    admin/                      app/dist-admin (pdf.js worker, tesseract wasm + traineddata, fonts)
    cloudflared/cloudflared(.exe)  pinned official release, SHA-256 checked (Windows x64 / linux amd64)
    licenses/                   CPython, each wheel, Electron/Chromium, cloudflared, tesseract, pdf.js, fonts
    manifest.json               versions, sha256 per file group, build date, glibc/manylinux tag
```
Install dirs: Windows per-user NSIS `%LOCALAPPDATA%\Programs\Practice Institute\`
(`oneClick:false`, `perMachine:false`, `allowToChangeInstallationDirectory:true`, desktop +
Start-menu shortcuts, uninstaller **never deletes AppData** — `deleteAppDataOnUninstall:false`).
Linux deb: `/opt/Practice Institute/` + `/usr/share/applications/practice-institute.desktop`;
`postrm` must not touch home directories.

## 5. Electron security contract (`desktop/`)

- `BrowserWindow`: `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`,
  `webSecurity:true`, `allowRunningInsecureContent:false`, `devTools` off in packaged builds.
- Renderer loads only `file://<asar>/renderer/index.html`; CSP `default-src 'self'; connect-src 'none'`
  (renderer never calls HTTP — main does probes). `will-navigate`/`will-redirect` → prevent.
  `setWindowOpenHandler` → deny; external opens only via `shell.openExternal` for the allowlist:
  `http://127.0.0.1:<ownerPort>/admin/`, `https://developers.cloudflare.com/…`, `https://docs.github.com/…`,
  `https://one.dash.cloudflare.com/`, `https://github.com/`.
- `app.requestSingleInstanceLock()`; second instance focuses the first window.
- IPC: exactly the channels in `desktop/src/shared/ipc.ts`, `ipcMain.handle` only, every payload
  validated in main (types + ranges), sender frame URL checked against the app's renderer URL.
  No generic `exec`, `readFile`, `openPath(arbitrary)`. Folder opens take an enum, not a path.
  Backup/restore paths come only from main-process `dialog.showOpenDialog`/`showSaveDialog`.
- Passwords: renderer → `setup:createOwner` → main writes JSON to child stdin, then drops refs.
  Never logged, never in argv/env/URL, never returned.
- Close policy: window close while `running` → dialog "Students may be taking an exam. Stop the
  server and quit / Keep running in background (tray) / Cancel". Default focus = Cancel.
  Tray icon keeps the server alive; "Quit" from tray asks the same question.
- Keep-awake: `powerSaveBlocker.start('prevent-app-suspension')` only while `running` and
  `keepAwakeWhileServing`; banner explains it does not stop lid-close sleep, Wi-Fi loss or
  Windows Update reboots.

## 6. Tunnel (owner-initiated only)

`cloudflared tunnel --no-autoupdate --config <config>/tunnel/config.yml run` spawned only when the
owner presses "Start tunnel" with `tunnel.mode=named` and valid files. Launcher generates
`config.yml` from the desktop template (service fixed to `http://127.0.0.1:<publicPort>`).
Status: `not-configured` / `stopped` / `starting` / `running (process up, not verified)` /
`connected (cloudflared /ready metrics endpoint reports readyConnections>0 via --metrics 127.0.0.1:<free>)` /
`verified (HTTPS GET https://<publicApiHost>/api/v1/health = 200 and /admin/ = 404)` / `failed`.
Account login/DNS (`cloudflared tunnel login`, `create`, `route dns`) are owner steps in the
guide; the launcher never runs them unattended and never stores the cert.pem in the repo.
Log only cloudflared stderr lines with token-like substrings redacted (`[A-Za-z0-9_-]{32,}` → `[redacted]`).

## 7. Backup/restore from the GUI

1. Refuse while an exam may be active. The launcher has no admin session, so the runtime CLI
   gets a read-only command (ticket B2) `exam-activity` →
   `{"active_attempts":n,"open_exams":n}`; restore requires `active_attempts==0` and explicit
   typed confirmation; backup warns if n>0.
2. Stop runtime (and cloudflared) → wait for exit → run `backup --full` / `restore --full` with a
   dialog-chosen absolute directory outside `PI_DATA_DIR` → restart runtime if it was running.
3. Restore keeps `data.pre-restore-<ts>` (existing behaviour); GUI shows that path and that admin
   sessions were revoked (log in again). Credentials/tunnel files are never in bundles.

Turn 2 bridge refuses both recovery operations when active attempts **or open published
exams** exist, and fails closed when activity cannot be read. It rechecks after the folder
dialog and again with managed processes stopped. `previousDataFolder` contains the retained
folder's basename. The full path is not exposed as a renderer-controlled filesystem API.
All settings changes currently require both processes stopped, avoiding stale spawn-time
origins/ports. Native close always uses the exam-warning dialog; `closeBehavior` is persisted
but automatic tray/stop preferences are reserved, not an implemented UI setting.

Turn 3's concrete build/test and renderer instructions are in `desktop/README.md`. The
build bundles renderer TypeScript for browsers and preserves the strict static CSP.

## 8. Tickets

Legend: owner turn → files → contract/acceptance. Check off in PROGRESS-task.md.

### Turn 2 — Codex (runtime/lifecycle/launcher bridge)
- **B1** ✅ (Turn 1) gateway + serve-desktop + setup-owner + owner-status + tests.
- **B2** `backend/practice_institute/desktop.py`: add `exam-activity` CLI (read-only; counts
  `attempts.status='active' AND deadline_at+grace > now` and published exams with opens/closes
  spanning now). Tests in `backend/tests/test_desktop_runtime.py`.
- **B3** `backend/requirements-runtime.in` + hashed `requirements-runtime-{win,linux}.txt` via
  `uv pip compile --python-platform ...`. Script `packaging/scripts/build-runtime.sh {win|linux}` →
  `packaging/output/runtime-<os>/` exactly as §4 (python + app + admin + licenses + manifest).
  Downloads into `packaging/vendor/` with pinned URL+SHA-256 in `packaging/pins.json`.
  Linux smoke: run `runtime-linux/python/bin/python3 -I -m practice_institute.cli serve-desktop`
  from a path with spaces/Unicode, ready event + health. Windows payload: import check under the
  wine image if available, else structural audit (`_pth`, `.pyd` are PE32+ x86-64, cp312/abi3 tags).
- **D1** `desktop/` Electron project: `package.json` (pinned electron, electron-builder,
  typescript, vitest), `tsconfig`, `src/main/{main.ts,paths.ts,config.ts,runtime.ts,tunnel.ts,ipc.ts,logs.ts}`,
  `src/preload/preload.ts`, `src/shared/ipc.ts` (exists — implement exactly), minimal
  `src/renderer/index.html` placeholder with the IPC smoke. Implement §2 state machine, §3 paths
  + atomic config + validation, §5 security, single-instance, close policy hooks.
  Unit tests (vitest, node env): config validation (good/bad origins, ports, symlinked creds),
  path resolution with spaces/Unicode, runtime event parsing, stop-only-own-child, redaction.
  Test harness that drives `runtime.ts` against the real `backend/.venv` python (dev) by
  injecting the python path — packaged path resolution separate.
- **D2** `desktop/electron-builder.yml`: §4 layout, nsis per-user, deb, `publish: null`; no build
  yet required (Turn 4 builds), but `--dir` linux build should run if time permits.

### Turn 3 — Sonnet (launcher UI, under contract; no security/packaging changes)
- **U1** `desktop/src/renderer/` — screens per §9 using only `window.pi` from `src/shared/ipc.ts`.
- **U2** Component/unit tests: `desktop/src/renderer/**/*.test.ts` (vitest + jsdom): first-run
  validation messages, password confirm mismatch, status badges for every state, port-conflict
  panel text, close-dialog copy, backup/restore disabled while exam active.
- **U3** Icons/shortcut metadata: `desktop/build/icon.png` (512²), `icon.ico` (16–256),
  `desktop/build/linux/practice-institute.desktop.fixture` + test asserting Name/Exec/Icon/Categories.
- **U4** Screenshots via Playwright `_electron` into `.cache/screenshots/` (not committed).
- Run `app` vitest (bulkReview/examSelection) and backend pytest unchanged — must still pass.

### Turn 4 — Codex (installers)
- **P1** `packaging/scripts/build-windows.sh` → docker `electronuserland/builder:wine@sha256:…`
  with only repo-scoped mounts → `release/Practice-Institute-Setup-<ver>-x64.exe`.
- **P2** `packaging/scripts/build-linux.sh` → `release/practice-institute_<ver>_amd64.deb`.
- **P3** `packaging/scripts/release-manifest.mjs` → `release/SHA256SUMS`, `release/manifest.json`
  (versions, sizes, licenses list, glibc/manylinux evidence via `objdump -T` max GLIBC symbol).
- **P4** `packaging/scripts/audit-public.mjs` fail-closed allowlist audit (§10) + tests.
- **P5** Root `.github/workflows/pages.yml` (APP_DIR=app) — not pushed.
- Linux install smoke in `ubuntu:22.04` container (non-root user, `apt install ./x.deb`, xvfb launch).

### Turn 5+ — see task.md turn list; Turn 5 reviews trust boundary and runs packaged flows.

## 9. Launcher UX spec (Designer — Sonnet implements)

Window 880×640, min 760×560, single column, system font stack
(`"Segoe UI", system-ui, Ubuntu, sans-serif`), 16px base, 1.5 line-height. Colours (WCAG AA on
white): text `#1f2933`, muted `#52606d`, primary `#1d4ed8` (hover `#1e40af`, focus ring 3px
`#93c5fd`), success `#047857`, warning bg `#fff7ed` border `#c2410c` text `#7c2d12`, danger `#b91c1c`.
Never colour-only: each badge = icon + word.

Screens (top nav: Home · Setup · Tunnel · Backup · Help):
1. **First run** (shown when `owner_exists=false`): Step 1 "Create owner account" — Username,
   Password (show/hide toggle, live "at least 12 characters" hint), Confirm password; primary
   "Create account". Errors inline under field with `aria-describedby`. Step 2 "Students' website"
   (optional, "Set up later" secondary) — student origin + public API hostname with examples
   `https://YOUR-NAME.github.io`, `api.YOUR-DOMAIN`. Step 3 → Home. Local admin works after Step 1.
2. **Home**: big status card "Server" (Stopped/Starting/Running/Problem) + "Tunnel"
   (Not set up/Stopped/Running – not verified/Connected/Verified/Problem); buttons Start server /
   Stop server, Open admin (enabled only when Running), Open data folder, Open logs folder.
   Persistent amber banner while Running: "Keep this laptop awake, plugged in and online until
   every student has submitted. Closing the lid or losing Wi-Fi stops the exam for everyone."
3. **Problem panels**: port-in-use ("Another program is using port 8787. Close it or choose a
   different port in Setup." + Change port), already-running ("Practice Institute is already
   running for this user."), runtime crashed (last 20 log lines, redacted, + Open logs).
4. **Tunnel**: checklist guide (account → domain → `cloudflared tunnel login/create` done on
   Cloudflare's site/terminal-free alternative documented → import credentials file → hostname)
   with Validate, Start tunnel, Stop tunnel, Verify. Shows exact rule: only /api/v1 is public.
5. **Backup**: Full backup (choose folder), Restore (choose folder → confirmation dialog requiring
   typing RESTORE; disabled with reason while an exam is active), last backup time.
6. **Help**: awake/online rules, multiple laptops need separate API hosts + student builds,
   unsigned installer note, where data lives, uninstall keeps data.

## 10. Public/private audit (Turn 4 P4)

Fail-closed: student `app/dist` may contain only allowlisted extensions (html, js, css, woff2,
svg, wasm, traineddata(.gz), json manifest, pdf demo synthetic) and must not contain `/admin`,
`/api/admin`, `dist-admin` strings outside the client router allowlist, `.sqlite`, `.env`,
private keys, `cloudflared` creds (`AccountTag`, `TunnelSecret`), tokens (`[A-Za-z0-9_-]{40,}`
outside wasm/traineddata). Git tracked files: deny `.env*` (except examples), `*.sqlite*`, `*.db`,
`*.pem|key|pfx|p12`, `uploads/`, `backups/`, `fixtures/real/`, `release/`, cert.pem, tunnel JSON.

## Turn 7 hardening and verification contract

- Packaging disables Electron RunAsNode, NODE_OPTIONS and CLI inspection via
  `electronFuses`. `check-fuses.mjs` reads both actual binaries; the installed Linux
  rehearsal also attempts environment code injection and inspector startup.
  Reference: https://www.electronjs.org/docs/latest/tutorial/fuses .
- `extraMetadata.desktopName=practice-institute.desktop`, `linux.syncDesktopName=true`
  and `linux.description` make the generated entry match the observed window class
  and Comment; the installed rehearsal checks `xprop WM_CLASS`.
- Full restore validates the private staged copy against the captured manifest before
  opening its database or replacing live data. Symlinks copied during a race remain
  symlinks and fail validation. Checksums still do not authenticate a malicious bundle.
- Desktop public rate limiting trusts valid CF-Connecting-IP on all StudentGateway
  requests. `bind_loopback` fixes both sockets to 127.0.0.1 and uvicorn proxy processing
  is disabled. Any local process can still spoof this header; the serving laptop is a
  trusted local boundary and IP limits are best-effort abuse controls. No remote-origin
  header can set the internal pi_public scope flag on the owner listener.
