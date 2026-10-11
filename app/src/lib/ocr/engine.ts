import type { PDFDocumentProxy } from 'pdfjs-dist';

export type OcrLanguage = 'eng' | 'hin' | 'eng+hin';
export interface OcrProgress { phase: string; percent: number; page?: number; totalPages?: number }
export interface OcrOptions { lang?: OcrLanguage; signal?: AbortSignal; onProgress?: (p: OcrProgress) => void }
export interface OcrResult { text: string; confidence: number; lines: string[] }
export interface OcrCrop { x: number; y: number; width: number; height: number }
export interface OcrPageItem { pageNumber: number; text: string; confidence: number; lines: { text: string; pageNumber: number }[] }
export const MAX_OCR_PAGES = 20;
export const MAX_OCR_PIXELS = 8_000_000;
const CACHE_NAME = 'practice-institute-ocr-v1';
const MODEL_HASHES: Record<string,string> = { eng: '384e37bf0f5ddcc4a1e24802322a837e0b5692e18150e6078ff1d4379b191f98', hin: '14a6c9e8503921fb4c79470608048a85f46cdfce254025c04f5a701b63da4f96' };
async function validModel(bytes: ArrayBuffer, url: string) {
  const language = url.split('/').pop()!.split('.')[0]!;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,'0')).join('') === MODEL_HASHES[language];
}
export function getOcrAssetPaths() {
  const base = new URL(import.meta.env.BASE_URL, window.location.href);
  return { workerPath: new URL('tesseract/worker.min.js', base).href,
    corePath: new URL('tesseract/', base).href, langPath: new URL('tesseract/lang-data', base).href };
}
export function languageAssets(lang: OcrLanguage) { return lang.split('+').map(l => `${getOcrAssetPaths().langPath}/${l}.traineddata.gz`); }
export async function checkOcrAssetStatus(lang: OcrLanguage) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const files = await Promise.all(languageAssets(lang).map(async url => {
      const stored = await cache.match(url);
      const response = stored ?? await fetch(url, { method: 'HEAD' });
      if (!response.ok || response.headers.get('content-type')?.includes('text/html')) throw new Error('missing');
      return { cached: Boolean(stored), size: Number(response.headers.get('content-length') ?? 0) };
    }));
    const sizeBytes = files.reduce((n, f) => n + f.size, 0);
    return { available: true, sizeBytes, statusText: `${files.every(f => f.cached) ? 'Downloaded in this browser' : 'Available on local server; download on Start'} · ${(sizeBytes / 1048576).toFixed(2)} MiB language data` };
  } catch { return { available: false, statusText: 'Language assets unavailable. Run npm run assets:ocr:download, then rebuild admin.' }; }
}
export async function downloadOcrAssets(options: OcrOptions) {
  const cache = await caches.open(CACHE_NAME);
  for (const url of languageAssets(options.lang ?? 'eng')) {
    if (options.signal?.aborted) throw new Error('OCR cancelled.');
    const stored = await cache.match(url);
    if (stored && await validModel(await stored.arrayBuffer(), url)) continue;
    await cache.delete(url);
    options.onProgress?.({ phase: `Downloading ${url.split('/').pop()} from local server`, percent: 0 });
    const response = await fetch(url, { signal: options.signal });
    if (!response.ok || response.headers.get('content-type')?.includes('text/html')) throw new Error('OCR language asset unavailable.');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('OCR asset body unavailable.');
    const chunks: Uint8Array[] = []; let total = 0;
    const expected = Number(response.headers.get('content-length') ?? 0);
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > 16_000_000) { await reader.cancel(); throw new Error('OCR language asset exceeds 16 MB.'); }
      chunks.push(value); options.onProgress?.({ phase: `Downloading ${url.split('/').pop()} · ${(total/1048576).toFixed(2)} MiB`, percent: expected ? Math.min(100,Math.round(total/expected*100)) : 0 });
    }
    const bytes = new ArrayBuffer(total); const joined = new Uint8Array(bytes); let offset=0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
    if (bytes.byteLength > 16_000_000 || new Uint8Array(bytes)[0] !== 31 || new Uint8Array(bytes)[1] !== 139) throw new Error('Invalid or oversized OCR language asset.');
    if (!await validModel(bytes,url)) throw new Error('OCR asset checksum failed. Run the pinned downloader and rebuild.');
    await cache.put(url, new Response(bytes, { headers: { 'content-length': String(bytes.byteLength), 'content-type': 'application/gzip' } }));
    options.onProgress?.({ phase: 'Language download complete', percent: 100 });
  }
}

/** The host worker owns Tesseract's nested worker. Terminating the host cancels
 * startup/download/recognition together, including unresolved library jobs. */
export async function recognizeCanvas(canvas: HTMLCanvasElement, options: OcrOptions = {}): Promise<OcrResult> {
  if (options.signal?.aborted) throw new Error('OCR cancelled.');
  if (!canvas.width || !canvas.height || canvas.width * canvas.height > MAX_OCR_PIXELS) throw new Error('OCR image exceeds the 8 megapixel limit.');
  await downloadOcrAssets(options);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Cannot encode OCR image.')), 'image/png'));
  if (options.signal?.aborted) throw new Error('OCR cancelled.');
  const bytes = await blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const host = new Worker(new URL('./runner.ts', import.meta.url), { type: 'module' });
    let finished = false;
    const finish = (error?: Error, result?: OcrResult) => {
      if (finished) return;
      finished = true; clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); host.terminate();
      if (error) reject(error); else resolve(result!);
    };
    const abort = () => finish(new Error('OCR cancelled.'));
    const timeout = setTimeout(() => finish(new Error('OCR timed out after 120 seconds. Try a smaller crop.')), 120_000);
    options.signal?.addEventListener('abort', abort, { once: true });
    host.onerror = e => finish(new Error(e.message || 'OCR worker failed.'));
    host.onmessage = e => {
      if (e.data.progress) options.onProgress?.(e.data.progress);
      else if (e.data.error) finish(new Error(e.data.error));
      else finish(undefined, e.data.result);
    };
    host.postMessage({ bytes, lang: options.lang ?? 'eng', paths: getOcrAssetPaths(), cacheName: CACHE_NAME }, [bytes]);
  });
}
export async function recognizeCrop(source: HTMLCanvasElement, crop: OcrCrop, options: OcrOptions = {}) {
  const { x, y, width, height } = crop;
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > source.width || y + height > source.height) throw new Error('Invalid crop bounds.');
  const canvas = document.createElement('canvas'); canvas.width = Math.floor(width); canvas.height = Math.floor(height);
  const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas unavailable.');
  context.drawImage(source, x, y, width, height, 0, 0, canvas.width, canvas.height);
  return recognizeCanvas(canvas, options);
}
export async function recognizePdfPage(pdf: PDFDocumentProxy, pageNumber: number, options: OcrOptions & { scale?: number } = {}): Promise<OcrPageItem> {
  if (options.signal?.aborted) throw new Error('OCR cancelled.');
  const page = await pdf.getPage(pageNumber);
  const original = page.getViewport({ scale: 1 });
  const scale = Math.min(options.scale ?? 2, Math.sqrt(MAX_OCR_PIXELS / (original.width * original.height)));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas'); canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
  const render = page.render({ canvas, viewport });
  const cancel = () => render.cancel(); options.signal?.addEventListener('abort', cancel, { once: true });
  try {
    await render.promise;
    const result = await recognizeCanvas(canvas, options);
    return { pageNumber, text: result.text, confidence: result.confidence, lines: result.lines.map(text => ({ text, pageNumber })) };
  } finally { options.signal?.removeEventListener('abort', cancel); page.cleanup(); canvas.width = canvas.height = 0; }
}
export async function recognizePdfPages(pdf: PDFDocumentProxy, pages: number[], options: OcrOptions & { concurrency?: number; scale?: number } = {}) {
  if (!pages.length || pages.length > MAX_OCR_PAGES || pages.some(p => !Number.isInteger(p) || p < 1 || p > pdf.numPages) || new Set(pages).size !== pages.length) throw new Error('Choose 1–20 distinct valid pages per OCR job.');
  const concurrency = Math.max(1, Math.min(Math.floor(options.concurrency ?? 1) || 1, 2));
  const job = new AbortController(); const cancel = () => job.abort(); options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) job.abort();
  const results: OcrPageItem[] = [];
  try {
    for (let i = 0; i < pages.length; i += concurrency) {
      const settled = await Promise.allSettled(pages.slice(i, i + concurrency).map((page, index) => recognizePdfPage(pdf, page, { ...options, signal: job.signal,
        onProgress: p => options.onProgress?.({ ...p, page: i + index + 1, totalPages: pages.length }) }).catch(error => { job.abort(); throw error; })));
      for (const result of settled) { if (result.status === 'rejected') throw result.reason; results.push(result.value); }
    }
    return results.sort((a, b) => a.pageNumber - b.pageNumber);
  } finally { job.abort(); options.signal?.removeEventListener('abort', cancel); }
}
