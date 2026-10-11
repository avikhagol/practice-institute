// Copies Tesseract.js runtime data (worker, core WASM scripts) into public/tesseract
// so that OCR runs purely from the application's same origin and adheres to strict CSP.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tesseractDist = join(root, 'node_modules', 'tesseract.js', 'dist');
const coreDist = join(root, 'node_modules', 'tesseract.js-core');
const dest = join(root, 'public', 'tesseract');

if (!existsSync(tesseractDist) || !existsSync(coreDist)) {
  console.error('tesseract.js or tesseract.js-core is not installed; run npm install first.');
  process.exit(1);
}

mkdirSync(dest, { recursive: true });

cpSync(join(root, 'node_modules', 'tesseract.js', 'LICENSE.md'), join(dest, 'LICENSE-tesseract.js'));
cpSync(join(coreDist, 'LICENSE'), join(dest, 'LICENSE-tesseract.js-core'));

// Copy worker
cpSync(join(tesseractDist, 'worker.min.js'), join(dest, 'worker.min.js'));

// Copy wasm core engines
const coreFiles = readdirSync(coreDist).filter(file => /^tesseract-core.*\.wasm(\.js)?$/.test(file));

for (const file of coreFiles) {
  const src = join(coreDist, file);
  if (existsSync(src)) {
    cpSync(src, join(dest, file));
  }
}

console.log(`Copied Tesseract.js assets to ${dest}`);
