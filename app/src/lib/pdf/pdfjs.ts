// Lazy PDF.js loader. The ~1.6 MB library + worker are only fetched when the user
// actually opens a PDF, never on first paint of the landing page.
//
// Worker configuration: the worker is emitted by Vite as a hashed asset via `?url`,
// so it resolves correctly under any base path (e.g. /<repo>/ on GitHub Pages).
// CMaps / standard fonts / wasm decoders are copied to public/pdfjs by
// scripts/copy-pdfjs-assets.mjs and addressed relative to import.meta.env.BASE_URL.
import type * as PdfJs from 'pdfjs-dist';

let loading: Promise<typeof PdfJs> | null = null;

export function loadPdfJs(): Promise<typeof PdfJs> {
  if (!loading) {
    loading = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(
      ([lib, worker]) => {
        lib.GlobalWorkerOptions.workerSrc = worker.default;
        return lib;
      },
    );
    loading.catch(() => {
      loading = null; // allow retry after a network/asset failure
    });
  }
  return loading;
}

export function assetBase(): string {
  // BASE_URL is './' for relocatable builds or '/<repo>/' for Pages builds.
  return new URL(`${import.meta.env.BASE_URL}pdfjs/`, document.baseURI).href;
}

export function documentOptions(data: Uint8Array) {
  const base = assetBase();
  return {
    data,
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
    iccUrl: `${base}iccs/`,
    // Security: never render XFA/JS-driven forms and never fetch anything the PDF points to.
    enableXfa: false,
    isOffscreenCanvasSupported: true,
    stopAtErrors: false,
  };
}
