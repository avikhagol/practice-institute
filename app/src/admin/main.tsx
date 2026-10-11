import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/fraunces';
import '@fontsource-variable/source-sans-3';
import '@fontsource/noto-sans-devanagari/400.css';
import '../styles/tokens.css';
import './style.css';
import { api, setSession, SESSION_EXPIRED_MESSAGE, type Session, type Source, type BankQuestion, type Exam, type Attempt } from './api';
import { ingestPdf } from '../lib/pdf/ingest';
import { pairQuestions, bilingualCandidates, ocrPagesToPageText } from './import';
import { loadPdfJs, documentOptions } from '../lib/pdf/pdfjs';
import {
  recognizeCanvas,
  recognizePdfPages,
  checkOcrAssetStatus,
  MAX_OCR_PAGES,
  MAX_OCR_PIXELS,
  type OcrLanguage,
} from '../lib/ocr/engine';
import { analysePages } from '../lib/extract/analyse';

const sections = ['Dashboard', 'Sources', 'Question bank', 'Exams', 'Results'] as const;
type Section = typeof sections[number];
const when = (time: number) => `${new Date(time).toLocaleString()} · ${new Date(time).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')}`;
const message = (e: unknown) => e instanceof Error ? e.message : 'Something went wrong.';
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }
function Chip({ status }: { status: string }) { return <span className={`chip ${status}`}>{status.replaceAll('-', ' ')}</span>; }

function App() {
  const heading = useRef<HTMLHeadingElement>(null);
  const [session, updateSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<Section>('Dashboard');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [questions, setQuestions] = useState<BankQuestion[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [selected, setSelected] = useState<BankQuestion | null>(null);
  const [bankSource, setBankSource] = useState('');
  const [resultExam, setResultExam] = useState<number | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [ocrSource, setOcrSource] = useState<Source | null>(null);
  const [stats, setStats] = useState<{ questions: { qid: string; choices: Record<string, number>; correct: number; offered: number; unanswered: number }[]; ranks: { rank: number; alias: string; score: number }[] }>({ questions: [], ranks: [] });

  async function refresh() {
    const [s, q, e] = await Promise.all([api<{ sources: Source[] }>('sources'), api<{ questions: BankQuestion[] }>('questions'), api<{ exams: Exam[] }>('exams')]);
    setSources(s.sources); setQuestions(q.questions); setExams(e.exams);
  }
  function accept(s: Session | null) { setSession(s); updateSession(s); }
  async function task(work: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  useEffect(() => {
    api<Session>('me').then(s => { accept(s); return refresh(); }).catch(() => {}).finally(() => setLoading(false));
    const expire = () => { accept(null); setError(SESSION_EXPIRED_MESSAGE); };
    window.addEventListener('admin-session-expired', expire);
    return () => window.removeEventListener('admin-session-expired', expire);
  }, []);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    await task(async () => { const s = await api<Session>('login', { username: data.get('username'), password: data.get('password') }); accept(s); await refresh(); });
  }
  async function showResults(id: number) {
    const [a, s] = await Promise.all([api<{ attempts: Attempt[] }>(`exams/${id}/attempts`), api<typeof stats>(`exams/${id}/stats`)]);
    setResultExam(id); setAttempts(a.attempts); setStats(s); setSection('Results');
  }
  useEffect(() => { heading.current?.focus(); }, [session?.username, section]);
  if (loading) return <main className="login"><p role="status">Opening your study desk…</p></main>;
  if (!session) return <main className="login"><p className="eyebrow">Practice Institute · Administration</p><h1>Your study desk</h1><p>Prepare papers, review original text, and run shared exams.</p><form onSubmit={login}><Field label="Username"><input name="username" autoComplete="username" required autoFocus maxLength={64} /></Field><Field label="Password"><input name="password" type="password" autoComplete="current-password" required maxLength={256} /></Field><button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form>{error && <p role="alert" className="error">{error}</p>}<p className="muted">Use the account created with pi-admin setup.</p></main>;
  const canPublish = session.role === 'owner';

  return <div className="desk"><a className="skip" href="#content">Skip to content</a><aside><div className="brand">Practice <br />Institute<span>Admin study desk</span></div><nav aria-label="Admin navigation">{sections.map(s => <button key={s} className={section === s ? 'active' : ''} aria-current={section === s ? 'page' : undefined} onClick={() => { setSection(s); setError(''); setNotice(''); }}>{s}</button>)}</nav><div className="account"><strong>{session.username}</strong><span>{session.role}</span><button disabled={busy} onClick={() => void task(async () => { await api('logout', {}); accept(null); })}>Sign out</button></div></aside><main id="content" tabIndex={-1}><header><div><p className="eyebrow">Practice Institute / {section}</p><h1 ref={heading} tabIndex={-1}>{section}</h1></div><button className="secondary" disabled={busy} onClick={() => void task(async () => { await refresh(); if (resultExam) await showResults(resultExam); setNotice('Up to date.'); })}>Refresh</button></header><div aria-live="polite">{notice && <p className="notice">{notice}</p>}{busy && <p className="muted">Working…</p>}</div>{error && <p role="alert" className="error">{error}</p>}
    {section === 'Dashboard' && <><p className="intro">A careful review makes a fair paper. Start with an original source, then verify each question before publishing.</p><div className="metrics"><article><span>Original sources</span><strong>{sources.length}</strong></article><article><span>Needs review</span><strong>{questions.filter(q => q.status === 'needs-review').length}</strong></article><article><span>Published exams</span><strong>{exams.filter(e => e.status === 'published').length}</strong></article></div><div className="card"><h2>Prepare an exam</h2><ol className="steps"><li><button className="text" onClick={() => setSection('Sources')}>Upload a source with provenance</button><p>Keep the original PDF and import text candidates.</p></li><li><button className="text" onClick={() => setSection('Question bank')}>Review both languages and verify keys</button><p>Missing language versions stay missing; original text is never translated.</p></li><li><button className="text" onClick={() => setSection('Exams')}>Build a draft and publish</button><p>Publishing freezes the paper. Later bank edits cannot alter its grades.</p></li></ol></div></>}
    {section === 'Sources' && <><SourceUpload busy={busy} sources={sources} run={task} done={refresh} notify={setNotice} />{ocrSource && <SourceOcrModal key={ocrSource.id} source={ocrSource} onClose={() => setOcrSource(null)} done={refresh} notify={setNotice} run={task} busy={busy} />}<div className="card"><h2>Source library</h2>{sources.length === 0 ? <p>No sources yet. Upload your first paper above.</p> : <div className="table-wrap" role="region" aria-label="Source library table" tabIndex={0}><table><thead><tr><th>Source</th><th>Pages</th><th>Provenance</th><th>Actions</th></tr></thead><tbody>{sources.map(s => <tr key={s.id}><td><strong>{s.label}</strong><small>{s.filename} · {s.year || 'Year unset'} · {s.subject || 'Subject unset'}</small></td><td>{s.page_count}</td><td>{s.provenance}</td><td><div className="actions horizontal" style={{ margin: 0, gap: '8px' }}><button className="secondary" onClick={() => { setBankSource(String(s.id)); setSelected(null); setSection('Question bank'); setNotice(`Source ${s.label}: ${questions.filter(q => q.source_id === s.id).length} imported questions.`); }}>Review questions</button><button className="secondary" onClick={() => setOcrSource(s)}>Run OCR scan</button></div></td></tr>)}</tbody></table></div>}</div></>}
    {section === 'Question bank' && <Bank source={bankSource} setSource={setBankSource} questions={questions} sources={sources} selected={selected} select={setSelected} busy={busy} run={task} notify={setNotice} saved={async () => { setSelected(null); await refresh(); }} />}
    {section === 'Exams' && <><ExamBuilder questions={questions} sources={sources} busy={busy} run={task} done={refresh} notify={setNotice} /><div className="card"><h2>Exams & availability</h2>{exams.length === 0 ? <p>No exams yet. Choose reviewed questions to create a draft.</p> : exams.map(e => { const qs = JSON.parse(e.question_ids_json) as number[]; const blocked = qs.some(id => { const q = questions.find(v => v.id === id); return !q || q.status !== 'reviewed' || (e.scored && !q.key_verified); }); return <article className="exam-row" key={e.id}><div><h3>{e.title} <Chip status={e.status} /></h3><p><strong className="code">{e.code}</strong> · {e.mode} · {e.subset_count ?? qs.length} questions{e.subset_count ? ` from ${qs.length}` : ''} · {e.attempts} attempts</p><small>{when(e.opens_at)} → {when(e.closes_at)}</small></div><div className="actions">{e.status === 'draft' && <><button disabled={busy || !canPublish || blocked} onClick={() => void task(async () => { await api(`exams/${e.id}/publish`, {}); await refresh(); setNotice(`Published ${e.code}. Share this join code with students.`); })}>Publish paper</button><small>{!canPublish ? 'An owner publishes exams.' : blocked ? 'Review every question and verify keys for a scored exam before publishing.' : 'Publishing freezes this paper and its answer keys.'}</small></>}{e.status !== 'draft' && <><button className="secondary" disabled={busy} onClick={() => void task(() => showResults(e.id))}>View attempts</button>{e.status === 'published' && canPublish && <><form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void task(async () => { await api(`exams/${e.id}/extend`, { seconds: Number(data.get('minutes')) * 60 }); await refresh(); setNotice('Exam extended. Active deadlines updated; finished attempts stay closed.'); }); }} className="inline"><Field label="Extension (minutes)"><input name="minutes" type="number" min="1" max="360" defaultValue="5" required /></Field><button className="secondary" disabled={busy}>Extend</button></form><button className="danger" disabled={busy} onClick={() => { if (window.confirm(`Close ${e.title}? Active attempts will be finalised immediately.`)) void task(async () => { await api(`exams/${e.id}/close`, {}); await refresh(); setNotice('Exam closed.'); }); }}>Close exam</button></>}</>}</div></article>; })}</div></>}
    {section === 'Results' && <div className="card"><h2>Attempts & results</h2><Field label="Exam"><select value={resultExam ?? ''} onChange={e => { if (e.target.value) void task(() => showResults(Number(e.target.value))); }}><option value="">Choose a published exam</option>{exams.filter(e => e.status !== 'draft').map(e => <option key={e.id} value={e.id}>{e.title} · {e.code}</option>)}</select></Field>{resultExam && <><div className="actions horizontal"><a className="button secondary" href={`/api/admin/exams/${resultExam}/export.csv`}>Download CSV</a>{canPublish && <>{(['scores', 'answers', 'ranks'] as const).map(kind => <label className="check" key={kind}><input type="checkbox" disabled={busy} checked={Boolean(exams.find(e => e.id === resultExam)?.[`release_${kind}`])} onChange={event => { const value = event.target.checked; void task(async () => { setExams(current => current.map(e => e.id === resultExam ? { ...e, [`release_${kind}`]: value } : e)); try { await api(`exams/${resultExam}/release`, { [kind]: value }); } finally { await refresh(); } setNotice(`${kind[0]!.toUpperCase()}${kind.slice(1)} ${value ? 'released' : 'hidden'}.`); }); }} />Release {kind}</label>)}</>}</div><div className="table-wrap" role="region" aria-label="Attempt activity table" tabIndex={0}><table><caption>Attempt activity (refresh to update)</caption><thead><tr><th>Alias</th><th>Attempt</th><th>Status</th><th>Answered</th><th>Score</th><th>Deadline</th></tr></thead><tbody>{attempts.map(a => <tr key={a.id}><td>{a.alias}</td><td>{a.attempt_number}</td><td><Chip status={a.status} /></td><td>{a.answered}</td><td>{a.score ?? '—'}</td><td>{when(a.deadline_at)}</td></tr>)}</tbody></table></div>{attempts.length === 0 && <p>No students have joined yet.</p>}<h3>Per-question stats · finished attempts</h3><div className="table-wrap" role="region" aria-label="Question statistics table" tabIndex={0}><table><thead><tr><th>Question</th><th>Choice counts</th><th>Correct</th><th>Assigned</th><th>Unanswered</th></tr></thead><tbody>{stats.questions.map(q => <tr key={q.qid}><td>{q.qid}</td><td>{Object.entries(q.choices).map(([key, n]) => `${key}: ${n}`).join(' · ')}</td><td>{q.correct}</td><td>{q.offered}</td><td>{q.unanswered}</td></tr>)}</tbody></table></div><h3>Alias-only ranks · best finished score per saved identity</h3>{stats.ranks.length ? <ol>{stats.ranks.map(r => <li key={r.alias}>Rank {r.rank} · {r.alias} · {r.score}</li>)}</ol> : <p>No finished, scored attempts to rank yet.</p>}</>}</div>}
  </main></div>;
}

function SourceUpload({ busy, sources, run, done, notify }: { busy: boolean; sources: Source[]; run: (w: () => Promise<void>) => Promise<void>; done: () => Promise<void>; notify: (s: string) => void }) {
  const [progress, setProgress] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const file = data.get('file') as File;
    await run(async () => {
      setProgress('Uploading original PDF…');
      const source = await api<{ id: number; duplicate: boolean; page_count: number }>('sources/upload', data);
      const existing = await api<{ questions: BankQuestion[] }>(`questions?source_id=${source.id}`);
      const importedNumbers = new Set(existing.questions.map(q => q.source_number));
      const abort = new AbortController(); controller.current = abort;
      let result;
      try {
        result = await ingestPdf(file, { signal: abort.signal, onProgress: p => setProgress(`${p.phase}${p.page ? ` · page ${p.page} of ${p.pageTotal}` : ''}`) });
        const paired = pairQuestions(bilingualCandidates(result.doc.id, result.cleanPages, result.questions), { id: source.id, year: String(data.get('year') || '') || null, subject: String(data.get('subject') || '') || null }).filter(q => !importedNumbers.has(q.source_number));
        let imported = 0;
        for (let i = 0; i < paired.length; i += 10) { if (abort.signal.aborted) throw new Error('Import cancelled. The original source is stored; already imported questions remain in the bank.'); await api('questions', paired.slice(i, i + 10)); imported += paired.slice(i, i + 10).length; }
        notify(`${source.duplicate ? 'Identical original already stored; existing question numbers skipped.' : 'Original stored.'} ${imported} question candidates imported as needs review. ${result.doc.warnings.map(w => w.code === 'scanned-or-image-only' ? 'Scanned pages have no selectable text. Use Run OCR scan in the source library, then review candidates.' : w.message).join(' ')}`);
        form.reset();
      } catch (e) { notify(`Original PDF stored as source ${source.id}; extraction did not finish. Review the source or add questions manually.`); throw e; }
      finally { await result?.pdf.loadingTask.destroy(); setProgress(''); controller.current = null; await done(); }
    });
  }
  return <div className="card"><h2>Upload an original paper</h2><p>PDF only · up to 40 MB / 200 pages by default. Text extraction runs locally, then sends candidates to this bank. You can also run bounded on-demand OCR for scanned or non-Unicode Hindi papers.</p><form onSubmit={upload}><div className="form-grid"><Field label="Original PDF"><input name="file" type="file" accept="application/pdf,.pdf" required disabled={busy} /></Field><Field label="Source label"><input name="label" required maxLength={200} placeholder="CTET · December 2024 · Paper I" /></Field><Field label="Exam body"><input name="exam_body" maxLength={120} /></Field><Field label="Year"><input name="year" maxLength={16} /></Field><Field label="Subject"><input name="subject" maxLength={120} /></Field><Field label="Provenance / licence / consent note"><textarea name="provenance" required maxLength={4000} placeholder="Where this paper came from and why you may use it" /></Field></div><label className="check"><input name="consent" type="checkbox" value="true" required />I have permission to store and use this source for practice.</label><label className="check"><input name="synthetic" type="checkbox" value="true" />This is a synthetic practice paper.</label><div className="actions horizontal"><button disabled={busy}>{busy ? 'Processing…' : 'Upload & extract text'}</button>{progress && <button type="button" className="secondary" onClick={() => controller.current?.abort()} disabled={!controller.current}>Cancel extraction</button>}</div><p role="status">{progress}</p></form><small>{sources.length} stored source(s). Identical files are detected by SHA-256.</small></div>;
}

function SourceOcrModal({
  source,
  onClose,
  done,
  notify,
  run,
  busy,
}: {
  source: Source;
  onClose: () => void;
  done: () => Promise<void>;
  notify: (s: string) => void;
  run: (w: () => Promise<void>) => Promise<void>;
  busy: boolean;
}) {
  const [lang, setLang] = useState<OcrLanguage>('eng+hin');
  const [startPage, setStartPage] = useState(1);
  const [endPage, setEndPage] = useState(Math.min(source.page_count, 10));
  const [concurrency, setConcurrency] = useState(1);
  const [progress, setProgress] = useState('');
  const [jobError, setJobError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const [assetStatus, setAssetStatus] = useState<{ available: boolean; statusText: string }>({ available: false, statusText: 'Checking local assets…' });
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true; setAssetStatus({ available: false, statusText: 'Checking local assets…' });
    checkOcrAssetStatus(lang).then(s => { if (active) setAssetStatus(s); });
    return () => { active = false; };
  }, [lang]);

  useEffect(() => () => controller.current?.abort(), []);

  async function startOcr() {
    await run(async () => {
      const abort = new AbortController();
      controller.current = abort;
      setProgress('Opening source PDF…'); setJobError('');
      let pdf: PDFDocumentProxy | undefined;
      try {
        const response = await fetch(`/api/admin/sources/${source.id}/file`, { credentials: 'same-origin', signal: abort.signal });
        if (!response.ok) throw new Error('Source PDF download failed.');
        const bytes = new Uint8Array(await response.arrayBuffer());
        const lib = await loadPdfJs();
        pdf = await lib.getDocument(documentOptions(bytes)).promise;

        const pagesToProcess: number[] = [];
        for (let p = Math.max(1, startPage); p <= Math.min(source.page_count, endPage); p++) {
          pagesToProcess.push(p);
        }

        setProgress(`Starting OCR (${pagesToProcess.length} pages, ${lang})…`);
        const ocrItems = await recognizePdfPages(pdf, pagesToProcess, {
          lang,
          concurrency,
          signal: abort.signal,
          onProgress: p => setProgress(`Page ${p.page || 1} of ${p.totalPages || pagesToProcess.length}: ${p.phase} (${p.percent}%)`),
        });

        setProgress('Parsing extracted question candidates…');
        const docId = `ocr-${source.id}`;
        const pageTexts = ocrPagesToPageText(docId, ocrItems);
        const { questions } = analysePages(docId, pageTexts);
        const paired = pairQuestions(
          bilingualCandidates(docId, pageTexts, questions),
          { id: source.id, year: source.year, subject: source.subject },
          'ocr',
        );

        const existing = await api<{ questions: BankQuestion[] }>(`questions?source_id=${source.id}`);
        const importedNumbers = new Set(existing.questions.map(q => q.source_number));
        const filtered = paired.filter(q => !importedNumbers.has(q.source_number));

        for (const q of filtered) {
          const confidence = ocrItems.find(p => p.pageNumber === q.source_page)?.confidence ?? 0;
          q.warnings.push(`OCR page confidence ${confidence}%. Confidence is not accuracy.`);
          if (confidence < 80) q.warnings.push('Low OCR confidence; manually verify every character and option.');
        }
        let imported = 0;
        for (let i = 0; i < filtered.length; i += 10) {
          if (abort.signal.aborted) throw new Error('OCR import cancelled.');
          await api('questions', filtered.slice(i, i + 10));
          imported += filtered.slice(i, i + 10).length;
        }

        notify(`OCR complete. Imported ${imported} candidates as needs-review; ${paired.length - filtered.length} existing question numbers skipped. Existing English/Hindi fields are preserved. Use crop correction for missing Hindi or unnumbered blocks; review every option before publishing.`);
        onClose();
        await done();
      } catch (error) {
        setJobError(message(error)); throw error;
      } finally {
        await pdf?.loadingTask.destroy();
        controller.current = null;
        setProgress('');
      }
    });
  }

  return (
    <dialog ref={dialog} className="modal-overlay" aria-labelledby="ocr-modal-title" onCancel={e => { if (progress) { e.preventDefault(); controller.current?.abort(); } else onClose(); }}>
      <div className="ocr-dialog">
        <h2 id="ocr-modal-title">Run OCR on {source.label}</h2>
        <p className="muted">{source.filename} · {source.page_count} pages total</p>
        <div className="form-grid">
          <Field label="OCR Language">
            <select value={lang} onChange={e => setLang(e.target.value as OcrLanguage)} disabled={Boolean(progress)}>
              <option value="eng+hin">Bilingual (English + हिन्दी)</option>
              <option value="hin">Hindi only (Devanagari)</option>
              <option value="eng">English only (Latin)</option>
            </select>
          </Field>
          <Field label="Concurrency">
            <select value={concurrency} onChange={e => setConcurrency(Number(e.target.value))} disabled={Boolean(progress)}>
              <option value="1">1 page (low memory, safe)</option>
              <option value="2">2 pages (faster)</option>
            </select>
          </Field>
          <Field label="Start page">
            <input type="number" min={1} max={source.page_count} value={startPage} onChange={e => setStartPage(Number(e.target.value))} disabled={Boolean(progress)} />
          </Field>
          <Field label="End page">
            <input type="number" min={startPage} max={source.page_count} value={endPage} onChange={e => setEndPage(Number(e.target.value))} disabled={Boolean(progress)} />
          </Field>
        </div>
        <p className="badge-pill">{assetStatus.statusText}</p><p className="muted">Up to 20 pages per job, 8 megapixels per page, 1–2 concurrent pages. Start downloads language data from this server. Documents stay in your browser during OCR.</p>
        {jobError && <p role="alert" className="error">{jobError}</p>}
        {progress && <p role="status"><strong>{progress}</strong></p>}
        <div className="actions horizontal">
          {!progress ? (
            <>
              <button disabled={busy || !assetStatus.available || !Number.isInteger(startPage) || !Number.isInteger(endPage) || startPage < 1 || endPage > source.page_count || endPage < startPage || endPage - startPage + 1 > MAX_OCR_PAGES} onClick={() => void startOcr()}>Start OCR extraction</button>
              <button type="button" className="secondary" onClick={onClose}>Close</button>
            </>
          ) : (
            <button type="button" className="danger" onClick={() => controller.current?.abort()}>Cancel OCR job</button>
          )}
        </div>
      </div>
    </dialog>
  );
}

function SourcePreview({
  q,
  cropJson,
  onCropChange,
  onApplyCropText,
}: {
  q: BankQuestion;
  cropJson?: string | null;
  onCropChange?: (crop: string) => void;
  onApplyCropText?: (target: string, text: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const cropCanvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [cropMode, setCropMode] = useState(false);
  const [ready, setReady] = useState(false);
  const cropController = useRef<AbortController | null>(null);
  const [cropProgress, setCropProgress] = useState('');
  const [cropError, setCropError] = useState('');
  useEffect(() => () => cropController.current?.abort(), []);
  const [crop, setCrop] = useState<{ x: number; y: number; w: number; h: number }>(() => {
    if (cropJson) {
      try { const c = JSON.parse(cropJson); if ([c.x,c.y,c.w,c.h].every(Number.isFinite) && c.x >= 0 && c.y >= 0 && c.w > 0 && c.h > 0 && c.x+c.w <= 1 && c.y+c.h <= 1) return c; } catch {}
    }
    return { x: 0, y: 0, w: 1, h: 1 };
  });
  const [ocrLang, setOcrLang] = useState<OcrLanguage>('eng+hin');
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrResult, setOcrResult] = useState<{ text: string; confidence: number } | null>(null);

  useEffect(() => {
    let disposed = false; let pdf: PDFDocumentProxy | undefined;
    const abort = new AbortController(); setError(''); setReady(false);
    if (q.source_id && q.source_page) {
      void (async () => {
        try {
          const response = await fetch(`/api/admin/sources/${q.source_id}/file`, { credentials: 'same-origin', signal: abort.signal });
          if (!response.ok) throw new Error('Source preview unavailable.');
          const bytes = new Uint8Array(await response.arrayBuffer());
          const lib = await loadPdfJs();
          pdf = await lib.getDocument(documentOptions(bytes)).promise;
          if (!disposed && canvas.current) {
            const page = await pdf.getPage(q.source_page!);
            const base = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: Math.min(2, Math.sqrt(MAX_OCR_PIXELS / (base.width * base.height))) });
            const target = canvas.current; target.width = Math.floor(viewport.width); target.height = Math.floor(viewport.height);
            const width = Math.min(target.parentElement?.clientWidth ?? 340, 500) * zoom;
            target.style.width = `${width}px`; target.style.height = `${width * target.height / target.width}px`;
            try { await page.render({ canvas: target, viewport }).promise; } finally { page.cleanup(); }
            if (!disposed) setReady(true);
          }
        } catch (e) {
          if (!disposed) setError(message(e));
        } finally {
          if (disposed) await pdf?.loadingTask.destroy();
        }
      })();
    }
    return () => { disposed = true; abort.abort(); void pdf?.loadingTask.destroy(); };
  }, [q.id, q.source_id, q.source_page, zoom]);

  function updateCropCanvas() {
    if (!canvas.current || !cropCanvas.current) return;
    const src = canvas.current;
    const dest = cropCanvas.current;
    const cw = src.width * crop.w;
    const ch = src.height * crop.h;
    const cx = src.width * crop.x;
    const cy = src.height * crop.y;
    dest.width = Math.max(1, Math.floor(cw));
    dest.height = Math.max(1, Math.floor(ch));
    const ctx = dest.getContext('2d');
    if (ctx) {
      ctx.drawImage(src, cx, cy, cw, ch, 0, 0, dest.width, dest.height);
    }
  }

  useEffect(() => {
    updateCropCanvas();
  }, [crop, zoom, cropMode, ready]);

  function handlePreset(preset: 'full' | 'top' | 'bottom') {
    let next = { x: 0, y: 0, w: 1, h: 1 };
    if (preset === 'top') next = { x: 0, y: 0, w: 1, h: 0.5 };
    else if (preset === 'bottom') next = { x: 0, y: 0.5, w: 1, h: 0.5 };
    setCrop(next);
    onCropChange?.(JSON.stringify({ page: q.source_page, ...next }));
  }

  function changeCrop(field: 'x' | 'y' | 'w' | 'h', percent: number) {
    const next = { ...crop, [field]: percent / 100 };
    next.w = Math.min(next.w, 1 - next.x); next.h = Math.min(next.h, 1 - next.y);
    setCrop(next); onCropChange?.(JSON.stringify({ page: q.source_page, ...next }));
  }
  async function runCropOcr() {
    if (!cropCanvas.current || !ready) return;
    const abort = new AbortController(); cropController.current = abort;
    setOcrRunning(true); setOcrResult(null); setCropError('');
    try {
      const res = await recognizeCanvas(cropCanvas.current, { lang: ocrLang, signal: abort.signal,
        onProgress: p => setCropProgress(`${p.phase} (${p.percent}%)`) });
      setOcrResult({ text: res.text, confidence: res.confidence });
    } catch (e) { setCropError(message(e)); }
    finally { setOcrRunning(false); setCropProgress(''); cropController.current = null; }
  }

  return (
    <section className="original">
      <h3>Original source</h3>
      {q.source_id ? (
        <>
          <p>Question {q.source_number ?? '—'} · page {q.source_page ?? '—'}</p>
          <p className="muted">Compare wording and option keys before reviewing.</p>
          <div className="actions horizontal">
            <button className="secondary" type="button" onClick={() => setZoom(z => z === 1 ? 2 : 1)}>
              {zoom === 1 ? 'Enlarge source page' : 'Fit source page'}
            </button>
            <button className="secondary" type="button" onClick={() => setCropMode(m => !m)}>
              {cropMode ? 'Close crop mode' : 'Crop & OCR correction'}
            </button>
            <a href={`/api/admin/sources/${q.source_id}/file`} className="button secondary">Download original</a>
          </div>

          {cropMode && (
            <div className="crop-controls">
              <span className="eyebrow">Crop selection</span>
              <div className="crop-presets">
                <button type="button" className="secondary" onClick={() => handlePreset('full')}>Full page</button>
                <button type="button" className="secondary" onClick={() => handlePreset('top')}>Top half</button>
                <button type="button" className="secondary" onClick={() => handlePreset('bottom')}>Bottom half</button>
              </div>
              <div className="form-grid">
                {([['x','Left offset %'],['y','Top offset %'],['w','Width %'],['h','Height %']] as const).map(([key,label]) => <Field key={key} label={`${label} (${Math.round(crop[key]*100)})`}>
                  <input type="range" min={key === 'x' || key === 'y' ? 0 : 1} max={key === 'x' || key === 'y' ? 99 : Math.round((1-crop[key === 'w' ? 'x' : 'y'])*100)} value={Math.round(crop[key]*100)} disabled={ocrRunning} onChange={e => changeCrop(key,Number(e.target.value))} />
                </Field>)}
              </div>

              <div className="crop-preview-wrap">
                <span className="eyebrow">Crop preview</span>
                <canvas ref={cropCanvas} />
              </div>

              <div className="ocr-box">
                <span className="eyebrow">On-demand crop OCR</span>
                <Field label="OCR Language">
                  <select value={ocrLang} onChange={e => setOcrLang(e.target.value as OcrLanguage)} disabled={ocrRunning}>
                    <option value="eng+hin">Bilingual (English + हिन्दी)</option>
                    <option value="hin">Hindi (Devanagari)</option>
                    <option value="eng">English</option>
                  </select>
                </Field>
                <button type="button" disabled={ocrRunning || !ready} onClick={() => void runCropOcr()}>
                  {ocrRunning ? 'Recognizing crop…' : 'Run OCR on this crop'}
                </button>
                {cropError && <p role="status">{cropError}</p>}
                {ocrRunning && <><p role="status">{cropProgress}</p><button type="button" className="secondary" onClick={() => cropController.current?.abort()}>Cancel crop OCR</button></>}
                {ocrResult && (
                  <div>
                    <p><strong>Confidence:</strong> {ocrResult.confidence}%</p>
                    <Field label="Correct OCR text before applying"><textarea lang={ocrLang === 'hin' ? 'hi' : undefined} rows={6} value={ocrResult.text} onChange={e => setOcrResult({ ...ocrResult, text: e.target.value })} /></Field><p className="muted">Confidence is not accuracy. Check letters, numbers and option labels against the crop.</p>
                    <p className="muted" style={{ margin: '8px 0 4px', fontSize: '13px' }}>Quick apply to editor:</p>
                    <div className="ocr-apply-actions">
                      <button type="button" className="secondary" onClick={() => onApplyCropText?.('stem_en', ocrResult.text)}>Set English stem</button>
                      <button type="button" className="secondary" onClick={() => onApplyCropText?.('stem_hi', ocrResult.text)}>Set Hindi stem</button>
                      {['A', 'B', 'C', 'D'].map(k => (
                        <button key={k} type="button" className="secondary" onClick={() => onApplyCropText?.(`option_${k}`, ocrResult.text)}>Opt {k}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {error ? <p role="status">{error}</p> : <div className="original-scroll"><canvas ref={canvas} role="img" aria-label={`Original source page ${q.source_page}`} /></div>}
        </>
      ) : <p>No original PDF attached (manual question).</p>}
    </section>
  );
}

function Bank({ source, setSource, questions, sources, selected, select, busy, run, notify, saved }: { source: string; setSource: (source: string) => void; questions: BankQuestion[]; sources: Source[]; selected: BankQuestion | null; select: (q: BankQuestion | null) => void; busy: boolean; run: (w: () => Promise<void>) => Promise<void>; notify: (s: string) => void; saved: () => Promise<void> }) {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [ids, setIds] = useState<number[]>([]);
  const [action, setAction] = useState<BankQuestion['status']>('reviewed');
  const [ack, setAck] = useState(false);
  const allCheckbox = useRef<HTMLInputElement>(null);
  const visible = questions.filter(q => (!status || q.status === status) && (!source || q.source_id === Number(source)) && `${q.stem_en} ${q.stem_hi} ${q.subject}`.toLowerCase().includes(search.toLowerCase()));
  const chosen = visible.filter(q => ids.includes(q.id));
  const allSelected = visible.length > 0 && chosen.length === visible.length;
  useEffect(() => { setIds([]); setAck(false); }, [status, source, search]);
  useEffect(() => { if (allCheckbox.current) allCheckbox.current.indeterminate = chosen.length > 0 && !allSelected; });
  function choose(next: number[]) { setIds(next); setAck(false); }
  async function applyBulk() {
    await run(async () => {
      let completed = 0;
      try {
        for (const q of chosen) {
          await api(`questions/${q.id}`, { ...q, key_verified: Boolean(q.key_verified), status: action }, 'PATCH');
          completed++;
          setIds(current => current.filter(id => id !== q.id));
        }
      } catch (error) {
        throw new Error(`${completed} of ${chosen.length} questions updated. Remaining questions are still selected. ${message(error)}`);
      } finally {
        setAck(false);
        await saved();
      }
      notify(`${completed} ${completed === 1 ? 'question' : 'questions'} marked ${action.replaceAll('-', ' ')}. Answer keys and verification unchanged.`);
    });
  }
  return <><div className="card"><div className="form-grid"><Field label="Status"><select value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{['needs-review', 'reviewed', 'excluded'].map(s => <option key={s}>{s}</option>)}</select></Field><Field label="Source"><select value={source} onChange={e => setSource(e.target.value)}><option value="">All sources</option>{sources.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></Field><Field label="Search bank"><input value={search} onChange={e => setSearch(e.target.value)} /></Field></div><button className="secondary" disabled={busy} onClick={() => select({ id: 0, version: 1, stem_en: '', stem_hi: null, context_en: null, context_hi: null, options: ['A', 'B', 'C', 'D'].map(key => ({ key, en: '', hi: null })), answer_key: null, key_verified: false, status: 'needs-review', origin: 'manual', source_id: null, source_number: null, source_page: null, subject: null, year: null, explanation_en: null, explanation_hi: null, warnings: [] })}>Add manual question</button></div>{selected ? <Review key={`${selected.id}-${selected.version}`} q={selected} cancel={() => select(null)} busy={busy} run={run} saved={saved} notify={notify} /> : <div className="card"><h2>{visible.length} questions</h2><div className="bulk-actions">
        <label className="check"><input ref={allCheckbox} type="checkbox" aria-label="Select all matching questions" checked={allSelected} disabled={busy || !visible.length} onChange={e => choose(e.target.checked ? visible.map(q => q.id) : [])} />Select all matching questions</label>
        <p role="status">{chosen.length} selected</p>
        <div className="actions horizontal">
          <Field label="Bulk action"><select value={action} disabled={busy} onChange={e => { setAction(e.target.value as BankQuestion['status']); setAck(false); }}><option value="reviewed">Mark as reviewed</option><option value="needs-review">Mark as needs review</option><option value="excluded">Exclude questions</option></select></Field>
          <button disabled={busy || !chosen.length || (action === 'reviewed' && !ack)} onClick={() => void applyBulk()}>Apply to selected</button>
          <button className="secondary" disabled={busy || !chosen.length} onClick={() => choose([])}>Clear selection</button>
        </div>
        {action === 'reviewed' && <label className="check"><input type="checkbox" checked={ack} disabled={busy || !chosen.length} onChange={e => setAck(e.target.checked)} />I checked the text, option pairing, and warnings for all selected questions against the originals.</label>}
        <small>Selection applies to the current filters. Answer keys still need individual verification before a scored exam can be published.</small>
      </div>{visible.length === 0 ? <p>Upload a source or add a manual question to begin.</p> : <div className="table-wrap"><table className="bank-table"><thead><tr><th>Question</th><th>Languages</th><th>Status</th><th>Key</th><th>Review</th></tr></thead><tbody>{visible.map(q => <tr key={q.id}><td><label className="check bank-select"><input type="checkbox" aria-label={`Select question ${q.id}`} checked={ids.includes(q.id)} disabled={busy} onChange={e => choose(e.target.checked ? [...ids, q.id] : ids.filter(id => id !== q.id))} /><span>Select question {q.source_number ? `Q${q.source_number}` : `#${q.id}`}</span></label><strong>{q.source_number ? `Q${q.source_number}` : `#${q.id}`}</strong> · {(q.stem_en || q.stem_hi || '').slice(0, 130)}<small>{q.subject || 'Subject unset'} · {q.year || 'Year unset'} · v{q.version}</small></td><td>{q.stem_en ? 'EN ' : ''}{q.stem_hi ? 'हिन्दी' : ''}</td><td><Chip status={q.status} /></td><td>{q.answer_key ?? '—'} {q.key_verified ? '✓ verified' : 'unverified'}</td><td><button className="secondary" disabled={busy} onClick={() => select(q)} aria-label={`Review question ${q.id}`}>Review</button></td></tr>)}</tbody></table></div>}</div>}</>;
}

function Review({ q, cancel, busy, run, saved, notify }: { q: BankQuestion; cancel: () => void; busy: boolean; run: (w: () => Promise<void>) => Promise<void>; saved: () => Promise<void>; notify: (s: string) => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const [draft, setDraft] = useState(q); const [ack, setAck] = useState(false);
  function text(field: keyof BankQuestion, value: string) { setDraft(d => ({ ...d, [field]: value || null, key_verified: field.startsWith('stem_') ? false : d.key_verified })); setAck(false); }
  function option(index: number, lang: 'en' | 'hi', value: string) { setDraft(d => ({ ...d, key_verified: false, options: d.options.map((o, i) => i === index ? { ...o, [lang]: value || null } : o) })); setAck(false); }

  function applyCropText(target: string, textValue: string) {
    if (target === 'stem_en' || target === 'stem_hi') {
      text(target as keyof BankQuestion, textValue);
    } else if (target.startsWith('option_')) {
      const key = target.replace('option_', '');
      const idx = draft.options.findIndex(o => o.key === key);
      if (idx !== -1) {
        const lang = /[\u0900-\u097f]/.test(textValue) ? 'hi' : 'en';
        option(idx, lang, textValue);
      }
    }
    setDraft(d => ({ ...d, status: 'needs-review', key_verified: false })); setAck(false);
    notify('Applied OCR text to draft. Please verify against crop before saving.');
  }

  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); await run(async () => { const body = { ...draft, key_verified: Boolean(draft.key_verified), status: draft.status }; if (q.id) await api(`questions/${q.id}`, body, 'PATCH'); else await api('questions', [body]); await saved(); notify('Question saved. Published papers retain their original snapshot.'); }); }

  return <form className="card review" onSubmit={save}><div className="review-head"><div><h2 ref={heading} tabIndex={-1}>{q.id ? `Review question #${q.id}` : 'New manual question'}</h2><Chip status={q.status} /> <small>Version {q.version} · {q.origin}</small></div><button className="secondary" type="button" onClick={cancel}>Back to bank</button></div>{q.warnings.length > 0 && <div className="warnings"><strong>Check against the original</strong><ul>{q.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}<div className="review-columns"><SourcePreview q={q} cropJson={draft.crop_json} onCropChange={cropJson => setDraft(d => ({ ...d, crop_json: cropJson }))} onApplyCropText={applyCropText} />{(['en', 'hi'] as const).map(lang => <section lang={lang} key={lang}><h3>{lang === 'en' ? 'English' : 'हिन्दी'}</h3>{!draft[`stem_${lang}`] && <p className="muted">{lang === 'en' ? 'English' : 'Hindi'} version not in source. Leave blank unless you can verify original text.</p>}<Field label={`${lang === 'en' ? 'English' : 'Hindi'} passage / context`}><textarea rows={3} value={draft[`context_${lang}`] ?? ''} onChange={e => text(`context_${lang}`, e.target.value)} maxLength={20000} /></Field><Field label={`${lang === 'en' ? 'English' : 'Hindi'} stem`}><textarea rows={5} value={draft[`stem_${lang}`] ?? ''} onChange={e => text(`stem_${lang}`, e.target.value)} maxLength={8000} /></Field>{draft.options.map((o, i) => <Field key={o.key} label={`${lang === 'en' ? 'English' : 'Hindi'} option ${o.key}`}><textarea rows={2} value={o[lang] ?? ''} onChange={e => option(i, lang, e.target.value)} maxLength={4000} /></Field>)}<Field label={`${lang === 'en' ? 'English' : 'Hindi'} explanation`}><textarea rows={3} value={draft[`explanation_${lang}`] ?? ''} onChange={e => text(`explanation_${lang}`, e.target.value)} /></Field></section>)}</div><div className="form-grid"><Field label="Subject"><input value={draft.subject ?? ''} onChange={e => text('subject', e.target.value)} /></Field><Field label="Year"><input value={draft.year ?? ''} onChange={e => text('year', e.target.value)} /></Field><Field label="Correct option key"><select value={draft.answer_key ?? ''} onChange={e => setDraft(d => ({ ...d, answer_key: e.target.value || null, key_verified: false }))}><option value="">No key supplied</option>{draft.options.map(o => <option key={o.key}>{o.key}</option>)}</select></Field><Field label="Review status"><select value={draft.status} onChange={e => setDraft(d => ({ ...d, status: e.target.value as BankQuestion['status'] }))}><option value="needs-review">Needs review</option><option value="reviewed">Reviewed</option><option value="excluded">Excluded</option></select></Field></div><label className="check"><input type="checkbox" disabled={!draft.answer_key} checked={Boolean(draft.key_verified)} onChange={e => setDraft(d => ({ ...d, key_verified: e.target.checked }))} />I verified this answer key against a reliable source.</label><label className="check"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />I checked the text, option pairing, and warnings against the original.</label><div className="actions horizontal"><button disabled={busy || (draft.status === 'reviewed' && !ack)}>Save question</button><button className="secondary" type="button" onClick={cancel}>Cancel</button></div><small>Excluded questions cannot be published. Missing language text is never translated automatically.</small></form>;
}

function ExamBuilder({ questions, sources, busy, run, done, notify }: { questions: BankQuestion[]; sources: Source[]; busy: boolean; run: (w: () => Promise<void>) => Promise<void>; done: () => Promise<void>; notify: (s: string) => void }) {
  const [ids, setIds] = useState<number[]>([]); const [filters, setFilters] = useState({ source_id: '', year: '', subject: '', language: '' }); const [seed, setSeed] = useState('practice-1'); const [count, setCount] = useState(10);
  const ready = questions.filter(q => q.status === 'reviewed');
  const matching = ready.filter(q => (!filters.source_id || q.source_id === Number(filters.source_id)) && (!filters.year || q.year === filters.year) && (!filters.subject || q.subject === filters.subject) && (!filters.language || (filters.language === 'both' ? q.stem_en && q.stem_hi : filters.language === 'en' ? q.stem_en : q.stem_hi)));
  const selectAll = useRef<HTMLInputElement>(null);
  const selectedMatching = matching.filter(q => ids.includes(q.id)).length;
  const allMatchingSelected = matching.length > 0 && selectedMatching === matching.length;
  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = selectedMatching > 0 && !allMatchingSelected;
  });
  function toggleMatching(checked: boolean) {
    const matchingIds = new Set(matching.map(q => q.id));
    setIds(current => checked ? [...new Set([...current, ...matchingIds])] : current.filter(id => !matchingIds.has(id)));
  }
  const date = (offset: number) => { const d = new Date(Date.now() + offset); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  async function create(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); await run(async () => { const draft = await api<{ code: string }>('exams', { title: data.get('title'), instructions: data.get('instructions'), mode: data.get('mode'), scored: data.get('scored') === 'true', duration_s: Number(data.get('duration')) * 60, opens_at: new Date(String(data.get('opens'))).getTime(), closes_at: new Date(String(data.get('closes'))).getTime(), late_join_s: Number(data.get('late')) * 60, shuffle: data.get('shuffle'), marks_correct: Number(data.get('correct')), marks_wrong: Number(data.get('wrong')), question_ids: ids, max_attempts: Number(data.get('attempts')), subset_count: data.get('subset') ? Number(data.get('subset')) : null, subset_seed: String(data.get('subsetSeed') || '') }); setIds([]); form.reset(); await done(); notify(`Draft ${draft.code} created. Review its settings before publishing.`); }); }
  return <div className="card"><h2>Build an exam</h2><p>Filter the reviewed bank, select questions manually or sample a reproducible paper. Sampling never repeats a question.</p><div className="form-grid">{((['source_id', 'year', 'subject', 'language'] as const)).map(key => <Field key={key} label={key === 'source_id' ? 'Source' : key[0]!.toUpperCase() + key.slice(1)}><select value={filters[key]} onChange={e => setFilters(f => ({ ...f, [key]: e.target.value }))}><option value="">All</option>{key === 'source_id' ? sources.map(s => <option key={s.id} value={s.id}>{s.label}</option>) : key === 'language' ? ['en', 'hi', 'both'].map(v => <option key={v}>{v}</option>) : [...new Set(ready.map(q => q[key]).filter(Boolean))].map(v => <option key={v!}>{v}</option>)}</select></Field>)}</div><div className="inline"><Field label="Sample count"><input type="number" min={1} max={500} value={count} onChange={e => setCount(Number(e.target.value))} /></Field><Field label="Random seed"><input value={seed} onChange={e => setSeed(e.target.value)} maxLength={100} /></Field><button className="secondary" disabled={busy || !seed || count < 1 || count > matching.length} onClick={() => void run(async () => { const sample = await api<{ question_ids: number[] }>('questions/sample', { count, seed, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v).map(([k, v]) => [k, k === 'source_id' ? Number(v) : v])) }); setIds(sample.question_ids); notify(`Selected ${sample.question_ids.length} questions with seed ${seed}.`); })}>Sample matching bank</button><button className="secondary" disabled={busy || !ids.length} onClick={() => setIds([])}>Clear selection</button></div><label className="check"><input ref={selectAll} type="checkbox" checked={allMatchingSelected} disabled={busy || !matching.length} onChange={e => toggleMatching(e.target.checked)} />Select all matching questions ({selectedMatching} of {matching.length} selected)</label><small>Selects reviewed questions matching the filters above. Questions selected under other filters stay selected.</small><details><summary>{matching.length} eligible questions · {ids.length} selected (show manual selection)</summary><div className="selection">{matching.map(q => <label className="check" key={q.id}><input type="checkbox" aria-label={`Select exam question ${q.id}`} disabled={busy} checked={ids.includes(q.id)} onChange={e => setIds(current => e.target.checked ? [...current, q.id] : current.filter(id => id !== q.id))} />#{q.id} · {(q.stem_en || q.stem_hi || '').slice(0, 110)}</label>)}</div></details><form onSubmit={create}><div className="form-grid"><Field label="Exam title"><input name="title" required maxLength={200} /></Field><Field label="Exam mode"><select name="mode"><option value="independent">Independent · each student's own timer</option><option value="cohort">Cohort · common start and deadline</option></select></Field><Field label="Opens (your local time)"><input name="opens" type="datetime-local" defaultValue={date(0)} required /></Field><Field label="Closes (your local time)"><input name="closes" type="datetime-local" defaultValue={date(3600000)} required /></Field><Field label="Duration (minutes)"><input name="duration" type="number" min={1} max={360} defaultValue={30} required /></Field><Field label="Late join window (cohort, minutes)"><input name="late" type="number" min={0} defaultValue={10} required /></Field><Field label="Question order"><select name="shuffle"><option value="fixed">Same order for everyone</option><option value="per-attempt">Stable shuffled order per student</option></select></Field><Field label="Attempt limit (independent only)"><input name="attempts" type="number" min={1} max={10} defaultValue={1} required /></Field><Field label="Questions per attempt (blank = full paper)"><input name="subset" type="number" min={1} max={ids.length || 500} /></Field><Field label="Subset seed (required for subsets)"><input name="subsetSeed" maxLength={100} /></Field><Field label="Correct marks"><input name="correct" type="number" min={0} step="0.25" defaultValue={1} required /></Field><Field label="Wrong-answer penalty"><input name="wrong" type="number" min={0} step="0.25" defaultValue={0} required /></Field><Field label="Instructions"><textarea name="instructions" maxLength={10000} /></Field></div><label className="check"><input name="scored" type="checkbox" value="true" defaultChecked />Score this exam</label><p className="muted">Dates are converted to UTC on save. Publishing creates an immutable snapshot. Cohorts allow one attempt. Subsets are stable per attempt but may differ in difficulty; consider leaving ranks hidden.</p><button disabled={busy || ids.length === 0}>Create draft · {ids.length} questions</button></form></div>;
}

createRoot(document.getElementById('root')!).render(<App />);
