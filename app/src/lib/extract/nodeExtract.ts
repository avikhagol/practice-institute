// Test-only helper: extract PageText from a PDF file in Node with the PDF.js legacy build,
// using the same line reconstruction as the browser pipeline.
import { readFileSync } from 'node:fs';
import { countChars, itemsToLines, LOW_TEXT_CHAR_THRESHOLD, type RawTextItem } from './layout';
import type { PageText } from '../types';

export async function extractPagesNode(path: string): Promise<PageText[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(readFileSync(path));
  const task = pdfjs.getDocument({ data, verbosity: 0 });
  const pdf = await task.promise;
  const pages: PageText[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const lines = itemsToLines(tc.items.filter((i) => 'str' in i) as unknown as RawTextItem[]);
    const charCount = countChars(lines);
    pages.push({ docId: 'node', pageNumber: n, width: vp.width, height: vp.height, lines, charCount, lowText: charCount < LOW_TEXT_CHAR_THRESHOLD });
  }
  await task.destroy();
  return pages;
}
