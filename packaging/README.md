# Local installer builds and audits

Developer tooling only. Installed owners need none of Python, Node, uv or a terminal.
Builds do not create accounts, start a public tunnel, publish Pages or upload releases.

## Build both installers

Use the exact locked dependencies and the pinned downloads in `pins.json`.
Build the runtime payloads as described in `desktop/README.md`, then from the repo root:

```bash
rtk proxy bash packaging/scripts/build-windows.sh
rtk proxy bash packaging/scripts/build-linux.sh
rtk proxy node packaging/scripts/check-fuses.mjs
rtk proxy node packaging/scripts/release-manifest.mjs
```

The Windows build uses the official `electronuserland/builder:wine` image at
`sha256:41ae540902461b6cbc988987db79547fcc10cda04d2a6c6367504f59d4b37c64`, with only this
repository mounted. The Linux build uses local locked electron-builder and its verified
official packaging downloads. Both always pass `--publish never`. Never run both build
scripts simultaneously: both rebuild `desktop/dist`. Output is ignored `release/`:

- `Practice-Institute-Setup-0.1.0-x64.exe`: per-user, assisted NSIS, unsigned owner installer.
- `practice-institute_0.1.0_amd64.deb`: Ubuntu/Debian amd64.
- `SHA256SUMS`, `manifest.json`: sizes, hashes, every unpacked payload file, runtime pins,
  wheel tags, license inventory and per-ELF GLIBC symbols, including static ELF detection.

Run `check-artifacts.py` after the extraction and installed desktop-entry steps below.

The NSIS bootstrap itself is x86; its embedded application/runtime payload is x64. The
manifest distinguishes Wine cross-building from native Windows runtime verification.
`https://practice-institute.invalid` and the local-build maintainer string are explicitly
reserved placeholders required by `.deb` tooling, not supplied owner details. Replace
them with approved public metadata before a future publication. Linux target is Ubuntu
22.04 / Debian 12; measured symbols do not prove every distribution's compatibility.

## Artifact extraction audit

Use electron-builder's downloaded 7-Zip executable (its cache directory suffix may differ):

```bash
rtk proxy .cache/electron-builder/7zip@1.0.0/7zip-linux-x64-16wjr/bin/7zz x release/Practice-Institute-Setup-0.1.0-x64.exe -o.cache/windows-installer-audit -y
rtk proxy .cache/electron-builder/7zip@1.0.0/7zip-linux-x64-16wjr/bin/7zz x '.cache/windows-installer-audit/$PLUGINSDIR/app-64.7z' -o.cache/windows-installed-payload -y
rtk proxy python3 packaging/scripts/check-artifacts.py
```

For a fresh extraction into another ignored directory, pass that directory as the optional first argument to `check-artifacts.py`.

This checks signatures/architecture and all embedded payload hashes against the release
manifest. It also compares the actual installed Linux entry from the container below
against the fixture's Name/Exec/Icon/Categories/Terminal/Type/StartupWMClass/Comment. Neither
archive extraction nor Wine proves Windows shortcuts, clean installation or native GUI.

## Disposable Ubuntu installation rehearsal

The fixture installs the real 0.1.0 `.deb` through apt, creates a synthetic owner through
GUI forms, relaunches the installed launcher and clicks Start/Stop. It checks the actual
window WM_CLASS, desktop entry, loopback listeners, public admin 404, disabled Node
entry points, and runs the packaged owner/two-student Playwright spec against
`PI_PACKAGED_ROOT=/opt/Practice Institute/resources/runtime`. A separate 0.1.1 test
package (identical runtime, changed package version) exercises apt's real upgrade path.
The fixture launches it again and purges it, checking database/config hashes are preserved.
The test does not install anything on the host. Xvfb/xdotool/ImageMagick and copied
Node/Playwright bundles are developer test instruments, never owner requirements.
Docker blocks Chromium namespace sandboxing, so the fixture uses `--no-sandbox`;
the shipping entry never adds that flag. OS sandbox enforcement and native quit/tray
interaction remain unverified. Output and screenshots live in `.cache/linux-install/`.

```bash
rtk proxy bash packaging/scripts/build-upgrade-fixture.sh
rtk proxy mkdir -p .tools/container-bin .tools/node-test .tools/playwright-browsers .cache/linux-install
rtk proxy cp /home/avi/.local/bin/rtk .tools/container-bin/rtk
# Copy your already-installed pinned test tooling into ignored repo-local folders.
# These paths describe this build host; adjust to your local Node/Playwright location.
rtk proxy cp -a /home/avi/.nvm/versions/node/v22.22.2/. .tools/node-test/
rtk proxy cp -a /home/avi/.cache/ms-playwright/chromium-1243 .tools/playwright-browsers/
rtk proxy docker run --rm --network bridge \
  --mount "type=bind,source=$PWD/release,target=/packages,readonly" \
  --mount "type=bind,source=$PWD/.cache/upgrade-release,target=/upgrade,readonly" \
  --mount "type=bind,source=$PWD/packaging/scripts,target=/test-scripts,readonly" \
  --mount "type=bind,source=$PWD/.tools/container-bin,target=/test-tools,readonly" \
  --mount "type=bind,source=$PWD/.tools/node-test,target=/test-node,readonly" \
  --mount "type=bind,source=$PWD/.tools/playwright-browsers,target=/test-browsers,readonly" \
  --mount "type=bind,source=$PWD,target=/project,readonly" \
  --mount "type=bind,source=$PWD/.cache/linux-install,target=/results" \
  ubuntu:22.04@sha256:5ec03bb3441e8b0bf3b4f9cd4629a1ae763010dc3035bb8da3ae6cf026486401 \
  bash /test-scripts/linux-install-container.sh
```

Change the RTK source path if it lives elsewhere on a developer machine. The fixture is
guarded against direct host execution. Its synthetic screenshots, apt logs, desktop entry
and owner-status output live in `.cache/linux-install/`. No owner credentials are printed.

## Public/private audit and prepared Pages workflow

```bash
rtk proxy env VITE_PI_API_BASE=https://api.owner-domain.example BASE_PATH=/practice-institute/ npm run build --prefix app
rtk proxy env VITE_PI_API_BASE=https://api.owner-domain.example BASE_PATH=/practice-institute/ npm run check:student-build --prefix app
rtk proxy node packaging/scripts/public-manifest.mjs
rtk proxy node packaging/scripts/audit-public.mjs
rtk proxy node packaging/scripts/audit-public.mjs --staged
rtk proxy node --test packaging/tests/audit-public.test.mjs
```

`public-policy.json` is the reviewed allowlist: exact vendor/OCR/font/synthetic-demo file
hashes plus individual hashes of benign long React/PDF.js identifiers and embedded font
data. Generated HTML/JS/CSS has narrowly named paths, private-route/credential checks and
long-token checks. Opaque assets and minified vendor workers pass only at their pinned
hashes. PDF.js additionally needs exact pinned CMap/font/ICC files and license notices,
not just common web extensions. `public-manifest.mjs` applies that policy before writing
the ignored build-specific manifest. Missing/extra files, symlinks, unreviewed tokens,
changed assets and forged manifest exemptions fail closed. Never regenerate the reviewed
policy automatically to silence a failure; inspect the dependency/input change first.

The source audit reads tracked and nonignored new files; `--staged` reads the index bytes.
It rejects environment/private-data/key paths and recognizable credential contents without
printing their values. Secret detection cannot prove absence of every arbitrary password.
Run both source and staged audits before any future push, then the public artifact audit
immediately before upload. The current run does not stage, commit, push or publish.

Root `.github/workflows/pages.yml` is prepared, manual-dispatch only, `APP_DIR=app`, and
uploads only `app/dist`. No Actions run was performed. OCR files are already checked in
and hash-bound; the workflow does not regenerate their nondeterministic download report.
The owner must supply the real repository, enable Pages source=Actions, set public HTTPS
`VITE_PI_API_BASE` as an Actions variable, and set launcher CORS to the exact Pages origin
without the repository path. The example API above is deliberately a reserved placeholder.

## Native Windows acceptance still required

Use an actual Windows 10 x64 and Windows 11 x64 test machine with a disposable local user:

1. Verify `SHA256SUMS`, install the unsigned `.exe` per-user without developer tools, and
   check Desktop/Start-menu shortcuts, icon, chosen install directory and uninstaller.
2. First-run GUI: random test password, optional website deferred, GUI Start/Open admin/
   Stop, tray/background/quit warning, port conflict and second-instance focus. Use a
   Unicode/spaces user profile and a separately hosted synthetic student site.
3. Rehearse owner plus two separate student browsers, restart/cutoff/release, full backup/
   restore with exams stopped, retained pre-restore data and session revocation.
4. Install a newer test version and uninstall; verify AppData config/data/logs survive.
5. Check renderer OS sandbox, Windows ACLs, lid-close/awake warning and unsigned SmartScreen
   behavior. No certificate, publisher identity or native Windows results are invented.

For additional bundled-backend evidence, `windows-runtime-smoke.py` can be run with the
installed Python (the developer test uses only synthetic temporary data and stdin secrets).
It also runs under the pinned Wine container with read-only payload/script mounts and
`--network none`; Wine evidence is explicitly separate from native Windows verification.
