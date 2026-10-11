import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = 'dist';
const api = (process.env.VITE_PI_API_BASE ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
const base = process.env.BASE_PATH ?? '/practice-institute/';
const files = [];
function walk(folder) {
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) walk(path); else files.push(path);
  }
}
walk(root);
assert(files.some(p => /pdf\.worker\.min-.*\.mjs$/.test(p)), 'hashed PDF worker missing');
for (const asset of ['tesseract/worker.min.js', 'tesseract/tesseract-core-relaxedsimd-lstm.wasm.js', 'pdfjs/wasm/openjpeg.wasm']) {
  assert(files.includes(join(root, asset)), `missing ${asset}`);
}
const html = readFileSync(join(root, 'index.html'), 'utf8').replaceAll('&#39;', "'");
assert(html.includes(`connect-src 'self' ${new URL(api).origin} blob: data:`), 'CSP API origin mismatch');
for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  if (url.includes('/assets/')) assert(url.startsWith(base), `asset outside Pages base: ${url}`);
}
const js = files.filter(p => /\.(js|mjs)$/.test(p) && p.includes('/assets/')).map(p => readFileSync(p, 'utf8')).join('\n');
assert(js.includes(api), 'expected API URL absent');
for (const privateText of ['/api/admin', 'X-CSRF-Token', 'disposable-browser-password', 'browser-owner', 'pi_admin_session', 'CTET_December2019', 'http://127.0.0.1:8791', 'http://127.0.0.1:8789']) {
  assert(!js.includes(privateText), `student bundle contains forbidden string: ${privateText}`);
}
for (const path of files) {
  const name = relative(root, path);
  assert(!/\.(sqlite3?|db|map)$|(^|\/)\.env|(^|\/)sources\//i.test(name), `private/build-debug file: ${name}`);
  if (/\.pdf$/i.test(name)) assert(name === 'demo/pdf-smart-synthetic-demo.pdf', `unexpected PDF: ${name}`);
}
console.log(`Student build check passed: ${files.length} files; API ${api}; base ${base}; worker/assets/CSP/leaks checked.`);
