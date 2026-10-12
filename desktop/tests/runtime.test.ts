import { it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { Runtime, type Launch } from '../src/main/runtime';
import { defaults } from '../src/main/config';
import { Logs } from '../src/main/logs';
import type { ServerStatus } from '../src/shared/ipc';

async function free(): Promise<number> { return new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); }); }); }
it('real isolated backend transitions, setup stdin, owned stop, conflicts and duplicate profile', async () => {
  const root = path.resolve('../packaging/output/runtime-linux');
  const launch: Launch = { root, python: path.join(root, 'python/bin/python3'), admin: path.join(root, 'admin') };
  expect(fs.existsSync(launch.python)).toBe(true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'Runtime üñ test '));
  const dirs = { config: dir, tunnel: dir, data: path.join(dir, 'data üñ'), logs: dir, backups: dir };
  const c = { ...defaults, ownerPort: await free(), publicPort: await free() };
  const logs = new Logs(path.join(dir, 'backend.log'));
  const r = new Runtime(launch, dirs, () => c, logs);
  const states: ServerStatus['kind'][] = []; r.on('state', s => states.push(s.kind));
  let second: Runtime | null = null, conflict: Runtime | null = null;
  try {
    expect(JSON.parse((await r.command(['owner-status'])).stdout).owner_exists).toBe(false);
    const password = 'Synthetic-🔒-' + Math.random().toString(36).slice(2) + '-test';
    const created = await r.command(['setup-owner', '--stdin-json'], JSON.stringify({ username: 'synthetic-owner', password, confirm: password }) + '\n');
    expect(JSON.parse(created.stdout).ok).toBe(true); expect(created.stdout).not.toContain(password);
    await r.start(); expect(r.status.kind).toBe('running'); expect(states.slice(0, 3)).toEqual(['starting', 'probing', 'running']);
    const login = await fetch(`http://127.0.0.1:${c.ownerPort}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'synthetic-owner', password }) });
    expect(login.status).toBe(200); await login.body?.cancel();
    expect(JSON.parse((await r.command(['exam-activity'])).stdout)).toEqual({ active_attempts: 0, open_exams: 0 });
    second = new Runtime(launch, dirs, () => ({ ...c, ownerPort: c.ownerPort + 1, publicPort: c.publicPort + 1 }), logs);
    await expect(second.start()).rejects.toThrow('already-running'); expect(second.status).toMatchObject({ reason: 'already-running' });
    conflict = new Runtime(launch, { ...dirs, data: path.join(dir, 'other data') }, () => c, logs);
    await expect(conflict.start()).rejects.toThrow('port-in-use'); expect(conflict.status).toMatchObject({ reason: 'port-in-use', port: c.ownerPort, listener: 'owner' });
    const ownPid = r.child!.pid; expect(ownPid).toBeGreaterThan(0);
    await r.stop(); expect(r.child).toBeNull(); expect(r.status.kind).toBe('stopped');
    await r.start(); expect(r.status.kind).toBe('running'); await r.stop();
    expect(logs.tail.join('\n')).not.toContain(password);
  } finally { await second?.stop(); await conflict?.stop(); await r.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
}, 60_000);
