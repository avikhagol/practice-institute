import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { Config } from './config';
import type { ProfilePaths } from './paths';
import type { ServerStatus, ServerFailure } from '../shared/ipc';
import { Logs } from './logs';

export interface Launch { python: string; root: string; admin: string }
export type RuntimeEvent = { event: 'ready'; pid: number; owner_url: string; public_url: string }
  | { event: 'error'; code: 'port-in-use' | 'already-running' | 'config'; port?: number; listener?: 'owner' | 'public' }
  | { event: 'stopping' } | { event: 'stopped'; ok: boolean };
export function parseEvent(line: string): RuntimeEvent | null {
  if (line.length > 8192) return null;
  try {
    const value = JSON.parse(line);
    if (!value || typeof value !== 'object') return null;
    if (value.event === 'ready' && Number.isInteger(value.pid) && value.pid > 0 && typeof value.owner_url === 'string' && typeof value.public_url === 'string') return value;
    if (value.event === 'error' && ['port-in-use', 'already-running', 'config'].includes(value.code)) {
      if (value.code === 'port-in-use' && (!Number.isInteger(value.port) || !['owner', 'public'].includes(value.listener))) return null;
      return { event: 'error', code: value.code, port: value.port, listener: value.listener };
    }
    if (value.event === 'stopping') return { event: 'stopping' };
    if (value.event === 'stopped' && typeof value.ok === 'boolean') return { event: 'stopped', ok: value.ok };
  } catch { /* Malformed process output is not trusted or logged. */ }
  return null;
}
export function runtimeEnv(c: Config, dirs: ProfilePaths, launch: Launch, parent = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LANG']) if (parent[key]) env[key] = parent[key];
  env.PATH = process.platform === 'win32' ? path.join(parent.SystemRoot || 'C:\\Windows', 'System32') : '/usr/bin:/bin';
  return { ...env, PI_DATA_DIR: dirs.data, PI_ADMIN_DIST: launch.admin, PI_ALLOWED_ORIGINS: c.studentOrigin,
    PI_COOKIE_SECURE: 'false', PI_TRUST_PROXY_HEADERS: String(c.trustProxyHeaders), PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1' };
}
export async function statusCode(url: string): Promise<number> {
  const r = await fetch(url, { signal: AbortSignal.timeout(4000), redirect: 'manual', cache: 'no-store' });
  await r.body?.cancel();
  return r.status;
}
export async function probe(owner: string, student: string): Promise<boolean> {
  try { const values = await Promise.all([statusCode(owner + '/api/v1/health'), statusCode(student + '/api/v1/health'), statusCode(student + '/api/admin/me')]); return values[0] === 200 && values[1] === 200 && values[2] === 404; }
  catch { return false; }
}
export class Runtime extends EventEmitter {
  status: ServerStatus = { kind: 'stopped' };
  child: ChildProcessWithoutNullStreams | null = null;
  private monitor: NodeJS.Timeout | null = null;
  private intentional = false;
  private stopFailure: ServerStatus | null = null;
  private probeBusy = false;
  private failures = 0;
  constructor(readonly launch: Launch, readonly dirs: ProfilePaths, readonly config: () => Config, readonly logs: Logs) { super(); }
  private set(status: ServerStatus): void { this.status = status; this.emit('state', status); }
  private fail(reason: ServerFailure, extra: { port?: number; listener?: 'owner' | 'public' } = {}): void { this.set({ kind: 'failed', reason, ...extra, logTail: [...this.logs.tail] }); }
  async start(): Promise<void> {
    if (this.child) throw new Error('server-running');
    if (!path.isAbsolute(this.launch.python) || !fs.existsSync(this.launch.python)) { this.fail('runtime-missing'); throw new Error('runtime-missing'); }
    const c = this.config();
    this.intentional = false; this.stopFailure = null; this.failures = 0;
    this.set({ kind: 'starting' });
    const child = spawn(this.launch.python, ['-I', '-B', '-X', 'utf8', '-m', 'practice_institute.cli', 'serve-desktop', '--stdin-control', '--owner-port', String(c.ownerPort), '--public-port', String(c.publicPort)], { cwd: this.launch.root, env: runtimeEnv(c, this.dirs, this.launch), windowsHide: true, stdio: 'pipe' });
    this.child = child;
    child.stdin.on('error', () => {});
    const lines = createInterface({ input: child.stdout });
    const errorLines = createInterface({ input: child.stderr });
    errorLines.on('line', line => { if (line) this.logs.append(line); });
    child.on('error', () => { this.fail('runtime-missing'); });
    child.on('close', () => {
      lines.close(); errorLines.close(); if (this.monitor) clearInterval(this.monitor); this.monitor = null;
      if (this.child === child) this.child = null;
      if (this.intentional) this.set(this.stopFailure || { kind: 'stopped' });
      else if (this.status.kind !== 'failed') this.fail('crashed');
      this.emit('closed', !this.intentional);
    });
    lines.on('line', line => {
      const event = parseEvent(line);
      if (!event || this.child !== child || this.intentional) return;
      if (event.event === 'error') this.fail(event.code, { port: event.port, listener: event.listener });
      if (event.event === 'ready') {
        const owner = `http://127.0.0.1:${c.ownerPort}`, student = `http://127.0.0.1:${c.publicPort}`;
        if (event.pid !== child.pid || event.owner_url !== owner || event.public_url !== student) { this.fail('config'); void this.stop(true).catch(() => {}); return; }
        this.set({ kind: 'probing', ownerUrl: owner });
        const check = async () => {
          if (this.probeBusy || this.intentional || this.child !== child) return;
          this.probeBusy = true;
          const good = await probe(owner, student); this.probeBusy = false;
          if (this.intentional || this.child !== child) return;
          if (good) { this.failures = 0; if (this.status.kind !== 'running') this.set({ kind: 'running', ownerUrl: owner, publicUrl: student, since: Date.now() }); }
          else if (++this.failures >= 3) this.fail('probe-failed');
        };
        void check(); this.monitor = setInterval(() => { void check(); }, 10_000);
      }
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { this.fail('probe-failed'); finish(new Error('probe-failed')); void this.stop(true).catch(() => {}); }, 35_000);
      const onState = (state: ServerStatus) => {
        if (state.kind === 'running') finish();
        if (state.kind === 'failed') finish(new Error(state.reason));
        if (state.kind === 'stopped') finish(new Error('crashed'));
      };
      const finish = (error?: Error) => { clearTimeout(timer); this.off('state', onState); error ? reject(error) : resolve(); };
      this.on('state', onState);
    });
  }
  async stop(preserveFailure = false): Promise<void> {
    const child = this.child;
    if (!child) { this.set({ kind: 'stopped' }); return; }
    this.stopFailure = preserveFailure && this.status.kind === 'failed' ? this.status : null;
    this.intentional = true; if (!this.stopFailure) this.set({ kind: 'stopping' });
    if (this.monitor) clearInterval(this.monitor); this.monitor = null;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); }, 10_000);
      const final = setTimeout(() => { cleanup(); reject(new Error('stop-timeout')); }, 15_000);
      const cleanup = () => { clearTimeout(timer); clearTimeout(final); child.off('close', onClose); };
      const onClose = () => { cleanup(); resolve(); };
      child.once('close', onClose);
      // Stop only this spawn handle. Never discover/kill a process by PID file, name, or port.
      child.stdin.end('stop\n');
    });
  }
  async command(args: string[], input?: string, timeout = 60_000): Promise<{ code: number; stdout: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.launch.python, ['-I', '-B', '-X', 'utf8', '-m', 'practice_institute.cli', ...args], { cwd: this.launch.root, env: runtimeEnv(this.config(), this.dirs, this.launch), windowsHide: true, stdio: 'pipe' });
      let stdout = '', size = 0;
      const timer = setTimeout(() => { child.kill(); reject(new Error('command-timeout')); }, timeout);
      child.stdin.on('error', () => {});
      // Do not log command stderr: setup errors could include sensitive input.
      child.stderr.resume();
      child.stdout.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 65536) { child.kill(); reject(new Error('command-output')); } else stdout += chunk.toString('utf8'); });
      child.once('error', () => { clearTimeout(timer); reject(new Error('runtime-missing')); });
      child.once('close', code => { clearTimeout(timer); resolve({ code: code ?? -1, stdout }); });
      child.stdin.end(input || '');
      input = undefined;
    });
  }
}
