// Copies PDF.js runtime data (CMaps for CJK/Indic CID fonts, standard font data,
// wasm image decoders, ICC profiles) into public/pdfjs so they are served from the
// app's own origin and base path. Runs automatically before dev/build.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'pdfjs-dist');
const dest = join(root, 'public', 'pdfjs');

if (!existsSync(src)) {
  console.error('pdfjs-dist is not installed; run npm ci first.');
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  if (existsSync(join(src, dir))) cpSync(join(src, dir), join(dest, dir), { recursive: true });
}
cpSync(join(src, 'LICENSE'), join(dest, 'LICENSE'));
console.log(`Copied PDF.js assets to ${dest}`);
