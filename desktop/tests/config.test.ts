import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaults, validateConfig, validOrigin, applySettings, ConfigStore, publicSettings } from '../src/main/config';
import { profilePaths, runtimePaths, inside } from '../src/main/paths';
import { redact, Logs } from '../src/main/logs';
import { runtimeEnv, parseEvent } from '../src/main/runtime';
import { tunnelYaml, missingTunnel } from '../src/main/tunnel';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'PI test ünï ')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
describe('config boundary', () => {
  it.each(['', 'https://example.github.io', 'https://exam.example:8443', 'http://127.0.0.1:4318'])('accepts exact origin %s', value => expect(validOrigin(value)).toBe(true));
  it.each(['https://example.github.io/', 'https://example.github.io/repo', 'http://example.com', 'https://u:p@example.com', 'https://example.com?x', 'https://EXAMPLE.com', 'https://example.com/#x', 'https://example.com:443', 'https://example.com\n'])('rejects unsafe origin %s', value => expect(validOrigin(value)).toBe(false));
  it.each([{ ownerPort: 80 }, { publicPort: 8787 }, { publicApiHost: 'https://api.example' }, { trustProxyHeaders: 'false' }, { version: 2 }, { unexpected: true }, { closeBehavior: 'kill' }])('rejects invalid field %j', fields => expect(() => validateConfig({ ...defaults, ...fields }, dir)).toThrow());
  it('writes atomically, reloads without accepting unknown settings', () => {
    const file = path.join(dir, 'config.json'), store = new ConfigStore(file, dir);
    store.save(applySettings(store.value, { ownerPort: 9971, publicPort: 9972 }, dir));
    expect(new ConfigStore(file, dir).value.ownerPort).toBe(9971);
    expect(fs.readdirSync(dir)).toEqual(['config.json']);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(() => applySettings(store.value, { credentialsFile: '/etc/passwd' }, dir)).toThrow();
  });
  it('requires credentials owned by user inside tunnel dir, regular and matching ID', () => {
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const file = path.join(dir, id + '.json');
    fs.writeFileSync(file, JSON.stringify({ TunnelID: id, AccountTag: 'synthetic', TunnelSecret: 'synthetic' }));
    const config = { ...defaults, tunnel: { mode: 'named' as const, tunnelId: id, credentialsFile: file } };
    expect(validateConfig(config, dir)).toEqual(config);
    expect(publicSettings(config)).not.toHaveProperty('credentialsFile');
    const link = path.join(dir, 'link.json'); fs.symlinkSync(file, link);
    expect(() => validateConfig({ ...config, tunnel: { ...config.tunnel, credentialsFile: link } }, dir)).toThrow('symlink');
    expect(() => validateConfig(config, path.join(dir, 'other'))).toThrow();
    expect(() => validateConfig({ ...config, tunnel: { ...config.tunnel, tunnelId: 'aaaaaaaa-bbbb-cccc-dddd-ffffffffffff' } }, dir)).toThrow();
    fs.writeFileSync(file, 'x'.repeat(65537)); expect(() => validateConfig(config, dir)).toThrow('too-large');
  });
});
describe('paths and process isolation', () => {
  it('resolves native Unicode and space paths outside installation', () => {
    const win = profilePaths('win32', 'C:\\Users\\Owner ünï', {}, 'C:\\Users\\Owner ünï\\Documents');
    expect(win.data).toBe('C:\\Users\\Owner ünï\\AppData\\Local\\Practice Institute\\data');
    expect(runtimePaths('C:\\Program Files\\PI', 'win32').python).toBe('C:\\Program Files\\PI\\runtime\\python\\python.exe');
    const linux = profilePaths('linux', '/home/Owner ünï', { XDG_DATA_HOME: '/tmp/Space data', XDG_CONFIG_HOME: 'relative' });
    expect(linux.data).toBe('/tmp/Space data/practice-institute/data'); expect(linux.config).toBe('/home/Owner ünï/.config/practice-institute');
    expect(inside('/tmp/database', '/tmp/data')).toBe(false);
    const env = runtimeEnv(defaults, linux, { python: '/a/python', root: '/a', admin: '/a/admin' }, { PI_DB_PATH: 'secret', PYTHONPATH: '/evil', TOKEN: 'secret', HOME: '/home/u', PATH: '/evil' });
    expect(env).not.toHaveProperty('TOKEN'); expect(env).not.toHaveProperty('PYTHONPATH'); expect(env).not.toHaveProperty('PI_DB_PATH'); expect(env.PATH).toBe('/usr/bin:/bin');
  });
  it('parses only bounded typed runtime events', () => {
    expect(parseEvent('{"event":"ready","pid":3,"owner_url":"http://127.0.0.1:8787","public_url":"http://127.0.0.1:8788"}')?.event).toBe('ready');
    expect(parseEvent('{"event":"error","code":"port-in-use","port":8787,"listener":"owner"}')).toMatchObject({ code: 'port-in-use' });
    for (const v of ['null', 'not JSON', '{"event":"ready","pid":"3"}', '{"event":"error","code":"unknown"}', '{"event":"error","code":"port-in-use"}', 'x'.repeat(9000)]) expect(parseEvent(v)).toBeNull();
  });
  it('redacts tokens and rotates logs', () => {
    expect(redact('password=fixture-secret token=' + 'a'.repeat(40))).not.toContain('fixture-secret');
    expect(redact('{"password":"synthetic multi word password"}')).toBe('[redacted]');
    expect(redact('Authorization: Bearer short-fixture')).toBe('[redacted]');
    const file = path.join(dir, 'backend.log'); fs.writeFileSync(file, 'x'.repeat(2 * 1024 * 1024));
    const log = new Logs(file); log.append('secret=' + 'x'.repeat(50));
    expect(fs.existsSync(file + '.1')).toBe(true); expect(fs.readFileSync(file, 'utf8')).toContain('[redacted]');
  });
  it('generates only student ingress with final 404', () => {
    expect(missingTunnel(defaults)).toHaveLength(4);
    const c = { ...defaults, publicApiHost: 'api.example.com' };
    expect(tunnelYaml(c)).toContain('service: http://127.0.0.1:8788'); expect(tunnelYaml(c)).toContain('path: ^/api/v1(/.*)?$'); expect(tunnelYaml(c)).toMatch(/service: http_status:404\n$/);
  });
});
