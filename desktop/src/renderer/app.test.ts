// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LauncherState, PiApi, Result, ServerStatus, TunnelStatus } from '../shared/ipc';
import { mountLauncher, type Launcher } from './app';
import { recoveryBlock, serverBadge, serverProblem, tunnelBadge } from './copy';

const baseState = (over: Partial<LauncherState> = {}): LauncherState => ({
  version: '0.1.0', platform: 'linux', ownerExists: true,
  server: { kind: 'stopped' }, tunnel: { kind: 'not-configured', missing: ['hostname', 'tunnel-id', 'credentials', 'student-origin'] },
  activity: { activeAttempts: 0, openExams: 0, checkedAt: 1 },
  settings: { ownerPort: 8787, publicPort: 8788, studentOrigin: '', publicApiHost: '', tunnelId: '', hasTunnelCredentials: false, trustProxyHeaders: true, keepAwakeWhileServing: true, closeBehavior: 'ask' },
  keepAwakeActive: false, lastBackup: null, ...over,
});
const ok = <T,>(value?: T): Result<T> => ({ ok: true, value: value as T });
const fail = (code: string, message = 'msg'): Result<never> => ({ ok: false, code, message });

let listener: (s: LauncherState) => void = () => {};
let pi: { [K in keyof PiApi]: ReturnType<typeof vi.fn> };
let root: HTMLElement;
let launcher: Launcher;

function makePi() {
  pi = {
    getState: vi.fn(async () => baseState()), onState: vi.fn((l: (s: LauncherState) => void) => { listener = l; return () => {}; }),
    startServer: vi.fn(async () => ok()), stopServer: vi.fn(async () => ok()), openAdmin: vi.fn(async () => ok()), openFolder: vi.fn(async () => ok()),
    createOwner: vi.fn(async () => ok()), saveSettings: vi.fn(async () => ok(baseState().settings)), importTunnelCredentials: vi.fn(async () => ok({ tunnelId: 'x' })),
    startTunnel: vi.fn(async () => ok()), stopTunnel: vi.fn(async () => ok()), verifyTunnel: vi.fn(async () => ok({ kind: 'verified', checkedAt: 1 } as TunnelStatus)),
    backup: vi.fn(async () => ok({ folderName: 'b1' })), restore: vi.fn(async () => ok({ previousDataFolder: 'data.pre-restore-1' })),
    openGuide: vi.fn(async () => ok()), confirmQuit: vi.fn(async () => ok()),
  };
}
function mount(state = baseState()) { launcher = mountLauncher(root, pi as unknown as PiApi, state); }
const flush = () => new Promise(r => setTimeout(r, 0));
const q = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as T;
const btn = (label: string) => Array.from(root.querySelectorAll('button')).find(b => b.textContent === label) as HTMLButtonElement;
function type(input: HTMLInputElement, value: string) { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }
const push = (s: LauncherState) => listener(s);

beforeEach(() => { document.body.innerHTML = '<div id="app"></div>'; root = document.getElementById('app')!; makePi(); });
afterEach(() => { launcher?.dispose(); });

describe('status badges', () => {
  const servers: Array<[ServerStatus, string]> = [
    [{ kind: 'stopped' }, 'Stopped'], [{ kind: 'starting' }, 'Starting'], [{ kind: 'probing', ownerUrl: 'u' }, 'Starting'],
    [{ kind: 'running', ownerUrl: 'u', publicUrl: 'p', since: 1 }, 'Running'], [{ kind: 'stopping' }, 'Stopping'],
    [{ kind: 'failed', reason: 'crashed', logTail: [] }, 'Problem'],
  ];
  it.each(servers)('server %j -> %s with icon and word', (s, word) => {
    const b = serverBadge(s); expect(b.word).toBe(word); expect(b.icon).not.toBe('');
  });
  const tunnels: Array<[TunnelStatus, string]> = [
    [{ kind: 'not-configured', missing: [] }, 'Not set up'], [{ kind: 'stopped' }, 'Stopped'], [{ kind: 'starting' }, 'Starting'],
    [{ kind: 'running-unverified' }, 'Running – not verified'], [{ kind: 'connected', connections: 4 }, 'Connected'],
    [{ kind: 'verified', checkedAt: 1 }, 'Verified'], [{ kind: 'failed', reason: 'exited', detail: 'd' }, 'Problem'],
  ];
  it.each(tunnels)('tunnel %j -> %s', (t, word) => { expect(tunnelBadge(t).word).toBe(word); });

  it('renders badge on Home and does not mark running optimistically', async () => {
    mount();
    expect(q('.cards').textContent).toContain('Stopped');
    btn('Start server').click(); await flush();
    expect(pi.startServer).toHaveBeenCalledOnce();
    expect(q('.cards').textContent).not.toContain('Running');
    push(baseState({ server: { kind: 'running', ownerUrl: 'u', publicUrl: 'p', since: 1 } }));
    expect(q('.cards').textContent).toContain('✔ Running');
  });
});

describe('home', () => {
  it('shows the keep-awake banner only while running and enables Open admin only then', () => {
    mount();
    expect(q('.banner').hidden).toBe(true); expect(btn('Open admin').disabled).toBe(true);
    push(baseState({ server: { kind: 'running', ownerUrl: 'u', publicUrl: 'p', since: 1 } }));
    expect(q('.banner').hidden).toBe(false);
    expect(q('.banner').textContent).toContain('Closing the lid or losing Wi-Fi stops the exam for everyone.');
    expect(btn('Open admin').disabled).toBe(false);
  });
  it('shows port-in-use copy and Change port navigates to Setup', () => {
    mount(baseState({ server: { kind: 'failed', reason: 'port-in-use', port: 8787, listener: 'owner', logTail: [] } }));
    expect(q('.problem').textContent).toContain('Another program is using port 8787. Close it or choose a different port in Setup.');
    btn('Change port').click();
    expect(q('h1').textContent).toBe('Setup');
  });
  it('shows already-running copy', () => {
    expect(serverProblem({ kind: 'failed', reason: 'already-running', logTail: [] })?.body).toBe('Practice Institute is already running for this user.');
  });
  it('shows only the last 20 log lines of a crash as text, not HTML', () => {
    const logTail = Array.from({ length: 30 }, (_, i) => `line ${i}`); logTail[29] = '<img src=x onerror=alert(1)>';
    mount(baseState({ server: { kind: 'failed', reason: 'crashed', logTail } }));
    const pre = q('.log'); expect(pre.textContent!.split('\n')).toHaveLength(20);
    expect(pre.textContent).not.toContain('line 9\n'); expect(pre.querySelector('img')).toBeNull();
  });
  it('reports busy as a retryable message and keeps the screen', async () => {
    pi.startServer.mockResolvedValueOnce(fail('busy', 'raw'));
    mount(); btn('Start server').click(); await flush();
    expect(q('.notice').textContent).toBe('Another action is in progress. Try again in a moment.');
    expect(q('h1').textContent).toBe('Home');
  });
});

describe('first run', () => {
  beforeEach(() => { pi.getState.mockResolvedValue(baseState({ ownerExists: false })); });
  const fill = (u: string, p: string, c: string) => { type(q<HTMLInputElement>('#owner-username'), u); type(q<HTMLInputElement>('#owner-password'), p); type(q<HTMLInputElement>('#owner-confirm'), c); };

  it('shows step 1 without navigation and a live length hint', () => {
    mount(baseState({ ownerExists: false }));
    expect(q('nav').hidden).toBe(true);
    expect(q('h2').textContent).toContain('Create owner account');
    type(q<HTMLInputElement>('#owner-password'), 'short');
    expect(q('.hint[aria-live]').textContent).toBe('5 of 12 characters.');
    type(q<HTMLInputElement>('#owner-password'), 'twelve-chars');
    expect(q('.hint[aria-live]').textContent).toContain('Long enough');
  });
  it('toggles password visibility', () => {
    mount(baseState({ ownerExists: false }));
    const show = q<HTMLInputElement>('#owner-show'); show.checked = true; show.dispatchEvent(new Event('change'));
    expect(q<HTMLInputElement>('#owner-password').type).toBe('text'); expect(q<HTMLInputElement>('#owner-confirm').type).toBe('text');
  });
  const cases: Array<[string, string, string]> = [
    ['bad-username', 'owner-username', 'Choose a username'], ['mismatch', 'owner-confirm', 'The two passwords do not match.'],
    ['weak-password', 'owner-password', 'Use at least 12 characters.'],
  ];
  it.each(cases)('maps %s inline, linked by aria-describedby, and clears passwords', async (code, id, text) => {
    pi.createOwner.mockResolvedValueOnce(fail(code, 'backend text must not be shown'));
    mount(baseState({ ownerExists: false })); fill('owner', 'Correct-horse-1', 'Correct-horse-1');
    btn('Create account').click(); await flush();
    const err = q(`#${id}-error`); expect(err.textContent).toContain(text);
    expect(q(`#${id}`).getAttribute('aria-describedby')).toContain(`${id}-error`); expect(q(`#${id}`).getAttribute('aria-invalid')).toBe('true');
    expect(q<HTMLInputElement>('#owner-password').value).toBe(''); expect(q<HTMLInputElement>('#owner-confirm').value).toBe('');
    expect(root.textContent).not.toContain('backend text');
  });
  it.each([['bad-input', 'Please fill in every field.'], ['owner-exists', 'An owner account already exists on this laptop.']])('shows %s as a form error', async (code, text) => {
    pi.createOwner.mockResolvedValueOnce(fail(code));
    mount(baseState({ ownerExists: false })); fill('owner', 'x', 'x'); btn('Create account').click(); await flush();
    expect(q('.notice.bad').textContent).toBe(text);
  });
  it('sends the typed values, clears the passwords and advances to step 2 then Home', async () => {
    mount(baseState({ ownerExists: false })); fill('owner', 'Correct-horse-1', 'Correct-horse-1');
    btn('Create account').click(); await flush();
    expect(pi.createOwner).toHaveBeenCalledWith({ username: 'owner', password: 'Correct-horse-1', confirm: 'Correct-horse-1' });
    expect(q('h2').textContent).toContain("Students' website");
    expect(root.querySelector('input[type=password]')).toBeNull();
    btn('Set up later').click(); expect(q('h1').textContent).toBe('Home'); expect(q('nav').hidden).toBe(false);
  });
  it('keeps typed text when state pushes arrive', () => {
    mount(baseState({ ownerExists: false })); type(q<HTMLInputElement>('#owner-username'), 'typing');
    push(baseState({ ownerExists: false, activity: null }));
    expect(q<HTMLInputElement>('#owner-username').value).toBe('typing');
  });
});

describe('setup', () => {
  it('saves values and shows field errors; locks while the server runs', async () => {
    mount(); btn('Setup').click();
    type(q<HTMLInputElement>('#set-origin'), 'bad');
    pi.saveSettings.mockResolvedValueOnce(fail('invalid-studentOrigin'));
    btn('Save settings').click(); await flush();
    expect(q('#set-origin-error').textContent).toContain('student origin');
    push(baseState({ server: { kind: 'running', ownerUrl: 'u', publicUrl: 'p', since: 1 } }));
    expect(btn('Save settings').disabled).toBe(true); expect(q<HTMLInputElement>('#set-owner-port').disabled).toBe(true);
    expect(q('#setup-why').textContent).toContain('Stop the server and tunnel');
  });
});

describe('tunnel', () => {
  it('lists missing items, disables Start until configured and the server runs, and states the public rule', () => {
    mount(); btn('Tunnel').click();
    expect(q('.rule').textContent).toContain('Only /api/v1 is public.');
    expect(q('.checklist').textContent).toContain('Missing: Tunnel credentials file');
    expect(btn('Start tunnel').disabled).toBe(true);
    push(baseState({ tunnel: { kind: 'stopped' } }));
    expect(q('#tunnel-why').textContent).toBe('Start the server on Home first.');
    push(baseState({ tunnel: { kind: 'stopped' }, server: { kind: 'running', ownerUrl: 'u', publicUrl: 'p', since: 1 } }));
    expect(btn('Start tunnel').disabled).toBe(false);
  });
  it('does not treat running-unverified or connected as verified', async () => {
    mount(); btn('Tunnel').click();
    push(baseState({ tunnel: { kind: 'running-unverified' } }));
    expect(q('section').textContent).toContain('Running – not verified'); expect(q('section').textContent).not.toContain('✔ Verified');
    expect(btn('Verify').disabled).toBe(false);
    pi.verifyTunnel.mockResolvedValueOnce(ok({ kind: 'connected', connections: 1 }));
    btn('Verify').click(); await flush();
    expect(q('.notice').textContent).toContain('Not verified yet');
  });
});

describe('backup and restore', () => {
  it('is enabled when idle', () => {
    mount(); btn('Backup').click();
    expect(btn('Back up now (choose folder)').disabled).toBe(false); expect(btn('Restore from backup…').disabled).toBe(false);
  });
  it.each([
    [{ activeAttempts: 2, openExams: 0 }, '2 student attempts are in progress'],
    [{ activeAttempts: 0, openExams: 1 }, '1 exam is still open'],
  ])('is disabled with a reason for %j', (a, text) => {
    mount(baseState({ activity: { ...a, checkedAt: 1 } })); btn('Backup').click();
    expect(btn('Back up now (choose folder)').disabled).toBe(true); expect(btn('Restore from backup…').disabled).toBe(true);
    expect(q('#backup-why').textContent).toContain(text);
    expect(btn('Restore from backup…').getAttribute('aria-describedby')).toBe('backup-why');
  });
  it('fails closed when activity is unknown', () => { expect(recoveryBlock(null)).toContain('Checking'); });
  it('requires typing RESTORE exactly, then passes it to pi.restore and clears it', async () => {
    mount(); btn('Backup').click(); btn('Restore from backup…').click();
    const confirm = btn('Choose backup folder and restore'); expect(confirm.disabled).toBe(true);
    const typed = q<HTMLInputElement>('#restore-typed');
    type(typed, 'restore'); expect(confirm.disabled).toBe(true);
    type(typed, 'RESTORE'); expect(confirm.disabled).toBe(false);
    confirm.click(); await flush();
    expect(pi.restore).toHaveBeenCalledExactlyOnceWith('RESTORE');
    expect(typed.value).toBe(''); expect(q('.notice').textContent).toContain('data.pre-restore-1');
  });
  it('tells the owner to choose Start when the restore worked but the server did not restart', async () => {
    pi.restore.mockResolvedValueOnce(ok({ previousDataFolder: 'data.pre-restore-1', restarted: false }));
    mount(); btn('Backup').click(); btn('Restore from backup…').click(); type(q<HTMLInputElement>('#restore-typed'), 'RESTORE'); btn('Choose backup folder and restore').click(); await flush();
    expect(q('.notice').textContent).toBe('Your data was restored. The server did not start — choose Start.');
    expect(q('.notice').getAttribute('role')).toBe('status');
  });
  it('cancelling the confirmation never calls restore', () => {
    mount(); btn('Backup').click(); btn('Restore from backup…').click(); btn('Cancel').click();
    expect(q('.confirm').hidden).toBe(true); expect(pi.restore).not.toHaveBeenCalled();
  });
  it('closes the confirmation if an exam starts meanwhile', () => {
    mount(); btn('Backup').click(); btn('Restore from backup…').click();
    push(baseState({ activity: { activeAttempts: 1, openExams: 1, checkedAt: 2 } }));
    expect(q('.confirm').hidden).toBe(true); expect(btn('Restore from backup…').disabled).toBe(true);
  });
  it('shows exam-active, backup errors and last backup', async () => {
    pi.restore.mockResolvedValueOnce(fail('exam-active')); pi.backup.mockResolvedValueOnce(fail('inside-data-dir'));
    mount(baseState({ lastBackup: { at: Date.UTC(2026, 0, 2), folderName: 'pi-backup-1' } })); btn('Backup').click();
    expect(q('section').textContent).toContain('pi-backup-1');
    btn('Back up now (choose folder)').click(); await flush();
    expect(q('.notice').textContent).toContain('outside the Practice Institute data folder');
    btn('Restore from backup…').click(); type(q<HTMLInputElement>('#restore-typed'), 'RESTORE'); btn('Choose backup folder and restore').click(); await flush();
    expect(q('.notice').textContent).toContain('an exam is active');
  });
});

describe('help', () => {
  it('explains awake limits and opens only typed guides', () => {
    mount(); btn('Help').click();
    expect(q('section').textContent).toContain('Closing the lid or losing Wi-Fi'); expect(q('section').textContent).toContain('Uninstalling or upgrading keeps them.');
    btn('GitHub Pages guide').click(); expect(pi.openGuide).toHaveBeenCalledWith('github-pages');
    expect(q('section').textContent).toContain('only one laptop per profile');
    expect(Array.from(document.querySelectorAll('button')).map(b => b.textContent)).not.toContain('Keeping the laptop awake');
  });
});
