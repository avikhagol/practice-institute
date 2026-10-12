import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/main/main.ts'], outfile: 'dist/main/main.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
// Sandboxed preload can require only Electron. Bundle the shared channel constants.
await build({ entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload/preload.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
await cp('src/renderer', 'dist/renderer', { recursive: true, filter: p => !p.endsWith('.ts') });
// Sonnet can author renderer.ts; compile it without exposing Node APIs.
try { await build({ entryPoints: ['src/renderer/renderer.ts'], outfile: 'dist/renderer/renderer.js', bundle: true, platform: 'browser', format: 'iife' }); }
catch (error) { throw error; }
