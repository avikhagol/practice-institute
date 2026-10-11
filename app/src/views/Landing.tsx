import { useState } from 'react';
import { DropZone } from '../components/DropZone';
import { LockIcon } from '../components/Icons';
import { navigate } from '../router';
import type { useIngestQueue } from '../state/useIngestQueue';

export const DEMO_FILE = 'pdf-smart-synthetic-demo.pdf';

export async function fetchDemoFile(): Promise<File> {
  const res = await fetch(`${import.meta.env.BASE_URL}demo/${DEMO_FILE}`);
  if (!res.ok) throw new Error(`Example PDF could not be loaded (HTTP ${res.status}).`);
  const blob = await res.blob();
  return new File([blob], DEMO_FILE, { type: 'application/pdf' });
}

export function Landing({ ingest }: { ingest: ReturnType<typeof useIngestQueue> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onFiles = (files: File[]) => {
    ingest.addFiles(files);
    navigate({ name: 'library' });
  };
  const onExample = async () => {
    setBusy(true);
    setErr(null);
    try {
      ingest.addFiles([await fetchDemoFile()], { synthetic: true });
      navigate({ name: 'library' });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Example could not be loaded.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <p className="eyebrow">For CTET, UGC NET &amp; every past paper</p>
            <h1>
              Turn exam PDFs into <em>calm practice</em>.
            </h1>
            <p className="lede">
              Personal PDF practice reads your question papers, lays them out as clean pages, pulls out the multiple-choice questions for you to check, and
              builds randomised practice sets and timed mock exams.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="#upload">
                Start with your PDFs
              </a>
              <button type="button" className="btn btn-ghost" onClick={onExample} disabled={busy}>
                {busy ? 'Loading example…' : 'See it with an example'}
              </button>
            </div>
            {err && (
              <p className="callout callout-danger" role="alert">
                {err}
              </p>
            )}
          </div>
          <div className="paper-stack" aria-hidden="true">
            <div className="paper-sheet" />
            <div className="paper-sheet" />
            <div className="paper-sheet">
              <div className="sheet-line" style={{ width: '45%' }} />
              <div className="sheet-line" style={{ width: '80%' }} />
              <p className="sheet-q">Q 13. Learners who prefer doing and moving are…</p>
              <div className="sheet-opt">A · visual</div>
              <div className="sheet-opt is-picked">B · kinaesthetic</div>
              <div className="sheet-opt">C · auditory</div>
              <div className="sheet-opt">D · verbal</div>
              <span className="sheet-timer">24:59</span>
            </div>
          </div>
        </div>
      </section>

      <section className="container" id="upload" aria-label="Upload PDFs">
        <DropZone onFiles={onFiles} onExample={onExample} exampleBusy={busy} />
        <div className="privacy-note">
          <LockIcon />
          <p style={{ margin: 0 }}>
            <strong>Private by design.</strong> Your PDFs are opened and read on this device using PDF.js. Nothing is uploaded, this mode uses no
            account and no server. Question banks and exam attempts are stored only in this browser until you clear them.
          </p>
        </div>
      </section>

      <section className="steps container" aria-labelledby="how">
        <h2 id="how" style={{ fontSize: 'var(--text-3xl)' }}>
          How it works
        </h2>
        <ol className="steps-grid">
          <li className="step">
            <h3>Read beautifully</h3>
            <p>Each PDF becomes a reflowed, readable page — with the original page one click away whenever layout, tables or diagrams matter.</p>
          </li>
          <li className="step">
            <h3>Check the questions</h3>
            <p>Numbered MCQs are extracted with page references and confidence flags. You fix, exclude or approve before anything is tested.</p>
          </li>
          <li className="step">
            <h3>Practise &amp; time yourself</h3>
            <p>Mix papers from several years, draw a random set, and take an untimed practice or a timed mock that survives a page refresh.</p>
          </li>
        </ol>
      </section>

      <section className="honest" aria-labelledby="honest">
        <div className="container">
          <h2 id="honest" style={{ fontSize: 'var(--text-2xl)' }}>
            What to expect, honestly
          </h2>
          <ul>
            <li>Extraction is heuristic. Layouts vary, so every question shows its source page and any warnings for you to check.</li>
            <li>Scanned (image-only) PDFs are detected and flagged; this version does not run OCR on them.</li>
            <li>Hindi typed in legacy fonts (e.g. Kruti Dev) cannot be turned into readable text; it stays visible in the original page view.</li>
            <li>Answers are never guessed. Scores appear only when you import or enter an answer key.</li>
            <li>The exam timer runs in your browser — great for practice, not a secure proctored exam.</li>
            <li>The bundled example is an original synthetic paper, not a real CTET/NET paper. Download official papers from the exam boards.</li>
          </ul>
        </div>
      </section>
    </>
  );
}
