// Original fixtures only; qpdf adds encryption to the bundled synthetic demo.
import { PDFDocument } from 'pdf-lib';
import { mkdirSync, writeFileSync, openSync, ftruncateSync, closeSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../../fixtures/synthetic/', import.meta.url));
mkdirSync(root, { recursive: true });
// Make a small PNG resembling lines on a page, with NO encoded PDF text layer.
const w = 600, h = 800, rows = Buffer.alloc(h * (1 + w * 3), 255);
for (let y = 0; y < h; y++) {
  rows[y * (1 + w * 3)] = 0;
  for (let x = 0; x < w; x++) {
    const line = y > 100 && y < 700 && y % 35 < 4 && x > 60 && x < 480 - (Math.floor(y / 35) % 3) * 50;
    if (line) for (let c = 0; c < 3; c++) rows[y * (1 + w * 3) + 1 + x * 3 + c] = 70;
  }
}
function crc32(bytes) { let crc = 0xffffffff; for (const b of bytes) { crc ^= b; for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const label = Buffer.from(type); const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([label, data]))); return Buffer.concat([length, label, data, crc]); }
const header = Buffer.alloc(13); header.writeUInt32BE(w); header.writeUInt32BE(h, 4); header[8] = 8; header[9] = 2;
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
const pdf = await PDFDocument.create(); const image = await pdf.embedPng(png); pdf.addPage([600, 800]).drawImage(image, { x: 0, y: 0, width: 600, height: 800 });
pdf.setTitle('Original image-only fixture — no text layer');
writeFileSync(join(root, 'image-only.pdf'), await pdf.save());
// Sparse file: bounds test rejects its size before reading bytes; do not commit it.
const fd = openSync(join(root, 'oversize.pdf'), 'w'); ftruncateSync(fd, 41 * 1024 * 1024); closeSync(fd);
console.log('Created image-only and sparse 41 MB fixtures. Generate password.pdf with the qpdf command documented in fixtures/synthetic/README.md.');
