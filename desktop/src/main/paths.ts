import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

// Must equal electron-builder.yml appId: Windows groups taskbar buttons, pins and
// notifications with the NSIS shortcuts by this AppUserModelID.
export const APP_USER_MODEL_ID = 'org.practiceinstitute.desktop';
export interface ProfilePaths { config: string; data: string; logs: string; backups: string; tunnel: string }
export function profilePaths(platform: string, home: string, env: NodeJS.ProcessEnv, documents?: string): ProfilePaths {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const absolute = (key: string, fallback: string) => env[key] && p.isAbsolute(env[key]!) ? env[key]! : fallback;
  const config = platform === 'win32'
    ? p.join(absolute('APPDATA', p.join(home, 'AppData', 'Roaming')), 'Practice Institute', 'config')
    : p.join(absolute('XDG_CONFIG_HOME', p.join(home, '.config')), 'practice-institute');
  const local = absolute('LOCALAPPDATA', p.join(home, 'AppData', 'Local'));
  return {
    config, tunnel: p.join(config, 'tunnel'),
    data: platform === 'win32' ? p.join(local, 'Practice Institute', 'data') : p.join(absolute('XDG_DATA_HOME', p.join(home, '.local/share')), 'practice-institute/data'),
    logs: platform === 'win32' ? p.join(local, 'Practice Institute', 'logs') : p.join(absolute('XDG_STATE_HOME', p.join(home, '.local/state')), 'practice-institute/logs'),
    backups: p.join(platform === 'win32' ? documents || p.join(home, 'Documents') : home, 'Practice Institute Backups'),
  };
}
export function ensurePrivateDir(dir: string): void {
  const existed = fs.existsSync(dir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(dir).isSymbolicLink() || !fs.statSync(dir).isDirectory()) throw new Error('unsafe-profile-directory');
  if (process.platform !== 'win32') {
    if (fs.statSync(dir).uid !== process.getuid?.()) throw new Error('profile-directory-owner');
    fs.chmodSync(dir, 0o700);
    if ((fs.statSync(dir).mode & 0o077) !== 0) throw new Error('profile-permissions-unsupported');
  } else if (!existed) {
    const system = process.env.SystemRoot;
    if (!system || !process.env.USERNAME) throw new Error('missing-windows-profile');
    execFileSync(path.join(system, 'System32/icacls.exe'), [dir, '/inheritance:r', '/grant:r', `${process.env.USERNAME}:(OI)(CI)F`], { windowsHide: true, stdio: 'ignore' });
  }
}
export function runtimePaths(resources: string, platform: string) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const root = p.join(resources, 'runtime');
  return { root, python: p.join(root, 'python', ...(platform === 'win32' ? ['python.exe'] : ['bin', 'python3'])), admin: p.join(root, 'admin'), cloudflared: p.join(root, 'cloudflared', platform === 'win32' ? 'cloudflared.exe' : 'cloudflared') };
}
export function inside(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
