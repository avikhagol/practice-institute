import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { createInterface } from 'node:readline';
import { atomicWrite, validateConfig, type Config } from './config';
import type { ProfilePaths } from './paths';
import type { TunnelStatus } from '../shared/ipc';
import { Logs } from './logs';
import { statusCode } from './runtime';

export function missingTunnel(c: Config): Extract<TunnelStatus, { kind: 'not-configured' }>['missing'] {
  const missing: Extract<TunnelStatus, { kind: 'not-configured' }>['missing'] = [];
  if (!c.publicApiHost) missing.push('hostname'); if (!c.tunnel.tunnelId) missing.push('tunnel-id');
  if (!c.tunnel.credentialsFile) missing.push('credentials'); if (!c.studentOrigin) missing.push('student-origin');
  return missing;
}
export function tunnelYaml(c: Config): string {
  // JSON strings are valid YAML scalars, avoiding hostname/path injection on Windows.
  return `tunnel: ${JSON.stringify(c.tunnel.tunnelId)}\ncredentials-file: ${JSON.stringify(c.tunnel.credentialsFile)}\ningress:\n  - hostname: ${JSON.stringify(c.publicApiHost)}\n    path: ^/api/v1(/.*)?$\n    service: http://127.0.0.1:${c.publicPort}\n  - service: http_status:404\n`;
}
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(error => error ? reject(error) : resolve(p)); }); });
}
export class Tunnel extends EventEmitter {
  status: TunnelStatus;
  child: ChildProcess | null = null;
  private monitor: NodeJS.Timeout | null = null;
  private intentional = false;
  constructor(readonly binary: string, readonly dirs: ProfilePaths, readonly config: () => Config, readonly logs: Logs) { super(); this.status = this.idle(); }
  idle(): TunnelStatus { const missing = missingTunnel(this.config()); return missing.length ? { kind: 'not-configured', missing } : { kind: 'stopped' }; }
  refresh(): void { if (!this.child) this.set(this.idle()); }
  private set(status: TunnelStatus): void { this.status = status; this.emit('state', status); }
  async start(): Promise<void> {
    if (this.child) throw new Error('tunnel-running');
    const c = validateConfig(this.config(), this.dirs.tunnel);
    if (missingTunnel(c).length || c.tunnel.mode !== 'named') throw new Error('config-invalid');
    if (!fs.existsSync(this.binary)) { this.set({ kind: 'failed', reason: 'binary-missing', detail: 'Bundled cloudflared is missing.' }); throw new Error('binary-missing'); }
    const file = path.join(this.dirs.tunnel, 'config.yml'); atomicWrite(file, tunnelYaml(c));
    const port = await freePort();
    this.intentional = false; this.set({ kind: 'starting' });
    const env: NodeJS.ProcessEnv = {};
    for (const k of ['SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LANG']) if (process.env[k]) env[k] = process.env[k];
    const child = spawn(this.binary, ['tunnel', '--no-autoupdate', '--config', file, '--metrics', `127.0.0.1:${port}`, 'run'], { env, cwd: this.dirs.tunnel, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    this.child = child;
    const errorLines = child.stderr ? createInterface({ input: child.stderr }) : null;
    errorLines?.on('line', line => { if (line) this.logs.append(line); });
    child.once('spawn', () => this.set({ kind: 'running-unverified' }));
    child.once('error', () => this.set({ kind: 'failed', reason: 'binary-missing', detail: 'Could not launch bundled cloudflared.' }));
    child.once('close', () => {
      errorLines?.close();
      this.child = null; if (this.monitor) clearInterval(this.monitor); this.monitor = null;
      if (this.intentional) this.set(this.idle()); else if (this.status.kind !== 'failed') this.set({ kind: 'failed', reason: 'exited', detail: 'Tunnel process exited; check the private logs.' });
    });
    this.monitor = setInterval(() => {
      void (async () => {
        try {
          const r = await fetch(`http://127.0.0.1:${port}/ready`, { signal: AbortSignal.timeout(3000), redirect: 'manual' });
          const data = await r.json() as { readyConnections?: unknown };
          if (this.child !== child || this.intentional) return;
          if (r.ok && typeof data.readyConnections === 'number' && data.readyConnections > 0) {
            if (this.status.kind !== 'verified') this.set({ kind: 'connected', connections: data.readyConnections });
          } else this.set({ kind: 'running-unverified' });
        } catch { if (this.child === child && !this.intentional) this.set({ kind: 'running-unverified' }); }
      })();
    }, 5000);
  }
  async stop(): Promise<void> {
    const child = this.child;
    if (!child) { this.refresh(); return; }
    this.intentional = true;
    if (this.monitor) clearInterval(this.monitor); this.monitor = null;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
      const final = setTimeout(() => { cleanup(); reject(new Error('stop-timeout')); }, 15_000);
      const cleanup = () => { clearTimeout(timer); clearTimeout(final); };
      child.once('close', () => { cleanup(); resolve(); }); child.kill();
    });
  }
  async verify(): Promise<TunnelStatus> {
    if (!this.child) throw new Error('tunnel-stopped');
    const host = this.config().publicApiHost;
    try {
      const results = await Promise.all([statusCode(`https://${host}/api/v1/health`), statusCode(`https://${host}/admin/`)]);
      if (results[0] !== 200 || results[1] !== 404) throw new Error('verify-failed');
      this.set({ kind: 'verified', checkedAt: Date.now() });
    } catch { this.set({ kind: 'failed', reason: 'verify-failed', detail: 'Public health or private-route check failed.' }); }
    return this.status;
  }
}
