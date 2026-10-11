// Ingest one PDF in the browser: validate, open with PDF.js, extract positioned text
// page by page (sequentially, cancellable), detect scans/low text, remove repeated
// headers/footers, and parse MCQ candidates. Nothing leaves the device.
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { analysePages } from '../extract/analyse';
import { countChars, itemsToLines, LOW_TEXT_CHAR_THRESHOLD, type RawTextItem } from '../extract/layout';
import type { PageText, Question, SourceDoc } from '../types';
import { LIMITS, hasPdfSignature, preflight } from './limits';
import { documentOptions, loadPdfJs } from './pdfjs';
import { randomId } from '../id';

export type IngestErrorCode = 'not-pdf' | 'too-large' | 'empty' | 'password' | 'corrupt' | 'cancelled' | 'engine-unavailable' | 'unknown';

export class IngestError extends Error {
  constructor(
    public code: IngestErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'IngestError';
  }
}

export interface IngestProgress {
  phase: 'reading' | 'opening' | 'extracting' | 'parsing';
  page?: number;
  pageTotal?: number;
}

export interface IngestResult {
  doc: SourceDoc;
  pages: PageText[];
  /** Cleaned pages (headers/footers removed) used for reflow and parsing. */
  cleanPages: PageText[];
  questions: Question[];
  /** Kept so pages can be rendered for preview later; call destroy() when removed. */
  pdf: PDFDocumentProxy;
}

export function guessYear(name: string): string | null {
  const m = /(?:^|[^\d])((?:19|20)\d{2})(?:[^\d]|$)/.exec(name);
  return m ? (m[1] ?? null) : null;
}

function makeId(): string {
  return randomId().slice(0, 8);
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new IngestError('cancelled', 'Cancelled.');
}

export async function ingestPdf(
  file: File,
  opts: { signal?: AbortSignal; onProgress?: (p: IngestProgress) => void; synthetic?: boolean } = {},
): Promise<IngestResult> {
  const { signal, onProgress } = opts;
  const pre = preflight(file);
  if (pre) throw new IngestError(pre.code, pre.message);

  onProgress?.({ phase: 'reading' });
  const bytes = new Uint8Array(await file.arrayBuffer());
  checkAbort(signal);
  if (!hasPdfSignature(bytes)) throw new IngestError('not-pdf', 'This file does not contain a PDF signature; it may be renamed or corrupted.');

  onProgress?.({ phase: 'opening' });
  let lib;
  try {
    lib = await loadPdfJs();
  } catch {
    throw new IngestError('engine-unavailable', 'The PDF engine could not be loaded. Check your connection and reload the page.');
  }
  checkAbort(signal);

  const task = lib.getDocument(documentOptions(bytes));
  // Password-protected PDFs: we do not prompt for passwords; fail clearly instead.
  let needsPassword = false;
  task.onPassword = () => {
    needsPassword = true;
    void task.destroy();
  };
  const onAbort = () => void task.destroy();
  signal?.addEventListener('abort', onAbort, { once: true });

  let pdf: PDFDocumentProxy;
  try {
    pdf = await task.promise;
  } catch (e) {
    signal?.removeEventListener('abort', onAbort);
    if (signal?.aborted) throw new IngestError('cancelled', 'Cancelled.');
    const name = (e as { name?: string })?.name ?? '';
    if (needsPassword || name === 'PasswordException')
      throw new IngestError('password', 'This PDF is password-protected. Remove the password in your PDF tool and try again.');
    if (name === 'InvalidPDFException') throw new IngestError('corrupt', 'This PDF appears to be damaged or invalid and could not be opened.');
    throw new IngestError('corrupt', `PDF.js could not open this file (${name || 'unknown error'}).`);
  }

  try {
    const docId = makeId();
    const total = pdf.numPages;
    const limit = Math.min(total, LIMITS.maxPagesPerFile);
    const pages: PageText[] = [];
    for (let n = 1; n <= limit; n++) {
      checkAbort(signal);
      onProgress?.({ phase: 'extracting', page: n, pageTotal: limit });
      const page = await pdf.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = content.items.filter((i): i is RawTextItem & typeof i => 'str' in i) as unknown as RawTextItem[];
      const lines = itemsToLines(items);
      const charCount = countChars(lines);
      pages.push({ docId, pageNumber: n, width: vp.width, height: vp.height, lines, charCount, lowText: charCount < LOW_TEXT_CHAR_THRESHOLD });
      page.cleanup();
    }
    checkAbort(signal);
    onProgress?.({ phase: 'parsing' });

    const { cleanPages, questions, warnings } = analysePages(docId, pages);
    if (total > limit) {
      warnings.push({ code: 'page-limit-truncated', message: `Only the first ${limit} of ${total} pages were processed (limit ${LIMITS.maxPagesPerFile} pages per file).` });
    }

    const doc: SourceDoc = {
      id: docId,
      fileName: file.name,
      sizeBytes: file.size,
      pageCount: total,
      pagesProcessed: limit,
      label: file.name.replace(/\.pdf$/i, ''),
      year: guessYear(file.name),
      addedAt: Date.now(),
      warnings,
      synthetic: Boolean(opts.synthetic),
    };
    return { doc, pages, cleanPages, questions, pdf };
  } catch (e) {
    await task.destroy();
    if (e instanceof IngestError) throw e;
    throw new IngestError('unknown', `Extraction failed: ${(e as Error)?.message ?? 'unknown error'}`);
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Render one page to a canvas for the original-page preview. */
export async function renderPageToCanvas(pdf: PDFDocumentProxy, pageNumber: number, canvas: HTMLCanvasElement, cssWidth: number) {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const scale = (cssWidth / base.width) * dpr;
  const vp = page.getViewport({ scale });
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  canvas.style.width = `${Math.floor(vp.width / dpr)}px`;
  canvas.style.height = `${Math.floor(vp.height / dpr)}px`;
  const task = page.render({ canvas, viewport: vp });
  try {
    await task.promise;
  } finally {
    page.cleanup();
  }
  return task;
}
