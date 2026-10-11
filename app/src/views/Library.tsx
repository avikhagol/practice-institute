import { useState } from 'react';
import { DropZone } from '../components/DropZone';
import { formatBytes } from '../lib/pdf/limits';
import { href } from '../router';
import { useStore } from '../state/store';
import type { Job, useIngestQueue } from '../state/useIngestQueue';
import { fetchDemoFile } from './Landing';

function jobText(j: Job): string {
  switch (j.status) {
    case 'queued':
      return 'Waiting…';
    case 'working': {
      const p = j.progress;
      if (!p) return 'Starting…';
      if (p.phase === 'extracting') return `Reading page ${p.page} of ${p.pageTotal}`;
      if (p.phase === 'parsing') return 'Finding questions…';
      if (p.phase === 'opening') return 'Opening with PDF.js…';
      return 'Loading file…';
    }
    case 'done':
      return `Done · ${j.questionCount} question candidate${j.questionCount === 1 ? '' : 's'}`;
    case 'cancelled':
      return 'Cancelled';
    case 'error':
      return 'Could not be processed';
  }
}

function pct(j: Job): number {
  if (j.status === 'done') return 100;
  const p = j.progress;
  if (!p) return 2;
  if (p.phase === 'extracting' && p.pageTotal) return 10 + Math.round((80 * (p.page ?? 0)) / p.pageTotal);
  if (p.phase === 'parsing') return 95;
  return p.phase === 'opening' ? 8 : 4;
}

export function Library({ ingest }: { ingest: ReturnType<typeof useIngestQueue> }) {
  const { state, dispatch } = useStore();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onExample = async () => {
    setBusy(true);
    setErr(null);
    try {
      ingest.addFiles([await fetchDemoFile()], { synthetic: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Example could not be loaded.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1>Your library</h1>
          <p className="muted" style={{ margin: 0 }}>
            The bank stays on this device. Original PDFs stay in tab memory and must be opened again after a reload.
          </p>
        </div>
        {state.questions.length > 0 && (
          <a className="btn btn-primary" href={href({ name: 'review' })}>
            Review {state.questions.length} questions
          </a>
        )}
      </div>

      {ingest.notice && (
        <p className="callout callout-warn" role="status">
          {ingest.notice}
        </p>
      )}
      {err && (
        <p className="callout callout-danger" role="alert">
          {err}
        </p>
      )}

      {ingest.jobs.length > 0 && (
        <section aria-labelledby="queue-h" style={{ marginBottom: 'var(--s-6)' }}>
          <h2 id="queue-h" style={{ fontSize: 'var(--text-xl)' }}>
            Processing
          </h2>
          <ul className="queue" aria-live="polite">
            {ingest.jobs.map((j) => (
              <li key={j.key} className={`queue-item${j.status === 'error' ? ' is-error' : ''}`}>
                <span className="file-badge" aria-hidden="true">
                  PDF
                </span>
                <div>
                  <div className="queue-name">{j.file.name}</div>
                  <div className="queue-meta">
                    {formatBytes(j.file.size)} · {jobText(j)}
                  </div>
                </div>
                <div>
                  {j.status === 'queued' || j.status === 'working' ? (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => ingest.cancel(j.key)} aria-label={`Cancel ${j.file.name}`}>
                      Cancel
                    </button>
                  ) : (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => ingest.dismiss(j.key)} aria-label={`Dismiss ${j.file.name}`}>
                      Dismiss
                    </button>
                  )}
                </div>
                {(j.status === 'queued' || j.status === 'working') && (
                  <div className="progress" role="progressbar" aria-label={`${j.file.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct(j)}>
                    <span style={{ width: `${pct(j)}%` }} />
                  </div>
                )}
                {j.error && <p className="queue-error">{j.error}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {state.docs.length > 0 && (
        <section aria-labelledby="docs-h" style={{ marginBottom: 'var(--s-6)' }}>
          <h2 id="docs-h" style={{ fontSize: 'var(--text-xl)' }}>
            Documents
          </h2>
          <div className="doc-grid">
            {state.docs.map(({ doc, pdf }) => {
              const qs = state.questions.filter((q) => q.docId === doc.id);
              const review = qs.filter((q) => q.status === 'needs-review').length;
              const ready = qs.filter(q => q.status === 'ok').length;
              return (
                <article key={doc.id} className="panel doc-card">
                  <h3>{doc.label}</h3>
                  <p className="muted">{doc.fileName}</p>
                  <DocMetadata doc={doc} />
                  {doc.synthetic && <span className="chip chip-warn">Synthetic demo — not a real exam paper</span>}
                  <div className="stats">
                    <span className="chip">{doc.pageCount} pages</span>
                    {doc.year && <span className="chip">Year: {doc.year}</span>}
                    <span className="chip chip-ok">{ready} ready</span>
                    {review > 0 && <span className="chip chip-warn">{review} to review</span>}
                  </div>
                  {doc.warnings
                    .filter((w) => w.code !== 'headers-footers-removed')
                    .map((w) => (
                      <p key={w.code} className={`callout ${w.code === 'scanned-or-image-only' ? 'callout-danger' : 'callout-warn'}`}>
                        {w.message}
                      </p>
                    ))}
                  <div className="actions">
                    {pdf ? <a className="btn btn-secondary btn-sm" href={href({ name: 'read', docId: doc.id })}>Read as page</a> : <p className="muted">Source not loaded — open the PDF again for reading and preview.</p>}
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => {
                        dispatch({ type: 'remove-doc', docId: doc.id });
                        void pdf?.loadingTask.destroy();
                      }}
                      aria-label={`Remove ${doc.label}`}
                    >
                      Remove
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <DropZone onFiles={(f) => ingest.addFiles(f)} onExample={onExample} exampleBusy={busy} compact={state.docs.length > 0} />
    </div>
  );
}

function DocMetadata({ doc }: { doc: import('../lib/types').SourceDoc }) {
  const { dispatch } = useStore();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(doc.label);
  const [year, setYear] = useState(doc.year ?? '');
  if (!editing) return <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setLabel(doc.label); setYear(doc.year ?? ''); setEditing(true); }}>Edit label and year</button>;
  return <form className="metadata-editor" aria-label={`Edit source ${doc.fileName}`} onSubmit={e => { e.preventDefault(); dispatch({ type: 'update-doc', docId: doc.id, patch: { label: label.trim(), year: year.trim() || null } }); setEditing(false); }}>
    <label className="field">Source label<input autoFocus required maxLength={300} value={label} onChange={e => setLabel(e.target.value)} /></label>
    <label className="field">Year (optional)<input maxLength={40} value={year} onChange={e => setYear(e.target.value)} /></label>
    <div className="toolbar"><button type="submit" className="btn btn-primary btn-sm" disabled={!label.trim()}>Save source</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>Cancel</button></div>
  </form>;
}
