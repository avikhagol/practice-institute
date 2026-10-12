// Guided owner launcher UI (PACKAGING.md §9). Talks to the backend only through the PiApi bridge.
import type { LauncherState, PiApi, Result } from '../shared/ipc';
import {
  KEEP_AWAKE_DETAIL, KEEP_AWAKE_WARNING, MISSING_LABEL, OWNER_ERRORS, PUBLIC_RULE,
  recoveryBlock, serverBadge, serverProblem, settingsError, settingsLocked, tunnelBadge, type Badge,
} from './copy';
import { h } from './dom';

interface Screen { el: HTMLElement; update(s: LauncherState): void }
type Page = 'home' | 'setup' | 'tunnel' | 'backup' | 'help';
const PAGES: Array<[Page, string]> = [['home', 'Home'], ['setup', 'Setup'], ['tunnel', 'Tunnel'], ['backup', 'Backup'], ['help', 'Help']];

export interface Launcher { go(page: Page): void; dispose(): void }

function badgeEl(b: Badge): HTMLElement {
  return h('span', { class: `badge ${b.tone}` }, h('span', { 'aria-hidden': 'true' }, b.icon), ` ${b.word}`);
}

function describe(r: Result<unknown>): string {
  if (r.ok) return '';
  if (r.code === 'busy') return 'Another action is in progress. Try again in a moment.';
  return r.message || 'That did not work. Please try again.';
}

export function mountLauncher(root: HTMLElement, pi: PiApi, initial: LauncherState): Launcher {
  let state = initial;
  let page: Page = 'home';
  let firstRunStep: 0 | 1 | 2 = initial.ownerExists ? 0 : 1;
  const screens = new Map<string, Screen>();

  // ---- shared widgets -------------------------------------------------
  const notice = () => h('p', { class: 'notice', role: 'status', 'aria-live': 'polite' });
  const say = (el: HTMLElement, text: string, bad = false) => { el.textContent = text; el.className = bad ? 'notice bad' : 'notice'; };
  const button = (label: string, onClick: () => void, kind: 'primary' | 'secondary' | 'danger' = 'secondary') => {
    const b = h('button', { type: 'button', class: kind }, label);
    b.addEventListener('click', onClick);
    return b;
  };
  /** Runs an action; shows failures in `out`. Returns the result. */
  async function act<T>(out: HTMLElement, fn: () => Promise<Result<T>>, okText = ''): Promise<Result<T>> {
    say(out, '');
    const r = await fn();
    if (r.ok) say(out, okText); else if (r.code !== 'cancelled') say(out, describe(r), true);
    return r;
  }
  function reason(id: string): HTMLElement { return h('p', { id, class: 'hint' }); }
  function setDisabled(btn: HTMLButtonElement, why: string | null, hintEl: HTMLElement) {
    btn.disabled = why !== null;
    if (why !== null) btn.setAttribute('aria-describedby', hintEl.id); else btn.removeAttribute('aria-describedby');
    hintEl.textContent = why ?? '';
  }
  function field(id: string, label: string, type: string, hint?: string) {
    const input = h('input', { id, type, name: id, autocomplete: 'off', spellcheck: 'false' });
    const err = h('p', { id: `${id}-error`, class: 'field-error', role: 'alert' });
    const describedBy = [hint ? `${id}-hint` : '', `${id}-error`].filter(Boolean).join(' ');
    input.setAttribute('aria-describedby', describedBy);
    const wrap = h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('p', { id: `${id}-hint`, class: 'hint' }, hint) : null, err);
    const setError = (text: string) => { err.textContent = text; if (text) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); };
    return { wrap, input, setError };
  }

  // ---- first run ------------------------------------------------------
  function firstRun(): Screen {
    const el = h('section', { 'aria-labelledby': 'fr-title' });
    const username = field('owner-username', 'Username', 'text');
    username.input.setAttribute('autocomplete', 'username');
    const password = field('owner-password', 'Password', 'password', 'At least 12 characters.');
    password.input.setAttribute('autocomplete', 'new-password');
    const confirm = field('owner-confirm', 'Confirm password', 'password');
    confirm.input.setAttribute('autocomplete', 'new-password');
    const live = h('p', { class: 'hint', 'aria-live': 'polite' });
    const show = h('input', { id: 'owner-show', type: 'checkbox' });
    show.addEventListener('change', () => { const t = show.checked ? 'text' : 'password'; password.input.type = t; confirm.input.type = t; });
    password.input.addEventListener('input', () => {
      live.textContent = password.input.value.length >= 12 ? '✔ Long enough.' : `${password.input.value.length} of 12 characters.`;
    });
    const formError = h('p', { class: 'notice bad', role: 'alert' });
    const create = button('Create account', () => void submit(), 'primary');
    async function submit() {
      [username, password, confirm].forEach(f => f.setError(''));
      formError.textContent = '';
      const r = await pi.createOwner({ username: username.input.value, password: password.input.value, confirm: confirm.input.value });
      if (r.ok) {
        password.input.value = ''; confirm.input.value = ''; show.checked = false; show.dispatchEvent(new Event('change')); live.textContent = '';
        firstRunStep = 2; render();
        return;
      }
      confirm.input.value = ''; password.input.value = ''; live.textContent = '';
      const known = OWNER_ERRORS[r.code];
      if (!known) { formError.textContent = describe(r); return; }
      if (known.field === 'form') formError.textContent = known.text; else ({ username, password, confirm })[known.field].setError(known.text);
    }
    const step1 = h('div', {},
      h('h2', {}, 'Step 1 of 2 · Create owner account'),
      h('p', {}, 'This account signs in to the admin site on this laptop. Nobody else can use it.'),
      username.wrap, password.wrap, live, h('label', { class: 'inline', for: 'owner-show' }, show, ' Show passwords'), confirm.wrap, formError, create);
    // Step 2
    const origin = field('fr-origin', "Students' website address", 'url', 'Example: https://YOUR-NAME.github.io');
    const host = field('fr-host', 'Public API hostname', 'text', 'Example: api.YOUR-DOMAIN');
    const out = notice();
    const save = button('Save and continue', async () => {
      origin.setError(''); host.setError('');
      const r = await pi.saveSettings({ studentOrigin: origin.input.value.trim(), publicApiHost: host.input.value.trim() });
      if (r.ok) { firstRunStep = 0; page = 'home'; render(); return; }
      if (r.code === 'invalid-studentOrigin') origin.setError('Enter an address like https://YOUR-NAME.github.io'); else if (r.code === 'invalid-publicApiHost') host.setError('Enter a name like api.YOUR-DOMAIN'); else say(out, settingsError(r.code, r.message), true);
    }, 'primary');
    const later = button('Set up later', () => { firstRunStep = 0; page = 'home'; render(); });
    const step2 = h('div', {},
      h('h2', {}, 'Step 2 of 2 · Students\' website'),
      h('p', {}, 'Optional. Your admin site already works on this laptop. You can add these later in Setup.'),
      origin.wrap, host.wrap, out, h('div', { class: 'row' }, save, later));
    const body = h('div', {});
    el.append(h('h1', { id: 'fr-title' }, 'Welcome to Practice Institute'), body);
    return {
      el,
      update() {
        // Only swap steps when the step changes, so typed text survives state pushes.
        const want = firstRunStep === 1 ? step1 : step2;
        if (body.firstChild !== want) body.replaceChildren(want);
      },
    };
  }

  // ---- home -----------------------------------------------------------
  function home(): Screen {
    const el = h('section', { 'aria-labelledby': 'home-title' }, h('h1', { id: 'home-title' }, 'Home'));
    const banner = h('div', { class: 'banner', role: 'note' }, h('strong', {}, KEEP_AWAKE_WARNING));
    const serverCard = h('div', { class: 'card' });
    const tunnelCard = h('div', { class: 'card' });
    const problem = h('div', { class: 'problem', role: 'alert' });
    const out = notice();
    const start = button('Start server', () => void act(out, () => pi.startServer()), 'primary') as HTMLButtonElement;
    const stop = button('Stop server', () => void act(out, () => pi.stopServer())) as HTMLButtonElement;
    const admin = button('Open admin', () => void act(out, () => pi.openAdmin()), 'primary') as HTMLButtonElement;
    const data = button('Open data folder', () => void act(out, () => pi.openFolder('data')));
    const logs = button('Open logs folder', () => void act(out, () => pi.openFolder('logs')));
    const adminWhy = reason('admin-why');
    el.append(banner, h('div', { class: 'cards' }, serverCard, tunnelCard), problem, h('div', { class: 'row' }, start, stop, admin), adminWhy, h('div', { class: 'row' }, data, logs), out);
    return {
      el,
      update(s) {
        const sb = serverBadge(s.server);
        serverCard.replaceChildren(h('h2', {}, 'Server'), badgeEl(sb));
        tunnelCard.replaceChildren(h('h2', {}, 'Tunnel'), badgeEl(tunnelBadge(s.tunnel)));
        const running = s.server.kind === 'running';
        banner.hidden = !running;
        start.disabled = !(s.server.kind === 'stopped' || s.server.kind === 'failed');
        stop.disabled = !(running || s.server.kind === 'probing');
        setDisabled(admin, running ? null : 'Open admin becomes available when the server is Running.', adminWhy);
        const p = serverProblem(s.server);
        problem.hidden = !p;
        if (p) {
          const kids: Array<HTMLElement | null> = [h('h2', {}, p.title), h('p', {}, p.body)];
          if (p.changePort) kids.push(button('Change port', () => go('setup')));
          if (p.logTail.length) kids.push(h('pre', { class: 'log', tabindex: '0', 'aria-label': 'Recent log lines' }, p.logTail.join('\n')));
          kids.push(button('Open logs', () => void act(out, () => pi.openFolder('logs'))));
          problem.replaceChildren(...kids.filter((k): k is HTMLElement => k !== null));
        } else problem.replaceChildren();
      },
    };
  }

  // ---- setup ----------------------------------------------------------
  function setup(): Screen {
    const el = h('section', { 'aria-labelledby': 'setup-title' }, h('h1', { id: 'setup-title' }, 'Setup'));
    const ownerPort = field('set-owner-port', 'Admin port (this laptop only)', 'number');
    const publicPort = field('set-public-port', 'Student port (this laptop only)', 'number');
    const origin = field('set-origin', "Students' website address", 'url', 'Example: https://YOUR-NAME.github.io');
    const host = field('set-host', 'Public API hostname', 'text', 'Example: api.YOUR-DOMAIN');
    const awake = h('input', { id: 'set-awake', type: 'checkbox' });
    const awakeLabel = h('label', { class: 'inline', for: 'set-awake' }, awake, ' Keep this laptop awake while serving');
    const out = notice();
    const lockedWhy = reason('setup-why');
    let loaded = false;
    const fill = (v: LauncherState['settings']) => {
      ownerPort.input.value = String(v.ownerPort); publicPort.input.value = String(v.publicPort);
      origin.input.value = v.studentOrigin; host.input.value = v.publicApiHost; awake.checked = v.keepAwakeWhileServing;
    };
    const save = button('Save settings', async () => {
      [ownerPort, publicPort, origin, host].forEach(f => f.setError(''));
      const r = await pi.saveSettings({
        ownerPort: Number(ownerPort.input.value), publicPort: Number(publicPort.input.value),
        studentOrigin: origin.input.value.trim(), publicApiHost: host.input.value.trim(), keepAwakeWhileServing: awake.checked,
      });
      if (r.ok) { fill(r.value); say(out, 'Settings saved.'); return; }
      const map: Record<string, typeof origin | undefined> = { 'invalid-ownerPort': ownerPort, 'invalid-publicPort': publicPort, 'invalid-studentOrigin': origin, 'invalid-publicApiHost': host };
      const target = map[r.code];
      if (target) target.setError(settingsError(r.code, '')); else say(out, settingsError(r.code, r.message), true);
    }, 'primary') as HTMLButtonElement;
    el.append(
      h('p', {}, 'Changes can be saved only while the server and tunnel are stopped.'), lockedWhy,
      ownerPort.wrap, publicPort.wrap, origin.wrap, host.wrap, awakeLabel,
      h('p', { class: 'hint' }, KEEP_AWAKE_DETAIL), h('div', { class: 'row' }, save), out);
    return {
      el,
      update(s) {
        if (!loaded) { fill(s.settings); loaded = true; }
        const locked = settingsLocked(s);
        for (const i of [ownerPort.input, publicPort.input, origin.input, host.input, awake]) i.disabled = locked;
        setDisabled(save, locked ? 'Stop the server and tunnel to change settings.' : null, lockedWhy);
      },
    };
  }

  // ---- tunnel ---------------------------------------------------------
  function tunnel(): Screen {
    const el = h('section', { 'aria-labelledby': 'tunnel-title' }, h('h1', { id: 'tunnel-title' }, 'Tunnel'));
    const out = notice();
    const status = h('div', { class: 'card' });
    const checklist = h('ol', { class: 'checklist' });
    const details = h('p', {});
    const detail = h('p', { class: 'hint', role: 'status' });
    const startWhy = reason('tunnel-why');
    const importBtn = button('Import credentials file', async () => {
      const r = await act(out, () => pi.importTunnelCredentials());
      if (r.ok) say(out, 'Credentials imported.');
    });
    const startBtn = button('Start tunnel', () => void act(out, () => pi.startTunnel()), 'primary') as HTMLButtonElement;
    const stopBtn = button('Stop tunnel', () => void act(out, () => pi.stopTunnel())) as HTMLButtonElement;
    const verifyBtn = button('Verify', async () => {
      const r = await act(out, () => pi.verifyTunnel());
      if (r.ok) say(out, r.value.kind === 'verified' ? 'Verified: students can reach the exam API.' : 'Not verified yet. Check the status above.');
    }) as HTMLButtonElement;
    el.append(
      h('p', { class: 'rule' }, PUBLIC_RULE), status,
      h('h2', {}, 'Setup checklist'),
      h('ol', { class: 'steps' },
        h('li', {}, 'Create a free Cloudflare account and add your domain. ', button('Open guide', () => void act(out, () => pi.openGuide('cloudflare-tunnel')))),
        h('li', {}, 'Create a tunnel in Cloudflare and download its credentials file.'),
        h('li', {}, 'Import the credentials file below. Only the tunnel ID is shown here.'),
        h('li', {}, 'Enter your public API hostname and students\' address in Setup.')),
      checklist, details, h('div', { class: 'row' }, importBtn), startWhy, h('div', { class: 'row' }, startBtn, stopBtn, verifyBtn), detail, out);
    return {
      el,
      update(s) {
        const t = s.tunnel;
        status.replaceChildren(h('h2', {}, 'Tunnel status'), badgeEl(tunnelBadge(t)));
        const missing = t.kind === 'not-configured' ? t.missing : [];
        checklist.replaceChildren(...(['hostname', 'tunnel-id', 'credentials', 'student-origin'] as const).map(k =>
          h('li', {}, missing.includes(k) ? '○ Missing: ' : '✔ Done: ', MISSING_LABEL[k])));
        details.textContent = `Tunnel ID: ${s.settings.tunnelId || 'not set'} · Hostname: ${s.settings.publicApiHost || 'not set'}`;
        detail.textContent = t.kind === 'failed' ? `Problem: ${t.reason}. ${t.detail}` : t.kind === 'connected' ? `${t.connections} connection(s) to Cloudflare. Press Verify to confirm students can reach the API.` : t.kind === 'running-unverified' ? 'The tunnel process is running, but it is not connected or verified yet.' : '';
        const tunnelUp = t.kind === 'starting' || t.kind === 'running-unverified' || t.kind === 'connected' || t.kind === 'verified';
        const startWhyText = t.kind === 'not-configured' ? 'Finish the checklist above first.' : s.server.kind !== 'running' ? 'Start the server on Home first.' : null;
        setDisabled(startBtn, tunnelUp ? 'The tunnel is already started.' : startWhyText, startWhy);
        if (tunnelUp) startWhy.textContent = '';
        stopBtn.disabled = !tunnelUp;
        verifyBtn.disabled = !(t.kind === 'running-unverified' || t.kind === 'connected' || t.kind === 'verified' || (t.kind === 'failed' && t.reason === 'verify-failed'));
        importBtn.disabled = tunnelUp;
      },
    };
  }

  // ---- backup ---------------------------------------------------------
  function backup(): Screen {
    const el = h('section', { 'aria-labelledby': 'backup-title' }, h('h1', { id: 'backup-title' }, 'Backup'));
    const out = notice();
    const why = reason('backup-why');
    const last = h('p', {});
    const backupBtn = button('Back up now (choose folder)', async () => {
      const r = await act(out, () => pi.backup());
      if (r.ok) say(out, `Backup saved in folder “${r.value.folderName}”.`);
      else if (r.code === 'inside-data-dir') say(out, 'Choose a folder outside the Practice Institute data folder.', true);
    }, 'primary') as HTMLButtonElement;
    const restoreBtn = button('Restore from backup…', () => { confirmBox.hidden = false; typed.value = ''; confirmBtn.disabled = true; typed.focus(); }) as HTMLButtonElement;
    const typed = h('input', { id: 'restore-typed', type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'restore-help' });
    const confirmBtn = button('Choose backup folder and restore', async () => {
      const text = typed.value;
      typed.value = ''; confirmBtn.disabled = true;
      const r = await pi.restore(text);
      confirmBox.hidden = true;
      if (r.ok && r.value.restarted === false) say(out, 'Your data was restored. The server did not start — choose Start.');
      else if (r.ok) say(out, `Restored. Your previous data was kept in “${r.value.previousDataFolder}”. Admin sign-ins were reset.`);
      else if (r.code === 'cancelled') say(out, '');
      else if (r.code === 'exam-active') say(out, 'Restore stopped: an exam is active. Nothing was changed.', true);
      else if (r.code === 'not-confirmed') say(out, 'Restore was not confirmed. Nothing was changed.', true);
      else say(out, 'Restore failed. Your current data was not replaced.', true);
    }, 'danger') as HTMLButtonElement;
    confirmBtn.disabled = true;
    typed.addEventListener('input', () => { confirmBtn.disabled = typed.value !== 'RESTORE'; });
    const cancelBtn = button('Cancel', () => { confirmBox.hidden = true; typed.value = ''; });
    const confirmBox = h('div', { class: 'confirm', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'restore-title', hidden: true },
      h('h2', { id: 'restore-title' }, 'Restore a backup?'),
      h('p', { id: 'restore-help' }, 'Your current data will be replaced by the backup and kept in a “pre-restore” folder. Admin sign-ins are reset. Type RESTORE to continue.'),
      h('label', { for: 'restore-typed' }, 'Type RESTORE'), typed, h('div', { class: 'row' }, confirmBtn, cancelBtn));
    el.append(h('p', {}, 'A full backup copies exams, students, answers and uploads to a folder you choose. Keep it somewhere safe and private.'), why, h('div', { class: 'row' }, backupBtn, restoreBtn), confirmBox, last, out);
    return {
      el,
      update(s) {
        const block = recoveryBlock(s.activity);
        backupBtn.disabled = block !== null; restoreBtn.disabled = block !== null;
        why.textContent = block ?? '';
        if (block !== null) { backupBtn.setAttribute('aria-describedby', why.id); restoreBtn.setAttribute('aria-describedby', why.id); confirmBox.hidden = true; typed.value = ''; }
        else { backupBtn.removeAttribute('aria-describedby'); restoreBtn.removeAttribute('aria-describedby'); }
        last.textContent = s.lastBackup ? `Last backup: ${new Date(s.lastBackup.at).toLocaleString()} (folder “${s.lastBackup.folderName}”).` : 'No backup has been made yet.';
      },
    };
  }

  // ---- help -----------------------------------------------------------
  function help(): Screen {
    const out = notice();
    const el = h('section', { 'aria-labelledby': 'help-title' },
      h('h1', { id: 'help-title' }, 'Help'),
      h('h2', {}, 'During an exam'), h('p', {}, KEEP_AWAKE_WARNING),
      h('p', {}, KEEP_AWAKE_DETAIL),
      h('h2', {}, 'More than one laptop'), h('p', {}, 'Run the server on only one laptop per profile. Each laptop needs its own public API hostname and its own student website build.'),
      h('h2', {}, 'Unsigned installer'), h('p', {}, 'This installer is not code-signed, so Windows or your system may show a warning the first time. Install it only from the file you built or received from the project owner.'),
      h('h2', {}, 'Where your data lives'), h('p', {}, 'Exams, students and uploads are stored in your user profile, outside the program folder. Uninstalling or upgrading keeps them.'),
      h('div', { class: 'row' },
        button('Open data folder', () => void act(out, () => pi.openFolder('data'))),
        button('Open backups folder', () => void act(out, () => pi.openFolder('backups'))),
        button('Open logs folder', () => void act(out, () => pi.openFolder('logs')))),
      h('div', { class: 'row' },
        button('Cloudflare tunnel guide', () => void act(out, () => pi.openGuide('cloudflare-tunnel'))),
        button('GitHub Pages guide', () => void act(out, () => pi.openGuide('github-pages')))),
      out);
    return { el, update() {} };
  }

  // ---- shell ----------------------------------------------------------
  const nav = h('nav', { 'aria-label': 'Main' });
  const main = h('main', { id: 'main' });
  root.replaceChildren(nav, main);

  function screenFor(key: string): Screen {
    let s = screens.get(key);
    if (!s) {
      s = key === 'first-run' ? firstRun() : ({ home, setup, tunnel, backup, help } as Record<string, () => Screen>)[key]();
      screens.set(key, s);
    }
    return s;
  }
  let shown = '';
  function render() {
    const key = firstRunStep ? 'first-run' : page;
    nav.hidden = firstRunStep !== 0;
    if (!nav.hidden) {
      nav.replaceChildren(...PAGES.map(([id, label]) => {
        const b = h('button', { type: 'button', class: 'nav', 'aria-current': id === page ? 'page' : undefined }, label);
        b.addEventListener('click', () => go(id));
        return b;
      }));
    }
    const screen = screenFor(key);
    screen.update(state);
    if (shown !== key + firstRunStep) { main.replaceChildren(screen.el); shown = key + firstRunStep; }
  }
  function go(p: Page) { page = p; render(); }

  render();
  const off = pi.onState(next => {
    state = next;
    if (firstRunStep === 0 || firstRunStep === 1) { if (next.ownerExists && firstRunStep === 1) firstRunStep = 2; }
    // Hidden screens stay mounted so typed text survives; refresh them, then show the current one.
    for (const s of screens.values()) s.update(state);
    render();
  });
  return { go, dispose: off };
}
