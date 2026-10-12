# Launcher development and guided renderer handoff

The installed owner uses the GUI; these commands are for developers building the installer.
Run from the repository root unless a directory is specified. Node 22.13+, Python 3.12+,
uv, curl, zstd, objdump and rtk are build tools only.

```bash
rtk proxy npm ci --prefix app --cache .npm-cache
rtk proxy npm run assets:ocr:download --prefix app
rtk proxy bash packaging/scripts/build-runtime.sh linux
rtk proxy bash packaging/scripts/build-runtime.sh win
rtk proxy npm ci --prefix desktop --cache .npm-cache
```

Electron may defer its binary installation until first use. If it is missing (as on this
host), run from `desktop/`:

```bash
rtk proxy env electron_config_cache="$PWD/../.cache/electron" node node_modules/electron/install.js
rtk npm run build
rtk npm start
rtk npm test
rtk proxy xvfb-run -a node scripts/smoke-electron.mjs
```

The binary installer validates the pinned Electron package's checksums; see the official
[installation and cache documentation](https://www.electronjs.org/docs/latest/tutorial/installation).
No Python/Node/uv requirement is imposed on installed owners. Development uses the built
`packaging/output/runtime-linux` or `runtime-win`; there is no fallback to a system Python.
`Runtime` accepts an explicit `Launch` object for independent development harnesses.

Linux unpacked app (from `desktop/`, publication disabled):

```bash
rtk proxy env ELECTRON_CACHE="$PWD/../.cache/electron" ELECTRON_BUILDER_CACHE="$PWD/../.cache/electron-builder" node node_modules/electron-builder/cli.js --linux --x64 --dir --publish never
```

Packaged binaries disable RunAsNode, NODE_OPTIONS and CLI inspection. Playwright's
Electron harness depends on inspection and is now development-only; `--packaged`
fails with a clear message. Use the disposable installed GUI/browser rehearsal in
[packaging/README.md](../packaging/README.md) for the shipping binary.

The development Electron smoke uses a synthetic POSIX temporary profile, automatically removed, and
test-selected recovery dialogs. The repo's NTFS mount does not support private POSIX
profile permissions. Playwright's Electron launcher adds `--no-sandbox`; the smoke tests
security preferences, preload isolation and behavior, **not OS sandbox enforcement**.
An unpacked app is not a clean OS installation. Native Windows testing and .exe/.deb
installer assembly remain the later turns' responsibility.

## Sonnet U1–U4 contracts

- Edit only `src/renderer/`, renderer tests and `build/` icons/shortcut metadata. Use
  `src/shared/ipc.ts` unchanged and `window.pi` for every operation. No Node imports,
  fetch, arbitrary filesystem access, new channels or direct backend requests.
- Follow PACKAGING.md §9 for screens, colors, copy, fields, sizing and accessibility.
  `renderer.ts` is currently a deliberately minimal bridge preview. `scripts/build.mjs`
  bundles it for a browser and copies other renderer assets; keep CSP in `index.html`.
- `getState()` obtains the initial snapshot; `onState()` supplies updates and returns
  an unsubscribe function. Every action resolves a typed `Result`. Handle `busy` by
  keeping the current screen and showing a retryable message. Don't optimistically mark
  a process running: use `server.kind` and `tunnel.kind` from state.
- Owner creation errors: `bad-input`, `bad-username`, `mismatch`, `weak-password`,
  `owner-exists`. Password minimum is 12; clear all password state after a submission.
  Main does not return backend strings or password-bearing exceptions.
- Settings are saved while both managed processes are stopped (`server-running` if not).
  Tunnel credential import is a main-process dialog; only the tunnel ID is returned.
  Renderer cannot choose/read credential paths. Import requires account tag/secret/ID
  JSON, matching ID, regular file, current-user ownership and at most 64 KiB.
- Backups and restores are refused while **either** `activeAttempts > 0` or
  `openExams > 0`, and activity failures also fail closed. Main rechecks after the folder
  dialog and after stopping writers. Disable the UI with a reason. Restore requires
  `pi.restore('RESTORE')` after typed confirmation and a main trusted-bundle confirmation.
  `previousDataFolder` is the retained folder's basename, not an unrestricted path.
- Quit choice: `stop-and-quit`, `keep-running`, `cancel`. Native close while serving
  always asks with Cancel as default. Do not expose the reserved `closeBehavior`
  setting as an automatic-stop preference: it is validated/persisted, while the native
  policy deliberately keeps the exam warning. The tray uses a temporary 1px bitmap;
  replace it with the U3 icon and add a packaged icon path in the next senior turn if needed.
- The keep-awake warning must explain lid-close, Wi-Fi loss and restart limits.
  Tunnel startup is explicit and requires a running server. `running-unverified` is
  not connected; `connected` comes from local metrics; `verified` comes from HTTPS probes.

U2: add jsdom as an exact dev dependency if component tests need it; preserve the existing
node-environment main-process tests. Test every status badge, setup errors, port conflict
copy, restore confirmation and disabled recovery. U3: icon.png (512²), icon.ico (16–256),
Linux `.desktop` fixture with Name/Exec/Icon/Categories assertions. U4: screenshots into
ignored `.cache/screenshots/`; ensure the smoke's temporary profile stays disposable.
Re-run desktop build/tests/smoke, app tests and backend tests. Do not change
`gateway.py`, `recovery.py`, the IPC contract or installer security to solve UI issues.
