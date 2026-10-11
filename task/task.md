# Practice Institute laptop installer — new local repository, Windows first

## Goal and user decisions
Build an installable laptop owner/admin/backend application from the existing completed Practice Institute source. Keep the student website hosted separately on GitHub Pages. Create a **new local Git repository** at /mnt/6438D98627D1388F/Intelligence/gh/practice-institute . This ALFRD project lives in that repository and performs the implementation. The user explicitly chose **local builds through ALFRD, no GitHub repository creation or push**, and requested that **AGY be replaced with Claude `sonnet` for low-level, well-guided work**. No AGY/Gemini calls or wrappers. Eight total turns: claude, codex, sonnet, codex, claude, sonnet, codex, claude. Sonnet is the actual Claude Code CLI with model alias sonnet, native Claude adapter and live activity logging.

## Platform priority — mandatory
1. Windows 10/11 x64: PRIMARY. Produce an actual installer .exe with desktop and Start menu launchers.
2. Linux x64: REQUIRED, Ubuntu/Debian first. Produce an actual installable .deb with application-menu launcher.
3. macOS: OPTIONAL only when straightforward; never delay Windows/Linux for it.
Do not stop with a generic web app, stub desktop UI, unexecuted packaging scripts, or a Linux-only release labelled complete. Prioritize an actual Windows installer artifact; report installation/runtime verification separately from artifact build. This host is Linux; Docker is available; Wine/makensis were not installed at kickoff. Windows cross-build via an appropriate local container/toolchain is allowed, but do not claim that Wine or an archive audit proves a clean Windows 10/11 install. Native Windows tests require an actual Windows environment. If unavailable, deliver the strongest real locally built artifacts and reproducible native scripts, and explicitly mark Windows-native verification blocked rather than inventing results. Do not use remote CI (owner chose local only).

## Starting point and preservation
The original completed task is /mnt/6438D98627D1388F/Intelligence/agents/alfrd_brainstorm/task-practice-institute . It is READ ONLY. Its curated app/, backend/, synthetic test fixtures and architecture/delivery/deployment documentation were copied into this new repo; live databases, .env, uploads, real-paper fixtures, private reports, agent caches, node_modules, .venv and dist were NOT copied. Initial baseline snapshot is locally committed. No changes to the old repo or owner data. Work in this repo only; generated assets/tools/cache/tests/artifacts use repo-local ignored folders. Root AGENTS.md governs this work.
Read AGENTS.md, DELIVERY.md, ARCHITECTURE.md and backend/deploy/README.md before editing. Preserve the RECENT question-bank bulk review and exam-builder select-all features, including their semantics, verification flags, partial-failure retry and unit/browser tests. Do not recreate an older baseline. Existing DELIVERY.md references old turn results: they are inherited, not new installer proof. Inspect app/.github/workflows/pages.yml before editing; there may not yet be a root workflow.

## Repository and execution boundaries
- Git is local only. Local commits are authorized for milestones. No git remote, push, repo creation, release upload, public Pages deploy, public tunnel, DNS changes, firewall opening or new account/domain credential acquisition.
- Keep all eight turns' work scopes, do not reset accepted turns or other task rows. ALFRD manages handoffs/state; never hand-edit .alfrd/plans or replace incoming archived handoffs.
- Shell commands prefixed with rtk; rtk proxy for unsupported commands. Downloads must use official sources, pin versions/checksums/licenses; never pipe network scripts into an unsandboxed shell. Docker build/test containers must use only disposable/repo scoped mounts; no privileged containers, host-root mounts or Docker socket mounts inside a container.
- No default real passwords, credential secrets in code/logs/builds, live owner DB destructive tests, paid service, public download of private papers, or auto-start public tunnels. Use disposable test accounts/data and redact secrets. Test credentials remain fixture-local and cannot initialize a real production owner.
- Keep app/data outside installation. Upgrades/uninstall preserve persistent data by default; explicit destructive reset requires confirmation and must not happen during exams.

## Architecture and packaging
Choose a practical approach in Turn 1 and explain it in PACKAGING.md, then implement it. Favor an approach that can actually create Windows and .deb packages locally. Electron with a strictly isolated launcher renderer plus a bundled Python runtime/backend is a plausible cross-platform option; a simpler native shell is acceptable if both target artifacts can be built. Avoid unnecessary UI/backend rewrites. No Python, Node, uv, terminal, global pip, or manual service setup required on the OWNER'S laptop. Bundle needed runtime, built admin assets, migration SQL, OCR assets/fonts/PDF workers and a platform-correct cloudflared if supported.
If using Electron: contextIsolation=true, nodeIntegration=false, renderer sandbox enabled; narrowly typed/validated IPC, no arbitrary command/path API, no credentials exposed to student content, reject remote navigation/new windows except vetted external URLs in system browser. If using Python freezing: PyInstaller is not a general Windows cross-compiler; use real native builds or a separately bundled Windows runtime/wheel payload. If bundling CPython Windows embeddable, vendor all third-party libraries into the payload at build time and configure _pth; never require pip on the owner's machine. Verify correct x64 wheels/ABI, Windows-compatible uvicorn dependencies, licenses, runtime import/search paths, SQLite/migrations/assets. Linux packaging must target a documented glibc baseline; not accidentally link to this host's newer libraries and claim all Ubuntu support. Windows 10 support must match chosen Electron/runtime versions.
Use explicit --publish never or equivalent for packaging. Installer signatures are optional without a provided certificate; disclose unsigned Windows SmartScreen warning, never pretend signed. No automatic application-update network channel until owner opts into a real reviewed publication path.

## Owner launcher — working GUI, not terminal instructions
- Start/Stop server; Open admin; backend/tunnel state; Open data/log folders; full Backup/Restore; clear awake/online warning during exams.
- Packaged launcher must launch bundled runtime with absolute resource paths, not system python/node/uv and not current-working-dir assumptions. Handle spaces/Unicode user paths on both OSs.
- First-run GUI: create owner account without default password, confirm password with existing server policy, no echoes or secret log entries. Configure exact student origin, public HTTPS API hostname and private tunnel config/credentials with clear deferred/account steps. Give a usable local admin flow before tunnel setup.
- Normal OS app-data paths outside install dir (Windows per-user AppData, Linux XDG data/config/log directories), private permissions/Windows ACL strategy, config validation and atomic writes. Owner's Windows installation need not require admin privileges if feasible. .deb installation privileges are normal and documented.
- One launcher/backend instance per profile; lock + process identity, reliable stop/cleanup/restart, no blind kill of unrelated PID/port user. Show friendly port-conflict diagnostics and preserve DB when restart/upgrade. On app close warn when an exam may be active; define close/minimize policy.
- Reuse actual existing backup/restore recovery code: stop ALL managed writers first; include database plus source PDFs/manifest; retain pre-restore data; revoke sessions as existing mechanisms do; backups exclude credentials by default. Trusted-bundle/clear confirmation, path traversal/symlink/integrity rejection, no restoration during active exams. Do not simply tar a live WAL database.
- Server/tunnel status must reflect real process + readiness/probe evidence, not a green icon after spawn. Running cloudflared != remotely connected. Distinguish not configured, running, verified connectivity, failed/offline. Never log tokens or full secret command args.

## Local admin / public student separation
Laptop runs current FastAPI/SQLite/admin site locally. Students on separate static site reach ONLY student API over stable HTTPS tunnel. Expose exactly /api/v1 and its descendants; 404 for /admin, /api/admin, source files, docs, health paths outside public API and all other routes. Preserve exact-origin CORS, authentication, cookie/session/CSRF, server time/cutoff/grading/release behavior.
Prefer defense-in-depth student-only local gateway/listener so a tunnel misconfiguration cannot expose owner/admin routes; preserve existing ingress template with final http_status:404. Validate canonical, encoded/traversal and boundary paths (/api/v10 must not match /api/v1). All public listener and tunnel processes bind loopback locally, no inbound firewall ports. Route credentials stored privately outside repo/install public assets; GUI may select/import local credential file with ownership checks, not require chat secrets. Account/domain login/setup requires owner interaction; provide a guide, not invented credentials. No unattended live tunnel activation.
Additional laptops need separate backend addresses + student-site build config unless an explicit tested server selector is implemented. Do not silently add cross-laptop synchronization or reuse one database across machines. Awake/online requirement visible in GUI/docs; optional scoped sleep inhibitor only while owner enables serving and explain its limits.

## GitHub Pages preparation only
Inspect existing workflow. Root workflow must build/publish only student dist, correct APP_DIR=app, repository BASE_PATH and public HTTPS API Actions variable. Never upload admin dist/backend/runtime/installers/data/source originals/tunnel credentials as Pages assets. Exact GitHub Pages origin (no repo path) in CORS. Provide owner instructions for Pages source=Actions, variables, repository name/base and stable API. Hostname/domain and repo URL placeholders are NOT real user details. Public deploy and remote Actions remain unperformed.
Before any future push/publication perform source/staged/build secret/private-data audit. Supply repeatable audit script/tests with a fail-closed allowlist/manifest, detect .env/secrets/key files, SQLite/uploads/real-paper corpora/tokens, and separate public student assets from installable private-backend code. No remote creation in this run.

## Verification — actual results, never live data
- Produce release/*.exe Windows x64 installer and release/*.deb Linux amd64 (or documented artifact dir) with SHA-256, version, sizes, dependency/resource manifest/licenses and reproducible commands.
- Verify Linux fresh installation/application-menu entry/GUI launch in a disposable environment without devtools; actual first-run -> restart -> simulated upgrade -> data persists -> uninstall preserves data. Extraction alone is not install verification. Test non-root owner, port conflict and duplicate instance.
- Windows: build actual installer locally if cross-tooling works, inspect shortcuts/runtime payload and perform best available launch/install smoke. Native Windows 10/11 clean install is required before claiming native verified; if unavailable record exact unperformed checks and a runnable Windows test procedure. Do not let optional macOS consume time.
- Packaged app regression: upload synthetic paper -> bulk-review original questions -> exam select-all/partial/filter clear behavior -> verified keys -> draft/publish -> two isolated student browsers join/answer/submit -> timeout -> backend restart -> release results -> full backup/restore. Use packaged runtime/backend/admin, not dev-only stack as sole proof. Protect original source tests and rerun them.
- Public gateway/ingress tests return 404 for admin/source/docs/encoded bypasses; allowed API and exact-origin browser CORS work, disallowed origin fails; API payload/bundle never leaks keys before release. Actual cloudflared ingress validator/rule checks when binary bundled. No actual public account/domain claims.
- Cross-origin static production site served under /practice-institute/ separately from packaged API; workers/fonts/OCR route assets resolve, no frontend secrets. Regenerate native runtime builds under controlled clean env; all tests disposable.
- Inspect desktop GUI screenshots and error/first-run/backup/tunnel screens; don't claim a modern nontechnical launcher from a CLI alone.
- DELIVERY.md must distinguish artifact built, unpacked smoke, installed/runtime tested, native-OS verified, deferred/blocked. Include exact commands/counts, owner remaining account/domain/signing steps and no fabricated output. Local repo commit/status/diff checks; no private data tracked.

## Eight turns — Sonnet is low-level and tightly guided
1. Claude: audit current app and preservation tests, choose architecture/Windows-first local-build plan, define concrete launcher/runtime/IPC interfaces and bite-sized tickets in PACKAGING.md/PROGRESS.md. Start implementation, not planning-only. Give explicit file paths, API contracts, tests and acceptance to subsequent Codex/Sonnet turns.
2. Codex: runtime/lifecycle/platform data storage/locks/owner setup/backup integration and secure local student gateway, automated tests. Establish working launcher bridge and package resource layout for Sonnet; do not leave it to invent architecture.
3. Claude Sonnet (model sonnet): implement guided launcher UI/form/status/error panels, shortcut/icon metadata fixtures and unit/component tests under the established contract. Follow incoming concrete ticket paths; if uncertain, document question for next senior turn, don't redesign security/packaging. Exercise GUI and preserve bulk review/select-all behavior.
4. Codex: Windows-first installer/runtime payload and Linux .deb packaging pipelines, actual local builds, pinned downloads/license/hash audit and smoke tests. Prefer usable artifact before embellishment; document native Windows test limits.
5. Claude: inspect installer/GUI integration and public/local trust boundary; fix primary Windows and Linux issues, run packaged owner + two-student browser flows; guide next Sonnet with explicit low-level fixes/tests/docs.
6. Claude Sonnet (model sonnet): well-scoped owner onboarding/tunnel-step guide, backup/restore/status UI refinements, documentation and scripted shortcut/config regression tests. Do not start public tunnels/deploy or change global security rules. Actual tests/screenshots and concise handoff.
7. Codex: adversarial packaged tests (first run/restart/upgrade/preserve data/uninstall/port collision/symlink/secret/path boundaries), real Linux install rehearsal, Windows artifact validation/best available runtime tests, fix issues and repeat audit/build hashes.
8. Claude: final integration, actual artifact existence + packaged behavior verification and screenshots, DELIVERY.md/owner guide/reproducibility/account steps, final local commits and checklist. Fix residual defects; no instructions requiring a ninth turn just to produce installers.
Each turn reads this task and RESEARCH.md, preserves all partial work, executes real checks and writes ALFRD handoff sections (Goal, What was completed, Files changed, Checks and results, Instructions for next agent, Acceptance criteria, Blockers). No AGY. All acceptance gaps remain explicit. Commit local meaningful milestones only after scope/security audit; never stage caches/data/secrets/artifacts with a blind git add .

## Original supplied prompt (requirements preserved verbatim)

Work on the existing Practice Institute project. Read AGENTS.md,
DELIVERY.md, ARCHITECTURE.md and backend/deploy/README.md first.
Preserve the recent question-bank bulk review and exam select-all changes.

Goal:
Create an installable admin/backend application for a laptop, with the
student website hosted separately on GitHub Pages.

My details:
- Target operating system and architecture: [e.g. Windows 11 x64]
- GitHub repository: [URL, or not created yet]
- Student site: https://[USERNAME].github.io/practice-institute/
- Backend hostname: https://api.[DOMAIN]
- Cloudflare/domain setup: [ready / not ready]

Architecture:
- The laptop runs the existing FastAPI backend, SQLite database and
  admin webpage.
- Admin access stays local to the laptop.
- Students use GitHub Pages and reach only the student API through a
  stable HTTPS Cloudflare Tunnel.
- The laptop must remain awake and online during exams.

Implement the following:

1. An installer for the target operating system that bundles the
   required runtime, backend, built admin interface and required assets.
   A nontechnical owner must not need Python, Node, uv or a terminal
   installed to run it. Choose a practical packaging approach and
   explain the choice briefly.

2. A small launcher with:
   - Start and stop server
   - Open admin
   - Backend and tunnel connection status
   - Open data/log folders
   - Full backup and restore using the existing recovery mechanisms
   - Clear instructions about keeping the laptop awake during exams

3. First-run setup:
   - Create the owner account without a default password.
   - Store configuration and persistent data in the operating system's
     normal application-data directory, outside the installation folder.
   - Keep passwords, database, PDFs and tunnel credentials out of
     GitHub, public builds and logs.
   - Prevent duplicate backend instances and explain port conflicts.
   - Upgrades must preserve data. Uninstall must preserve it by default.

4. Cloudflare Tunnel integration:
   - Guide the owner through account/domain setup and credential entry.
   - Expose only /api/v1 and its child routes.
   - Return 404 for /admin, /api/admin, source files and other routes.
   - Preserve the existing origin restrictions and security settings.
   - Explain that additional laptops need separate backend addresses
     and student-site configuration unless an explicit switching
     mechanism is implemented.

5. GitHub Pages:
   - Inspect the existing deployment workflow before changing it.
   - Build and publish only the student distribution.
   - Configure the correct repository base path and HTTPS API address.
   - Configure backend CORS for the exact GitHub Pages origin.
   - Audit the repository and deployment artifacts for private data
     before any push or publication.
   - Document the exact GitHub settings and variables required.

6. Verify:
   - Clean install on the target OS without development tools.
   - First-run setup, restart, upgrade and data preservation.
   - Upload a paper, bulk-review questions, select all in the exam
     builder, create a draft and publish with verified answer keys.
   - Two separate student browsers can join, answer and submit.
   - Timeout, backend restart, result release and backup/restore work.
   - Public access to admin routes and source PDFs is blocked.
   - Never use the owner's live database for destructive tests.

Deliver:
- Installer artifact and reproducible packaging scripts.
- Simple owner instructions for installation and publishing.
- Updated DELIVERY.md with actual verification results and limitations.
- A list of any remaining account/domain steps I must perform.
