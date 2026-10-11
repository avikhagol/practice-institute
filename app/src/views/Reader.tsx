import { useMemo, useState } from 'react';
import { PagePreview } from '../components/PagePreview';
import { reflowLines } from '../lib/extract/layout';
import { href } from '../router';
import { useStore } from '../state/store';

/** Document mode: reflowed, readable text per page with the original page alongside. */
export function Reader({ docId }: { docId: string }) {
  const { state } = useStore();
  const loaded = state.docs.find((d) => d.doc.id === docId);
  const [previewPage, setPreviewPage] = useState<number | null>(1);
  const blocks = useMemo(() => loaded?.cleanPages.map((p) => ({ page: p, blocks: reflowLines(p.lines) })) ?? [], [loaded]);

  if (!loaded || !loaded.pdf) {
    return (
      <section className="container page empty">
        <h1>Document not open</h1>
        <p className="muted">The bank and source metadata are saved, but PDF files are kept only in tab memory. Open the PDF again from your library to read its pages.</p>
        <a className="btn btn-primary" href={href({ name: 'library' })}>
          Go to library
        </a>
      </section>
    );
  }
  const { doc, pdf } = loaded;

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <p className="muted" style={{ margin: 0 }}>
            <a href={href({ name: 'library' })}>Library</a> / Reading
          </p>
          <h1>{doc.label}</h1>
        </div>
        <div className="toolbar">
          <button type="button" className="btn btn-secondary btn-sm" aria-pressed={previewPage !== null} onClick={() => setPreviewPage(previewPage === null ? 1 : null)}>
            {previewPage === null ? 'Show original pages' : 'Hide original pages'}
          </button>
        </div>
      </div>
      <p className="callout callout-info">
        This is a reflowed reading view built from the PDF’s text layer. Diagrams, tables, formulas and legacy-font Hindi are not reproduced —
        use “View original” for any page where layout matters.
      </p>
      {doc.warnings
        .filter((w) => w.code === 'legacy-font-encoding' || w.code === 'scanned-or-image-only' || w.code === 'some-pages-low-text')
        .map((w) => (
          <p key={w.code} className="callout callout-warn">
            {w.message}
          </p>
        ))}

      <div className={`reader-layout${previewPage === null ? ' no-preview' : ''}`}>
        <div className="reader">
          <article>
            {blocks.map(({ page, blocks: bs }) => (
              <section key={page.pageNumber} aria-label={`Page ${page.pageNumber}`}>
                <div className="page-marker">
                  <span>Page {page.pageNumber}</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPreviewPage(page.pageNumber)}>
                    View original
                  </button>
                </div>
                {page.lowText && <p className="callout callout-warn">Little or no text on this page — it may be an image or scan. See the original.</p>}
                {bs.map((b, i) =>
                  b.kind === 'heading' ? (
                    <h2 key={i}>{b.text}</h2>
                  ) : (
                    <p key={i} className={b.kind === 'item' ? 'item' : undefined}>
                      {b.text}
                    </p>
                  ),
                )}
              </section>
            ))}
          </article>
        </div>
        {previewPage !== null && (
          <aside className="preview-pane" aria-label="Original page">
            <div className="toolbar">
              <button type="button" className="btn btn-secondary btn-sm" disabled={previewPage <= 1} onClick={() => setPreviewPage(previewPage - 1)}>
                ← Prev
              </button>
              <span className="muted">
                Page {previewPage} / {doc.pagesProcessed}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={previewPage >= doc.pagesProcessed}
                onClick={() => setPreviewPage(previewPage + 1)}
              >
                Next →
              </button>
            </div>
            <PagePreview pdf={pdf} page={previewPage} label={`Original page ${previewPage} of ${doc.fileName}`} />
          </aside>
        )}
      </div>
    </div>
  );
}
