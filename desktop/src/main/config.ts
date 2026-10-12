import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { inside } from './paths';
import type { PublicSettings, SettingsInput } from '../shared/ipc';

export interface Config {
  version: 1; ownerPort: number; publicPort: number; studentOrigin: string; publicApiHost: string;
  tunnel: { mode: 'none' | 'named'; tunnelId: string; credentialsFile: string };
  trustProxyHeaders: boolean; keepAwakeWhileServing: boolean; closeBehavior: 'ask' | 'tray' | 'stop';
}
export const defaults: Config = { version: 1, ownerPort: 8787, publicPort: 8788, studentOrigin: '', publicApiHost: '', tunnel: { mode: 'none', tunnelId: '', credentialsFile: '' }, trustProxyHeaders: false, keepAwakeWhileServing: true, closeBehavior: 'ask' };
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hostname = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('bad-input');
  return value as Record<string, unknown>;
}
export function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(k => !allowed.includes(k))) throw new Error('invalid-field');
}
export function validOrigin(value: unknown): boolean {
  if (value === '') return true;
  if (typeof value !== 'string' || value.length > 300) return false;
  try {
    const u = new URL(value);
    return u.origin === value && !u.username && !u.password &&
      ((u.protocol === 'https:' && hostname.test(u.hostname)) || (u.protocol === 'http:' && u.hostname === '127.0.0.1' && !!u.port));
  } catch { return false; }
}
export function credentialInfo(file: string, tunnelDir?: string): { TunnelID: string } {
  if (!path.isAbsolute(file)) throw new Error('invalid-file');
  const st = fs.lstatSync(file);
  if (st.isSymbolicLink()) throw new Error('symlink');
  if (!st.isFile()) throw new Error('invalid-file');
  if (st.size > 65536) throw new Error('too-large');
  if (process.platform !== 'win32' && st.uid !== process.getuid?.()) throw new Error('invalid-owner');
  if (tunnelDir && (!inside(file, tunnelDir) || !inside(fs.realpathSync(file), fs.realpathSync(tunnelDir)))) throw new Error('invalid-file');
  const value = object(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (typeof value.TunnelID !== 'string' || !uuid.test(value.TunnelID) || typeof value.AccountTag !== 'string' || typeof value.TunnelSecret !== 'string') throw new Error('invalid-file');
  return { TunnelID: value.TunnelID };
}
export function validateConfig(input: unknown, tunnelDir: string): Config {
  const c = object(input);
  keys(c, Object.keys(defaults));
  if (c.version !== 1) throw new Error('invalid-version');
  for (const field of ['ownerPort', 'publicPort']) if (!Number.isInteger(c[field]) || Number(c[field]) < 1024 || Number(c[field]) > 65535) throw new Error(`invalid-${field}`);
  if (c.ownerPort === c.publicPort) throw new Error('invalid-publicPort');
  if (!validOrigin(c.studentOrigin)) throw new Error('invalid-studentOrigin');
  if (typeof c.publicApiHost !== 'string' || (c.publicApiHost !== '' && !hostname.test(c.publicApiHost))) throw new Error('invalid-publicApiHost');
  for (const field of ['trustProxyHeaders', 'keepAwakeWhileServing']) if (typeof c[field] !== 'boolean') throw new Error(`invalid-${field}`);
  if (!['ask', 'tray', 'stop'].includes(String(c.closeBehavior))) throw new Error('invalid-closeBehavior');
  const t = object(c.tunnel);
  keys(t, ['mode', 'tunnelId', 'credentialsFile']);
  if (!['none', 'named'].includes(String(t.mode)) || typeof t.tunnelId !== 'string' || (t.tunnelId !== '' && !uuid.test(t.tunnelId)) || typeof t.credentialsFile !== 'string') throw new Error('invalid-tunnelId');
  if (t.credentialsFile && credentialInfo(t.credentialsFile, tunnelDir).TunnelID.toLowerCase() !== t.tunnelId.toLowerCase()) throw new Error('invalid-tunnelId');
  return structuredClone(c) as unknown as Config;
}
export function publicSettings(c: Config): PublicSettings {
  const { version: _, tunnel, ...rest } = c;
  return { ...rest, tunnelId: tunnel.tunnelId, hasTunnelCredentials: !!tunnel.credentialsFile };
}
export function applySettings(c: Config, value: unknown, tunnelDir: string): Config {
  const input = object(value);
  keys(input, ['ownerPort', 'publicPort', 'studentOrigin', 'publicApiHost', 'tunnelId', 'trustProxyHeaders', 'keepAwakeWhileServing', 'closeBehavior']);
  const next = structuredClone(c);
  const { tunnelId, ...rest } = input as SettingsInput;
  Object.assign(next, rest);
  if (tunnelId !== undefined) {
    if (tunnelId !== c.tunnel.tunnelId) next.tunnel.credentialsFile = '';
    next.tunnel.tunnelId = tunnelId;
    next.tunnel.mode = tunnelId ? 'named' : 'none';
  }
  return validateConfig(next, tunnelDir);
}
export function atomicWrite(file: string, text: string): void {
  const tmp = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try { fs.writeFileSync(fd, text, 'utf8'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  try { fs.renameSync(tmp, file); }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
  if (process.platform !== 'win32') { const dir = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } }
}
export class ConfigStore {
  value: Config;
  constructor(readonly file: string, readonly tunnelDir: string) {
    this.value = fs.existsSync(file) ? validateConfig(JSON.parse(fs.readFileSync(file, 'utf8')), tunnelDir) : structuredClone(defaults);
  }
  save(value: Config): void { const checked = validateConfig(value, this.tunnelDir); atomicWrite(this.file, JSON.stringify(checked, null, 2) + '\n'); this.value = checked; }
}
