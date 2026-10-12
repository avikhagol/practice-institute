# Practice Institute — Owner Guide (DRAFT)

> Draft for the owner. Items in `<angle brackets>` are values only you can supply
> (your domain, tunnel name, website address). Nothing here has been run on a
> native Windows 10/11 machine yet; see DELIVERY.md for what was verified.

Daily use needs no Python, Node, developer tools or terminal. Public hosting needs a one-time setup helper; the launcher does not create Cloudflare tunnels or publish the website.

## 1. Install

**Windows 10 / 11 (64-bit)**
1. Copy the `Practice-Institute-Setup-<version>-x64.exe` file you were given onto the laptop.
2. Before opening it, compare its SHA-256 fingerprint with the `SHA256SUMS` file delivered
   alongside it (your setup helper can do this once).
3. Double-click it. The installer is not code-signed, so Windows will usually show
   **Windows protected your PC** (an unknown-publisher warning). Choose **More info**, then
   **Run anyway** only if you received the file from the project owner or built it yourself
   and the fingerprint matched. (This warning has not yet been checked on a real Windows
   10/11 laptop; the exact wording may differ.)
4. Follow the steps. It installs for your user account only and needs no administrator
   password. Start it from the Start menu: **Practice Institute**.

**Ubuntu / Debian (64-bit)**
1. Double-click the `practice-institute_<version>_amd64.deb` file and choose **Install**
   in the Software app (or right-click → Open With → Software Install).
2. Open **Practice Institute** from the applications menu.

## 2. First run: create the owner account

The first time, the window asks you to create the owner account.
1. Choose a username.
2. Choose a password of at least 12 characters and type it twice.
3. Select **Create account**. Write the password down somewhere safe; it cannot be recovered for you.
4. The optional **Students' website** step follows. Choose **Set up later** to use local admin now, or fill in your addresses and choose **Save and continue**.

## 3. Start and stop

- **Start server** starts the server on this laptop. Wait until the badge says **✔ Running**.
- **Open admin** opens the admin pages in your browser. Sign in with the owner account.
- **Stop server** stops the server (and the tunnel, if it is on).
- Closing the window while the server or tunnel is running asks whether to stop, keep running in the background, or cancel.

## 4. Status badges

Every status shows a symbol and a word, so you do not have to rely on colour.

| Badge | Meaning |
|---|---|
| ■ Stopped | Not running. |
| … Starting / Stopping | Wait a moment. |
| ✔ Running | The server is ready. |
| ⚠ Problem | Something failed. Read the message; another program may be using a port, or a restart is needed. |
| ○ Not set up (tunnel) | Tunnel details are still missing. |
| ◐ Running – not verified (tunnel) | Tunnel is up but not yet checked. |
| ✔ Connected (tunnel) | Cloudflared reports a connection; public access has not yet been checked. |
| ✔ Verified (tunnel) | The public HTTPS health check passed and the public admin check returned 404. Rehearse with students before an exam. |

If the server stops unexpectedly, the tunnel is stopped automatically so the managed connection closes.

## 5. Keep the laptop awake

During an exam, keep this laptop **awake, plugged in and online** until every student has submitted.
Sleep, closing the lid, losing Wi-Fi or restarting the laptop all cut students off from the exam for everyone.
With **Keep this laptop awake while serving** enabled in Setup, the app asks the system not to sleep while the server runs. It cannot prevent lid-close sleep, Wi-Fi loss or system-update reboots.
Run the server on **only one laptop per profile**.
Each additional serving laptop needs its own public API hostname and student website build.

### Before every real exam

1. Laptop plugged in, online, lid open; sleep and automatic restarts postponed.
2. **Home** shows **✔ Running**; **Tunnel** shows **✔ Verified** (press **Verify** again today).
3. One quick test join to a short practice exam (not the real one) from a phone on mobile data, using the student website address.
4. A fresh backup taken (section 6) while no exam is open.
5. After the last student submits: release results, then take another backup.

## 6. Backup and restore

Backups and restores are only allowed when **no exam is open and no student is still taking one**.
The Backup screen tells you when that is the case.

- **Back up:** choose **Back up now (choose folder)**, pick a folder *outside* the Practice Institute data folder.
  A dated sub-folder holds a full copy of exams, students, answers and uploads. Keep it private.
- **Restore:** choose **Restore from backup…**, type `RESTORE`, pick a backup folder you trust.
  Your current data is kept in a "pre-restore" folder next to the data folder, and admin sign-ins are reset.
  If the server does not start again afterwards, your data was still restored. Choose **Start server**.

## 7. Let students in (tunnel and student website)

Students use a separately hosted student website and reach only the student part of the server
through a Cloudflare tunnel that **you** create. This app never creates accounts or changes DNS for you.
Use these placeholders for your own values:

1. Choose your Cloudflare account, domain `<your-domain>`, tunnel name `<tunnel-name>` and GitHub repository `<your-repository>`. Keep account sign-in and approvals under your control.
2. Ask your setup helper to prepare a **locally managed named tunnel** and its private `<tunnel-id>.json` credentials file, following [Cloudflare's guide](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/create-local-tunnel/). The current app imports that file; it cannot use a dashboard connector token. The helper handles the one-time command steps and DNS mapping for `api.<your-domain>`. Never paste credentials into chat or the repository. No public setup has been performed in this delivery.
3. In **Setup**, enter **Public API hostname** (`api.<your-domain>`) and **Students' website address** (`https://<your-github-name>.github.io`, without the repository path), then choose **Save settings**. Stop the server and tunnel before changing settings.
4. In **Tunnel**, choose **Import credentials file** and select the private JSON file. The app reads the tunnel ID from the file; there is no separate tunnel-ID input. It generates a rule pointing only at the loopback student port.
5. Ask the helper to prepare and publish the student website using the root `.github/workflows/pages.yml`: Pages source **GitHub Actions**, public Actions variable `VITE_PI_API_BASE=https://api.<your-domain>`, repository `<your-repository>`. Publish only student `app/dist` assets. Exact developer steps are in [the packaging README](../packaging/README.md#publicprivate-audit-and-prepared-pages-workflow); these steps were not performed here.
6. On **Home**, choose **Start server**. On **Tunnel**, choose **Start tunnel**, then **Verify**. A connected badge alone is not proof students can reach it. Rehearse a complete exam using two separate student browsers at `https://<your-github-name>.github.io/<your-repository>/` before a real session.

Use a serving laptop whose local accounts and software you trust. A local process can forge the student IP header used for rate limiting; the limiter does not authenticate students.

**Never tunnel the owner port.** The admin pages and owner login must stay on this laptop only.
The tunnel must point only at the student port shown in Setup. The app's template already does this;
do not change it to the owner port.

## 8. Uninstall and where your data lives

Uninstalling or upgrading keeps your data. To remove it you must delete the folders yourself.

| | Windows | Ubuntu / Debian |
|---|---|---|
| Settings | `%APPDATA%\Practice Institute\config\` | `~/.config/practice-institute/` |
| Data (exams, students, uploads) | `%LOCALAPPDATA%\Practice Institute\data\` | `~/.local/share/practice-institute/data/` |
| Logs | `%LOCALAPPDATA%\Practice Institute\logs\` | `~/.local/state/practice-institute/logs/` |
| Default backups | `Documents\Practice Institute Backups\` | `~/Practice Institute Backups/` |

The **Help** screen has buttons that open the data, backups and logs folders for you.
Take a backup before deleting anything.
