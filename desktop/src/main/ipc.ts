import { ipcMain, dialog, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { ConfigStore, publicSettings, applySettings, credentialInfo, atomicWrite, object, keys } from './config';
import { inside, type ProfilePaths } from './paths';
import { Runtime } from './runtime';
import { Tunnel } from './tunnel';
import { IPC, type LauncherState, type ExamActivity, type Result } from '../shared/ipc';

export function trustedSender(event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>, win: BrowserWindow, rendererUrl: string): boolean {
  return event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && event.senderFrame?.url === rendererUrl;
}
export const guides = {
  'cloudflare-tunnel': 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/',
  'github-pages': 'https://docs.github.com/en/pages',
} as const;
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const errorMessages: Record<string, string> = {
  'port-in-use': 'Another program is using a configured port. Close it or choose different ports in Setup.',
  'already-running': 'Practice Institute is already running for this profile.',
  'server-running': 'Stop the server and tunnel before changing settings.',
  'exam-active': 'An exam is open or an attempt is active. Wait until exams have closed and students have finished.',
  'not-confirmed': 'Type RESTORE to confirm restoration of a trusted backup.',
  busy: 'Another launcher operation is in progress.', cancelled: 'Cancelled.',
};
export class Bridge {
  ownerExists = false;
  activity: ExamActivity | null = null;
  lastBackup: LauncherState['lastBackup'] = null;
  keepAwakeActive = false;
  busy = false;
  initializing = false;
  background: Promise<void> | null = null;
  constructor(readonly store: ConfigStore, readonly dirs: ProfilePaths, readonly runtime: Runtime, readonly tunnel: Tunnel, readonly win: () => BrowserWindow, readonly version: string, readonly changed: () => void, readonly quit: (choice: string) => Promise<void>) {
    // An unexpected runtime exit must not leave the tunnel exposing a dead backend.
    // Intentional stops already stop the tunnel themselves (stop/recover/quit paths).
    runtime.on('closed', (unexpected: boolean) => { if (unexpected) void this.tunnel.stop().catch(() => {}); });
  }
  state(): LauncherState {
    return { version: this.version, platform: process.platform as LauncherState['platform'], ownerExists: this.ownerExists,
      activity: this.initializing ? null : this.activity, lastBackup: this.lastBackup, keepAwakeActive: this.keepAwakeActive,
      settings: publicSettings(this.store.value), server: this.runtime.status, tunnel: this.tunnel.status };
  }
  async refresh(): Promise<void> {
    const r = await this.runtime.command(['owner-status']);
    if (r.code !== 0) throw new Error('config');
    const data = JSON.parse(r.stdout);
    if (typeof data.owner_exists !== 'boolean') throw new Error('config');
    this.ownerExists = data.owner_exists; await this.checkActivity(); this.changed();
  }
  async checkActivity(): Promise<ExamActivity> {
    const r = await this.runtime.command(['exam-activity']);
    if (r.code !== 0) { this.activity = null; throw new Error('activity-unavailable'); }
    const data = JSON.parse(r.stdout);
    if (![data.active_attempts, data.open_exams].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('activity-unavailable');
    this.activity = { activeAttempts: data.active_attempts, openExams: data.open_exams, checkedAt: Date.now() };
    this.changed(); return this.activity;
  }
  async run(channel: string, args: unknown[]): Promise<unknown> {
    if (channel === IPC.getState) {
      if (args.length) throw new Error('bad-input');
      // The renderer's first snapshot chooses onboarding versus Home. Do not
      // expose the placeholder ownerExists=false before owner-status completes.
      // Initialization's bounded CLI commands always clear this flag in main's finally.
      while (this.initializing) await new Promise<void>(resolve => setTimeout(resolve, 25));
      return this.state();
    }
    // Wait for an already-started read-only activity probe; don't reject a click
    // merely because a periodic background check currently has database handles.
    if (this.background) await this.background;
    if (this.busy) return { ok: false, code: 'busy', message: errorMessages.busy };
    this.busy = true;
    try { return await this.operation(channel, args); }
    catch (err) {
      // Never send raw exceptions, filesystem content, passwords or subprocess output to renderer.
      const raw = err instanceof Error ? err.message : '';
      const code = /^[a-z][a-zA-Z-]{0,40}$/.test(raw) ? raw : 'failed';
      return { ok: false, code, message: errorMessages[code] || `Operation failed (${code}). Check your configuration and private logs.` };
    } finally { this.busy = false; this.changed(); }
  }
  pollActivity(): void {
    if (this.busy || this.background) return;
    const pending = this.checkActivity().then(() => {}).catch(() => { this.activity = null; this.changed(); });
    this.background = pending;
    void pending.finally(() => { if (this.background === pending) this.background = null; });
  }
  private async operation(channel: string, args: unknown[]): Promise<unknown> {
    const one = [IPC.openFolder, IPC.createOwner, IPC.saveSettings, IPC.restore, IPC.openGuide, IPC.confirmQuit].includes(channel as never);
    if (args.length !== (one ? 1 : 0)) throw new Error('bad-input');
    const c = this.store.value;
    switch (channel) {
      case IPC.startServer: await this.runtime.start(); await this.refresh(); return ok(undefined);
      case IPC.stopServer: await this.tunnel.stop(); await this.runtime.stop(); await this.checkActivity(); return ok(undefined);
      case IPC.openAdmin:
        if (this.runtime.status.kind !== 'running') throw new Error('server-stopped');
        await shell.openExternal(`http://127.0.0.1:${c.ownerPort}/admin/`); return ok(undefined);
      case IPC.openFolder: {
        if (!['config', 'data', 'logs', 'backups'].includes(String(args[0])) || typeof args[0] !== 'string') throw new Error('bad-input');
        const result = await shell.openPath(this.dirs[args[0] as 'config' | 'data' | 'logs' | 'backups']);
        if (result) throw new Error('open-failed'); return ok(undefined);
      }
      case IPC.createOwner: {
        const input = object(args[0]); keys(input, ['username', 'password', 'confirm']);
        for (const key of ['username', 'password', 'confirm']) if (typeof input[key] !== 'string' || (input[key] as string).length > (key === 'username' ? 64 : 4096)) throw new Error('bad-input');
        let payload: string | undefined = JSON.stringify(input) + '\n';
        const pending = this.runtime.command(['setup-owner', '--stdin-json'], payload);
        payload = undefined; input.password = ''; input.confirm = ''; args[0] = undefined;
        const r = await pending;
        const data = JSON.parse(r.stdout);
        const codes = ['created', 'bad-input', 'bad-username', 'mismatch', 'weak-password', 'owner-exists'];
        if (!codes.includes(data.code) || typeof data.ok !== 'boolean') throw new Error('failed');
        if (!data.ok) return { ok: false, code: data.code, message: { 'bad-input': 'Enter a username and both password fields.', 'bad-username': 'Username must contain 1–64 printable characters.', mismatch: 'Passwords do not match.', 'weak-password': 'Password must contain at least 12 characters.', 'owner-exists': 'An owner account already exists.' }[data.code as string] || 'Account creation failed.' };
        await this.refresh(); return ok(undefined);
      }
      case IPC.saveSettings: {
        if (this.runtime.child || this.tunnel.child) throw new Error('server-running');
        this.store.save(applySettings(c, args[0], this.dirs.tunnel)); this.tunnel.refresh(); return ok(publicSettings(this.store.value));
      }
      case IPC.importTunnelCredentials: {
        if (this.tunnel.child) throw new Error('tunnel-running');
        const selected = await dialog.showOpenDialog(this.win(), { title: 'Import named tunnel credentials', properties: ['openFile'], filters: [{ name: 'Tunnel JSON', extensions: ['json'] }] });
        if (selected.canceled || selected.filePaths.length !== 1) throw new Error('cancelled');
        const source = selected.filePaths[0], info = credentialInfo(source);
        const target = path.join(this.dirs.tunnel, info.TunnelID.toLowerCase() + '.json');
        atomicWrite(target, fs.readFileSync(source, 'utf8'));
        const next = structuredClone(c); next.tunnel = { mode: 'named', tunnelId: info.TunnelID, credentialsFile: target };
        this.store.save(next); this.tunnel.refresh(); return ok({ tunnelId: info.TunnelID });
      }
      case IPC.startTunnel:
        if (this.runtime.status.kind !== 'running') throw new Error('server-stopped');
        await this.tunnel.start(); return ok(undefined);
      case IPC.stopTunnel: await this.tunnel.stop(); return ok(undefined);
      case IPC.verifyTunnel: return ok(await this.tunnel.verify());
      case IPC.backup: return this.recover(false);
      case IPC.restore:
        if (args[0] !== 'RESTORE') throw new Error('not-confirmed');
        return this.recover(true);
      case IPC.openGuide:
        if (typeof args[0] !== 'string' || !Object.hasOwn(guides, args[0])) throw new Error('bad-input');
        await shell.openExternal(guides[args[0] as keyof typeof guides]); return ok(undefined);
      case IPC.confirmQuit:
        if (typeof args[0] !== 'string' || !['stop-and-quit', 'keep-running', 'cancel'].includes(args[0])) throw new Error('bad-input');
        await this.quit(args[0]); return ok(undefined);
      default: throw new Error('bad-input');
    }
  }
  private async recover(restore: boolean): Promise<unknown> {
    const guard = async () => { const a = await this.checkActivity(); if (a.activeAttempts > 0 || a.openExams > 0) throw new Error('exam-active'); };
    await guard();
    const selected = await dialog.showOpenDialog(this.win(), { title: restore ? 'Choose a trusted full backup folder' : 'Choose parent folder for a new full backup', defaultPath: this.dirs.backups, properties: ['openDirectory', 'createDirectory'] });
    if (selected.canceled || selected.filePaths.length !== 1) throw new Error('cancelled');
    const folder = selected.filePaths[0];
    if (fs.lstatSync(folder).isSymbolicLink()) throw new Error('symlink');
    const real = fs.realpathSync(folder), data = fs.realpathSync(this.dirs.data);
    const target = restore ? folder : path.join(real, `Practice-Institute-backup-${Date.now()}`);
    if (inside(real, data) || inside(data, real)) throw new Error('inside-data-dir');
    if (restore) {
      const response = await dialog.showMessageBox(this.win(), { type: 'warning', title: 'Restore trusted backup', message: 'Restore this trusted backup? Current data will be preserved in a pre-restore folder. Admin sessions will be revoked.', buttons: ['Cancel', 'Restore'], defaultId: 0, cancelId: 0 });
      if (response.response !== 1) throw new Error('cancelled');
    }
    const wasRunning = this.runtime.status.kind === 'running';
    await this.tunnel.stop(); await this.runtime.stop();
    let restored: { previousDataFolder: string; restarted?: boolean } | null = null;
    try {
      await guard(); // catch students joining while the folder dialog was open
      const before = new Set(fs.readdirSync(path.dirname(this.dirs.data)));
      const r = await this.runtime.command([restore ? 'restore' : 'backup', '--full', target], undefined, 600_000);
      if (r.code !== 0) throw new Error('failed');
      if (restore) {
        const prefix = path.basename(this.dirs.data) + '.pre-restore-';
        const previous = fs.readdirSync(path.dirname(this.dirs.data)).find(n => n.startsWith(prefix) && !before.has(n));
        await this.refresh(); restored = { previousDataFolder: previous || '' }; return ok(restored);
      }
      this.lastBackup = { at: Date.now(), folderName: path.basename(target) }; return ok({ folderName: path.basename(target) });
    } finally {
      if (wasRunning) {
        // After a successful restore a failed restart is reported as restarted:false, not as a failed restore.
        try { await this.runtime.start(); }
        catch (err) { if (!restored) throw err; restored.restarted = false; }
      }
    }
  }
}
export function registerIpc(bridge: Bridge, win: BrowserWindow, rendererUrl: string): void {
  for (const channel of Object.values(IPC)) {
    if (channel === IPC.subscribe) continue;
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!trustedSender(event, win, rendererUrl)) return { ok: false, code: 'untrusted-sender', message: 'Untrusted launcher frame.' };
      return bridge.run(channel, args);
    });
  }
}
