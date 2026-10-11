import { set } from 'idb-keyval';
import { createWorker } from 'tesseract.js';
import type { OcrResult } from './engine';
self.onmessage = async event => {
  const { bytes, lang, paths, cacheName } = event.data;
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  try {
    // Explicitly downloaded CacheStorage bytes are passed as blob URLs; the
    // document and its pixels never leave this origin/browser.
    const cache = await caches.open(cacheName);
    await Promise.all((lang as string).split('+').map(async code => {
      const response = await cache.match(`${paths.langPath}/${code}.traineddata.gz`);
      if (!response) throw new Error('OCR asset cache is missing.');
      await set(`practice-institute-ocr-v1/${code}.traineddata`, new Uint8Array(await response.arrayBuffer()));
    }));
    // Use the pinned bytes in Tesseract’s IndexedDB cache; its v7 inline Lang initializer uses data instead of code.
    worker = await createWorker(lang, 1, { ...paths, workerBlobURL: false, cachePath: 'practice-institute-ocr-v1', cacheMethod: 'readOnly',
      errorHandler: error => self.postMessage({ error: String(error) }),
      logger: m => self.postMessage({ progress: { phase: m.status, percent: Math.round((m.progress ?? 0) * 100) } }) });
    const { data } = await worker.recognize(new Blob([bytes], { type: 'image/png' }));
    const text = data.text.trim();
    const result: OcrResult = { text, confidence: Math.round(data.confidence ?? 0), lines: text.split('\n').map(l => l.trim()).filter(Boolean) };
    self.postMessage({ result });
  } catch (error) { self.postMessage({ error: String(error) }); }
  finally { await worker?.terminate(); }
};
