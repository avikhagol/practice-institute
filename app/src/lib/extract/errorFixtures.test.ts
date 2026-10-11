import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { analysePages } from './analyse';
import { extractPagesNode } from './nodeExtract';
const fixtures = join(import.meta.dirname, '../../../../fixtures/synthetic');
it('uses a real embedded image PDF and reports a scan with no question candidates', async () => {
  const pages = await extractPagesNode(join(fixtures, 'image-only.pdf'));
  expect(pages).toHaveLength(1); expect(pages[0]?.charCount).toBe(0);
  const result = analysePages('scan', pages);
  expect(result.questions).toEqual([]);
  expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'scanned-or-image-only', message: expect.stringContaining('OCR is not available') }));
});
it('encrypted synthetic PDF requires a password in the actual PDF.js engine', async () => {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(readFileSync(join(fixtures, 'password.pdf'))), verbosity: 0 });
  try { await expect(task.promise).rejects.toMatchObject({ name: 'PasswordException' }); }
  finally { await task.destroy(); }
});
