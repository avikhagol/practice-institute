# Owner deployment and recovery

Local acceptance is complete separately from public hosting. No DNS, tunnel, cloud resource or GitHub deployment has been created. The owner chooses a domain and explicitly performs the public steps below after a private two-user rehearsal.

## Run locally

Use Node ≥22.13, uv and the locked dependencies. From `app/`, run `rtk npm ci`, `rtk npm run build:admin`, and optionally `rtk npm run assets:ocr:download` before rebuilding admin to include the pinned OCR models. From `backend/`, run `rtk uv sync --locked`, copy `.env.example` to a private `.env`, and load it into the shell. Set `PI_ALLOWED_ORIGINS=http://127.0.0.1:4317` for a production preview. Run `rtk uv run pi-admin migrate`, `rtk uv run pi-admin setup` interactively, then `rtk uv run pi-admin serve`. Open `http://127.0.0.1:8787/admin/`. Only the first setup creates an owner; `setup --add` creates an editor. Passwords are never build variables.

In another terminal under `app/`, run `rtk npm run build:pages`, then `rtk npm run preview -- --base /practice-institute/ --host 127.0.0.1 --port 4317 --strictPort`. Keep `--base`: without it the preview answers asset URLs with the HTML page and students see a blank screen. Students use `http://127.0.0.1:4317/practice-institute/`. `localhost` and `127.0.0.1` are different browser origins; the allowlist must match exactly. Stop each server with Ctrl-C. Restart the API after building admin for the first time.

Keep the backend machine awake and connected for the entire cohort. SQLite writes serialize in a single API process; do not run multiple uvicorn workers. Resume secrets are private bearer credentials. Aliases are not verified identities or proctoring. Rate limits are per IP, held in memory and reset on process restart; a large shared school IP may need an owner-adjusted join limit before the exam.

## Cutoff and outage policy

A save or first submit is accepted only while active, after start, and while server time **at the transaction's open check** is ≤ `deadline_at + PI_SUBMIT_GRACE_MS` (default 2000ms). This check runs after obtaining SQLite's write lock; requests queued behind another write can miss the cutoff. No client timestamp is trusted. The grace cannot prove that a request was already in flight; it is a uniform server allowance. The student UI stops editing at the displayed deadline. First submit applies its changes atomically and grades once; repeat submit returns the first finish and ignores later changes. Exact cutoff is inclusive; one millisecond later is rejected/finalized as timeout. Expiry records the stored deadline as finish time, including when swept after an outage. Extensions do not reopen finished or already-overdue attempts; expiry rechecks extensions under the same write lock.

Pending browser edits are not server acknowledgements. During API loss, leave the browser data intact, reconnect before cutoff and wait for ACK. Offline submit cannot claim success. After a cutoff, unacknowledged changes remain a visible lost-change warning. If the host restarts, the same database retains deadlines and accepted answers; the sweeper resumes. Restoring an older backup rolls back to that backup's answers and deadlines; do not restore during an active exam.

## Full private backup and restore

Stop the backend and every other writer before **full** backup or any restore. The desktop runtime and full recovery CLI share a stable writer guard; full recovery refuses a running managed desktop profile. This does not detect a legacy `serve` process or external SQLite writers, which must still be stopped. Prefer the default layout `PI_DB_PATH=PI_DATA_DIR/practice-institute.sqlite3`; full commands require this layout. Choose an absolute backup directory outside `PI_DATA_DIR` (and not its parent). From `backend/` with the same private environment loaded:

```bash
rtk uv run pi-admin backup --full /absolute/private/backups/cohort-before
rtk uv run pi-admin restore --full /absolute/private/backups/cohort-before
```

A full bundle contains a SQLite backup, uploaded PDFs and SHA-256 manifest. It refuses overwrites; missing/corrupt PDFs, unexpected files, symlinks, checksum errors and database/foreign-key failures abort before replacing live data. The complete previous data directory is kept as `data.pre-restore-<timestamp>`. Restoring elsewhere rewrites absolute source paths, preserves owner password hashes, snapshots, tokens, answers and deadlines, and revokes admin sessions. Log in again after restart. POSIX bundle/staged-data permissions are owner-only (directory 0700, files 0600). Checksums detect damage, not malicious replacement: restore only a trusted private bundle. Backups contain personal aliases, attempt token hashes, answer keys and restricted originals; use private encrypted storage and never upload them to Pages or a public repo. The bundle excludes environment/tunnel credentials, OCR browser caches and builds; retain private configuration separately and rebuild assets from locks.

The existing `backup file.sqlite3` remains a consistent online **database-only** backup. It does not include sources, and DB-only restore does not relocate source paths. Do not delete its pre-restore copy or a full pre-restore directory until a rehearsal confirms owner login, source download, attempt resume, saved answers and expected grade. Test recovery on a separate stopped copy first. For custom `PI_DB_PATH`, use the DB-only command plus a stopped private sources copy and manually reconcile paths.

## Owner-only public steps

Use a named Cloudflare Tunnel on the owner machine with a domain the owner controls. Follow [Cloudflare's locally managed tunnel creation instructions](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/create-local-tunnel/); this may require cloudflared installation and account login, which were not performed here. Copy `cloudflared.example.yml` to a private config, fill the UUID, credential path and API hostname. Keep the credentials outside this project.

**Installed desktop app:** do not use `cloudflared.example.yml`. It targets the owner listener (8787), which also serves the admin app. The launcher writes its own tunnel config for the student-only public listener (default 8788). For a hand-written desktop config, start from `cloudflared.desktop.example.yml` and check it with `packaging/scripts/check-ingress.sh`. Never point a tunnel at the owner port.

The template routes only `/api/v1` paths to loopback and returns 404 for everything else, leaving `/admin/`, `/api/admin` and authenticated original-source downloads local. Never replace the student-only rule with a catch-all backend mapping. Cloudflare documents ordered hostname/path matching, full-path forwarding and the required final rule in its [configuration reference](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/configuration-file/). Before creating DNS/running the tunnel, validate locally:

```bash
rtk proxy cloudflared tunnel --config /absolute/private/config.yml ingress validate
rtk proxy cloudflared tunnel --config /absolute/private/config.yml ingress rule https://api.your-domain.example/api/v1/health
rtk proxy cloudflared tunnel --config /absolute/private/config.yml ingress rule https://api.your-domain.example/admin/
rtk proxy cloudflared tunnel --config /absolute/private/config.yml ingress rule https://api.your-domain.example/api/admin/me
```

The first URL must match the loopback rule; the other two must match 404. The owner then creates the DNS mapping and starts the named tunnel using Cloudflare's documented commands. No quick tunnel is used here. Keep the owner admin on local HTTP with `PI_COOKIE_SECURE=false`; if independently exposing admin over HTTPS, that is a separate reviewed setup requiring access controls, same-origin behavior and `PI_COOKIE_SECURE=true`. Do not expose admin through this template.

Set `PI_ALLOWED_ORIGINS=https://YOUR-USER.github.io` (origin only, no `/practice-institute/`) before restarting the backend. `PI_TRUST_PROXY_HEADERS` stays false for local use. Enable it only if the owner accepts the local proxy trust boundary and all public traffic comes through the owned tunnel; a local client can spoof forwarding headers. For the installed desktop only, `StudentGateway` marks public requests internally and uses a valid `CF-Connecting-IP` for student rate limiting even with this toggle off. Both sockets are explicitly bound to `127.0.0.1`; uvicorn proxy processing is disabled. The owner listener never uses `CF-Connecting-IP`. The public listener trusts that header from **any local caller**, not only cloudflared: another process/user on the laptop can spoof or rotate it and bypass IP rate limits. This is a best-effort abuse limit, not authentication. Do not share the serving laptop with untrusted local users or proxy arbitrary client-supplied CF headers into it. An invalid CF header falls back to the peer (or the existing X-Forwarded-For opt-in); it grants no Cloudflare identity. The legacy CLI listener with the toggle off still shares the proxy's rate bucket. No inbound firewall port is required by this template.

For GitHub Pages, follow `app/README.md` and set repository **Actions variable** `VITE_PI_API_BASE=https://api.your-domain.example`. It is a public URL, never a secret. The workflow refuses an unset/non-HTTPS origin, injects it into the student bundle and CSP, and uses the repository subpath. A local release build is `rtk proxy env VITE_PI_API_BASE=https://api.your-domain.example npm run build:pages`. Publish only `app/dist/`, never backend data, fixtures/real, reports, admin bundle or tunnel credentials. Changing the API origin requires a rebuild.

After owner deployment, verify allowed-origin join/save/submit in the public browser, disallowed-origin failure, public admin 404, source originals inaccessible, asset URLs/PDF worker and Hindi fonts at the Pages subpath, and actual HTTPS behavior. These public/domain/tunnel checks remain unperformed. Local browser CORS and asset checks are evidence for the implementation, not proof of public infrastructure.
