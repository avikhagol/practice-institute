import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { renderPageToCanvas } from '../lib/pdf/ingest';

/** Renders one original PDF page with PDF.js into a canvas (on demand, one at a time). */
export function PagePreview({ pdf, page, width = 400, label }: { pdf: PDFDocumentProxy | null; page: number; width?: number; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let cancelled = false;
    let task: Awaited<ReturnType<typeof renderPageToCanvas>> | null = null;
    setState('loading');
    renderPageToCanvas(pdf, page, canvas.current, width)
      .then((t) => {
        task = t;
        if (!cancelled) setState('ready');
      })
      .catch((e: unknown) => {
        if (!cancelled && (e as { name?: string })?.name !== 'RenderingCancelledException') setState('error');
      });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, page, width]);

  if (!pdf) return <p className="callout callout-warn">The original file is no longer in memory. Re-open the PDF to see page previews.</p>;
  return (
    <figure style={{ margin: 0 }}>
      <canvas ref={canvas} role="img" aria-label={label} />
      <figcaption className="muted" style={{ fontSize: 'var(--text-sm)', marginTop: 'var(--s-2)' }}>
        {state === 'loading' && 'Rendering original page…'}
        {state === 'ready' && label}
        {state === 'error' && 'This page could not be rendered.'}
      </figcaption>
    </figure>
  );
}
