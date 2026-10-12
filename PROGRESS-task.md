# PROGRESS-task — installer plan checklist (see PACKAGING.md §8 for ticket detail)

## Turn 1 — Claude (done)
- [x] Audit baseline: backend pytest 44 passed, app vitest 83 passed / 3 skipped (bulkReview, examSelection included).
- [x] Architecture decision: Electron launcher + bundled CPython (win embeddable / linux standalone) + unchanged FastAPI; electron-builder NSIS + deb (PACKAGING.md §1).
- [x] B1 student-only `StudentGateway` (`backend/practice_institute/gateway.py`) + tests.
- [x] B1 `pi-admin serve-desktop` dual loopback listeners, JSON stdout protocol, stdin stop, profile lock, port-conflict exit codes (`desktop.py`).
- [x] B1 `setup-owner --stdin-json` and `owner-status` for GUI first run.
- [x] `PI_ADMIN_DIST` setting (packaged admin path, no source-tree assumption).
- [x] Desktop tunnel template → public listener 8788; offline `cloudflared ingress` check script.
- [x] Typed launcher IPC contract `desktop/src/shared/ipc.ts`; UX spec PACKAGING.md §9.

## Turn 2 — Codex
- [x] B2 `exam-activity` read-only CLI + boundary/non-mutation tests; full recovery stable writer guard and migration concurrency fix.
- [x] B3 pinned/checksummed Windows and Linux payloads built; hashed locks, licenses/manifests, Unicode/spaces Linux smoke and Windows AMD64 structural audit.
- [x] D1 Electron main/preload/config/paths/runtime/tunnel/logs, complete `window.pi` bridge, 39 desktop tests and real GUI development + unpacked IPC/recovery smoke. Renderer intentionally a placeholder for U1.
- [x] D2 electron-builder.yml (layout §4, nsis per-user, deb, publish never); Linux unpacked app built. Installer assembly and clean-OS verification remain later tickets.

## Turn 3 — Sonnet
- [x] U1 renderer screens (§9) via `window.pi` only.
- [x] U2 renderer component tests.
- [x] U3 icons + .desktop fixture test.
- [x] U4 screenshots (.cache/screenshots).

## Turn 4 — Codex
- [x] P1 Windows NSIS .exe built in pinned wine container (unsigned; native Windows unverified).
- [x] P2 Linux .deb built; real installed desktop entry matches fixture.
- [x] P3 SHA256SUMS + manifest + licenses + glibc evidence (regenerate after every rebuild).
- [x] P4 fail-closed public/private audit script + 21 adversarial tests; source/index and public manifest checks.
- [x] P5 root manual-dispatch Pages workflow (APP_DIR=app), not pushed or run.
- [x] Turn 4 installed non-root Ubuntu GUI Start/Stop, real apt install/reinstall/purge, preserved owner/data/config; test uses --no-sandbox, same-version reinstall (not upgrade), CLI-seeded synthetic owner.
- [x] Turn 4 pinned offline Wine bundled backend smoke (Unicode profile/password, dual listener, boundaries, login, stop, full recovery); native Windows still unchecked.

## Turn 5 — Claude
- [x] Packaged owner + two-student browser acceptance (`app/packaged-e2e/`, `playwright.packaged.config.ts`): upload, bulk review, exam select-all, publish, isolation, stop/start, submit/timeout, release, profile lock, full backup/restore, gateway/CORS → 2 passed.
- [x] Fixed latent admin bulk-review e2e selectors (never executed before) → admin e2e 5 passed / 1 skipped.
- [x] Trust-boundary review; fixed owner-listener DNS rebinding (`OwnerHostGuard`), Windows AppUserModelID, second-instance restore, tunnel README warning. Backend 110, desktop 87 passed.
- [x] Installers NOT rebuilt (Turn 7 must rebuild + regenerate SHA256SUMS/manifest).

## Turn 6 — Sonnet (follow contracts exactly; no architecture/security redesign)
- [x] S1 Tunnel stops when runtime dies unexpectedly. `desktop/src/main/main.ts` / `ipc.ts`: when `Runtime` emits `closed` without a launcher-initiated stop, call `tunnel.stop()` and push the existing tunnel status update. Test (`desktop/tests/ipc.test.ts` or `runtime.test.ts`): a fake runtime emits `closed`, so the fake tunnel's `stop` is called once. An intentional stop must not call it twice.
- [x] S2 Restore result when the restart fails. `desktop/src/main/ipc.ts` (~line 171, the restore `finally`): if `runtime.start()` rejects after a successful `restore --full`, return `ok({ restarted: false })` instead of an error. Add optional `restarted?: boolean` to the restore result type in `desktop/src/shared/ipc.ts`. The renderer shows "Your data was restored. The server did not start — choose Start." (status role, not alert). Tests: an ipc test with a mocked rejecting start → ok, restarted:false. A renderer test checks the message.
- [x] S3 Per-student rate-limit identity behind the tunnel (contract, do not widen):
  - `backend/practice_institute/gateway.py` `StudentGateway` sets `scope["pi_public"] = True` on forwarded http scopes.
  - In `backend/practice_institute/app.py` `client_id()` (~line 115–125): if `request.scope.get("pi_public")` and the header `cf-connecting-ip` parses with `ipaddress.ip_address`, return it. Otherwise keep the existing behaviour.
  - Owner-listener requests must NEVER use `cf-connecting-ip`.
  - Tests in `backend/tests/test_gateway.py`: with join limit 1, two gateway joins with different `CF-Connecting-IP` → both 201. The same IP twice → 429. An owner-listener (non-gateway) request with `CF-Connecting-IP` is keyed on the peer address. An invalid header value falls back to the peer.
- [x] S4 Guide links: `desktop/src/main/ipc.ts:16` `awake`/`multiple-laptops` point at the generic docs.github.com home. Replace them with inline renderer help text (no external URL) taken from PACKAGING.md §9 copy: keep the laptop awake and plugged in during exams; run only one laptop's runtime per profile. Update the renderer tests.
- [x] S5 Owner guide draft `docs/OWNER-GUIDE.md` (plain language, no terminal): install (Windows first, then Ubuntu), first-run owner setup, start/stop, status colours, awake warning, backup/restore (exam must be idle), tunnel steps as owner-supplied placeholders (`<your-domain>`, `<tunnel-name>`), never tunnel the owner port, uninstall keeps data plus where data lives (PACKAGING.md §3).
- [x] Checks run (backend 114, desktop 91 + tsc clean, packaged 2 passed vs Turn 4 build): `cd backend && rtk proxy .venv/bin/python -m pytest -q`; `cd desktop && rtk proxy npx vitest run && rtk proxy npx tsc --noEmit -p .`; `cd app && rtk proxy npx playwright test -c playwright.packaged.config.ts` (packaged runtime still the Turn 4 build; it must stay green).

## Turn 7 — Codex
- [x] Rebuild both installers with Turn 5/6 changes; regenerate SHA256SUMS/manifest/licenses; rerun packaged spec against rebuilt linux-unpacked AND the installed .deb runtime (`PI_PACKAGED_ROOT=/opt/Practice Institute/resources/runtime`) → 4 passed each (1.7 min), including raw-path/Host and independent CF-IP adversarial tests.
- [x] Verify Linux `xprop WM_CLASS` of installed window == `.desktop` `StartupWMClass`; check installed `.desktop` Comment vs electron-builder.yml.
- [x] Consider Electron fuses (RunAsNode off, NODE_OPTIONS off, inspect off) via electron-builder `electronFuses`; test with packaged binary.
- [x] Adversarial packaged tests, Linux install rehearsal (GUI first run/account + saved settings/authentication/restart, real apt 0.1.0→0.1.1 upgrade, purge preserves database/config SHA-256), Windows extraction/PE/hash + offline Wine validation. Container GUI uses --no-sandbox; native Windows and production OS sandbox remain unverified.

- [x] Close restore check-then-copy gap by validating staged bytes against captured manifest before SQLite open/live swap; database-mutation and source-symlink race tests pass.
- [x] Document StudentGateway CF-IP trust boundary (both sockets explicitly loopback; any local process can spoof the rate-limit header) and review owner guide labels/filenames/Connected-vs-Verified/account setup.

## Turn 8 — Claude
- [x] Final verification, DELIVERY.md, owner guide and account steps. Leave uncommitted under the current no-commit/no-push instruction. (SHA256SUMS OK; backend 116, desktop 91 + tsc, app 83/3 skipped, packaged 4 passed, audit 21; packaged backend == source; guide labels cross-checked; DELIVERY "Final delivery status" added.)

## Always blocked here
- [ ] Native Windows 10/11 clean install/runtime (needs real Windows). Public tunnel/Pages deploy (owner-only).
