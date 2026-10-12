import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn() }, shell: { openExternal: vi.fn(), openPath: vi.fn() } }));
import { dialog, shell } from 'electron';
import { Bridge, trustedSender } from '../src/main/ipc';
import { ConfigStore } from '../src/main/config';
import type { Runtime } from '../src/main/runtime';
import type { Tunnel } from '../src/main/tunnel';
import { IPC } from '../src/shared/ipc';
let dir: string;
beforeEach(() => { vi.clearAllMocks(); dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-ipc-test ')); });
afterEach(() => fs.rmSync(dir, { force: true, recursive: true }));
function fixture(activity = { active_attempts: 0, open_exams: 0 }) {
  const dirs = { config: dir, data: path.join(dir, 'data'), tunnel: dir, logs: dir, backups: dir };
  const command = vi.fn(async () => ({ code: 0, stdout: JSON.stringify(activity) }));
  const runtime = Object.assign(new EventEmitter(), { child: null, status: { kind: 'stopped' }, command, start: vi.fn(), stop: vi.fn() }) as unknown as Runtime;
  const tunnel = { child: null, status: { kind: 'not-configured', missing: [] }, refresh: vi.fn(), stop: vi.fn(), start: vi.fn() } as unknown as Tunnel;
  const store = new ConfigStore(path.join(dir, 'config.json'), dir);
  const bridge = new Bridge(store, dirs, runtime, tunnel, () => ({} as BrowserWindow), 'test', vi.fn(), vi.fn());
  return { bridge, command, runtime, tunnel, store };
}
it('trusts only the exact launcher main frame and webContents', () => {
  const frame = { url: 'file:///launcher/index.html' }, contents = { mainFrame: frame };
  const win = { webContents: contents } as unknown as BrowserWindow;
  const event = { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  expect(trustedSender(event, win, frame.url)).toBe(true);
  expect(trustedSender({ ...event, senderFrame: { url: frame.url } } as IpcMainInvokeEvent, win, frame.url)).toBe(false);
  expect(trustedSender(event, win, 'https://attacker.example/')).toBe(false);
  expect(trustedSender({ ...event, sender: {} } as IpcMainInvokeEvent, win, frame.url)).toBe(false);
});
it.each([
  [IPC.createOwner, [{ username: 'o', password: 'secret', confirm: 1 }]],
  [IPC.createOwner, [{ username: 'o', password: 'secret', confirm: 'secret', command: 'exec' }]],
  [IPC.createOwner, []], [IPC.openFolder, ['/etc']], [IPC.confirmQuit, ['kill']],
  [IPC.openGuide, ['https://attacker.example']], [IPC.startServer, [true]],
])('rejects invalid payload %s without spawning or opening paths', async (channel, args) => {
  const { bridge, command } = fixture();
  expect(await bridge.run(channel, args)).toMatchObject({ ok: false });
  expect(command).not.toHaveBeenCalled(); expect(shell.openPath).not.toHaveBeenCalled(); expect(shell.openExternal).not.toHaveBeenCalled();
});
it.each([{ active_attempts: 1, open_exams: 0 }, { active_attempts: 0, open_exams: 1 }])('refuses recovery before showing dialogs while activity exists %j', async activity => {
  const { bridge, runtime } = fixture(activity);
  expect(await bridge.run(IPC.backup, [])).toMatchObject({ code: 'exam-active', ok: false });
  expect(await bridge.run(IPC.restore, ['RESTORE'])).toMatchObject({ code: 'exam-active', ok: false });
  expect(dialog.showOpenDialog).not.toHaveBeenCalled(); expect(runtime.stop).not.toHaveBeenCalled();
});
it('requires confirmation, fails closed on unreadable activity, and serializes mutation', async () => {
  const { bridge, command } = fixture();
  expect(await bridge.run(IPC.restore, ['no'])).toMatchObject({ code: 'not-confirmed' });
  expect(command).not.toHaveBeenCalled();
  command.mockResolvedValue({ code: 1, stdout: 'sensitive raw process output' });
  const result = await bridge.run(IPC.backup, []);
  expect(result).toMatchObject({ code: 'activity-unavailable', ok: false }); expect(JSON.stringify(result)).not.toContain('sensitive');
  bridge.busy = true; expect(await bridge.run(IPC.startServer, [])).toMatchObject({ code: 'busy' });
  expect(await bridge.run(IPC.getState, [])).toHaveProperty('server');
});
it('waits for an existing background probe before starting a foreground action', async () => {
  const { bridge, runtime } = fixture();
  let release!: () => void;
  bridge.background = new Promise<void>(resolve => { release = resolve; });
  const operation = bridge.run(IPC.startServer, []);
  expect(runtime.start).not.toHaveBeenCalled();
  release();
  await operation;
  expect(runtime.start).toHaveBeenCalledOnce();
});
it('withholds the placeholder owner snapshot until startup initialization completes', async () => {
  const { bridge } = fixture();
  bridge.initializing = true;
  let returned = false;
  const snapshot = bridge.run(IPC.getState, []).then(state => { returned = true; return state; });
  await new Promise(resolve => setTimeout(resolve, 35));
  expect(returned).toBe(false);
  bridge.ownerExists = true;
  bridge.initializing = false;
  expect(await snapshot).toHaveProperty('ownerExists', true);
});
it('stops the tunnel once when the runtime exits unexpectedly, not on intentional stop', () => {
  const { runtime, tunnel } = fixture();
  vi.mocked(tunnel.stop).mockResolvedValue();
  runtime.emit('closed', false);
  expect(tunnel.stop).not.toHaveBeenCalled();
  runtime.emit('closed', true);
  expect(tunnel.stop).toHaveBeenCalledOnce();
});
it('reports a successful restore with restarted:false when the restart fails', async () => {
  const { bridge, runtime, command } = fixture();
  fs.mkdirSync(path.join(dir, 'data'));
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-backup '));
  try {
    (runtime as unknown as { status: unknown }).status = { kind: 'running' };
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [backup] } as never);
    vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 1 } as never);
    vi.mocked(runtime.start).mockRejectedValue(new Error('crashed'));
    command.mockImplementation((async (args: string[]) => ({ code: 0, stdout: args[0] === 'owner-status' ? JSON.stringify({ owner_exists: true }) : JSON.stringify({ active_attempts: 0, open_exams: 0 }) })) as never);
    const result = await bridge.run(IPC.restore, ['RESTORE']);
    expect(result).toMatchObject({ ok: true, value: { restarted: false } });
    expect(runtime.start).toHaveBeenCalledOnce();
  } finally { fs.rmSync(backup, { recursive: true, force: true }); }
});
it('no longer exposes awake or multiple-laptops guide topics', async () => {
  const { bridge } = fixture();
  for (const topic of ['awake', 'multiple-laptops']) expect(await bridge.run(IPC.openGuide, [topic])).toMatchObject({ ok: false });
  expect(shell.openExternal).not.toHaveBeenCalled();
});
