import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_USER_MODEL_ID } from '../src/main/paths';

const build = path.resolve(__dirname, '../build');
const read = (p: string) => readFileSync(path.join(build, p));

describe('icons', () => {
  it('icon.png is a 512x512 RGBA PNG', () => {
    const b = read('icon.png');
    expect(b.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(b.readUInt32BE(16)).toBe(512); expect(b.readUInt32BE(20)).toBe(512);
    expect(b[25]).toBe(6);
  });
  it('icon.ico holds PNG images from 16 to 256 px', () => {
    const b = read('icon.ico');
    expect([b.readUInt16LE(0), b.readUInt16LE(2)]).toEqual([0, 1]);
    const count = b.readUInt16LE(4);
    const sizes: number[] = [];
    for (let i = 0; i < count; i++) {
      const e = 6 + 16 * i;
      sizes.push(b[e] === 0 ? 256 : b[e]);
      const size = b.readUInt32LE(e + 8), offset = b.readUInt32LE(e + 12);
      expect(offset + size).toBeLessThanOrEqual(b.length);
      expect(b.subarray(offset, offset + 8).toString('hex')).toBe('89504e470d0a1a0a');
    }
    expect(Math.min(...sizes)).toBe(16); expect(Math.max(...sizes)).toBe(256);
    for (const s of [16, 32, 48, 256]) expect(sizes).toContain(s);
  });
});

describe('Linux desktop entry fixture', () => {
  const entries = new Map(read('linux/practice-institute.desktop.fixture').toString('utf8').split('\n')
    .filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  const builder = readFileSync(path.resolve(__dirname, '../electron-builder.yml'), 'utf8');

  it('Windows AppUserModelID matches the electron-builder appId used by NSIS shortcuts', () => {
    expect(builder).toMatch(new RegExp(`^appId: ${APP_USER_MODEL_ID.replaceAll('.', '\\.')}$`, 'm'));
  });

  it('has the required keys', () => {
    expect(entries.get('Name')).toBe('Practice Institute');
    expect(entries.get('Type')).toBe('Application');
    expect(entries.get('Icon')).toBe('practice-institute');
    expect(entries.get('Categories')).toBe('Education;');
    expect(entries.get('Terminal')).toBe('false');
  });
  it('quotes the Exec path containing a space and runs the packaged executable', () => {
    expect(entries.get('Exec')).toMatch(/^"\/opt\/Practice Institute\/practice-institute"( %U)?$/);
  });
  it('stays consistent with electron-builder.yml', () => {
    expect(builder).toContain(`productName: ${entries.get('Name')}`);
    expect(builder).toContain('executableName: practice-institute');
    expect(builder).toContain(`Categories: ${entries.get('Categories')}`);
  });
  it('does not launch through a shell, a download or a terminal', () => {
    expect(entries.get('Exec')).not.toMatch(/\b(sh|bash|curl|wget|sudo)\b/);
  });
});
