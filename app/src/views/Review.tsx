import { href } from '../router';
import { useMemo, useRef, useState } from 'react';
import { PagePreview } from '../components/PagePreview';
import { QuestionEditor } from '../components/QuestionEditor';
import { BANK_LIMITS, acceptQuestion, eligibleQuestions, findDuplicates, makeBank, parseBank, structuralWarnings } from '../lib/bank/bank';
import { useStore } from '../state/store';
import { OPTION_KEYS, type Question, type SourceDoc } from '../lib/types';
import { randomId } from '../lib/id';

type Filter = 'all' | 'needs-review' | 'ok' | 'excluded' | 'duplicates';

export function Review() {
  const { state, dispatch, saved } = useStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [openPreview, setOpenPreview] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [manual, setManual] = useState<{ question: Question; source: SourceDoc } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [clearPending, setClearPending] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const docs = useMemo(() => new Map(state.docs.map(d => [d.doc.id, d])), [state.docs]);
  const duplicates = useMemo(() => findDuplicates(state.questions), [state.questions]);
  const visible = state.questions.filter(q => !duplicates.has(q.id));
  const shown = filter === 'duplicates' ? state.questions.filter(q => duplicates.has(q.id)) : visible.filter(q => filter === 'all' || q.status === filter);
  const counts = { all: visible.length, 'needs-review': visible.filter(q => q.status === 'needs-review').length, ok: visible.filter(q => q.status === 'ok').length, excluded: visible.filter(q => q.status === 'excluded').length, duplicates: duplicates.size };
  const duplicateSources = [...new Set(state.questions.filter(q => duplicates.has(q.id)).map(q => docs.get(q.docId)?.doc.fileName ?? 'Unknown file'))];
  const exportJson = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...makeBank(state.docs.map(d => d.doc), state.questions), exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'pdf-smart-question-bank.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importJson = async (file?: File) => {
    if (!file) return;
    setImportBusy(true); setImportError(null); setMessage(null);
    try {
      if (file.size > BANK_LIMITS.bytes) throw new Error('Bank exceeds the 10 MB JSON limit.');
      const bank = parseBank(await file.text());
      if (state.questions.length + bank.questions.length > BANK_LIMITS.questions || state.docs.length + bank.sources.length > BANK_LIMITS.sources) throw new Error('Combined bank exceeds the limit of 5,000 questions or 500 sources.');
      dispatch({ type: 'import-bank', bank });
      setMessage(`Imported ${bank.questions.length} questions from ${bank.sources.length} sources. Review them before use. PDF originals are not included.`);
    } catch (e) { setImportError(e instanceof Error ? e.message : 'The file could not be imported.'); }
    finally { setImportBusy(false); if (input.current) input.current.value = ''; }
  };
  const addManual = () => {
    const source: SourceDoc = state.docs.find(d => d.doc.id === 'manual')?.doc ?? { id: 'manual', fileName: 'Manual questions', label: 'Manual questions', year: null, sizeBytes: 0, pageCount: 1, pagesProcessed: 0, addedAt: Date.now(), warnings: [], synthetic: false };
    const number = Math.max(0, ...state.questions.filter(q => q.docId === source.id).map(q => q.number)) + 1;
    setManual({ source, question: { id: randomId(), docId: source.id, number, page: 1, pageEnd: 1, context: null, stem: '', options: OPTION_KEYS.slice(0, 4).map(key => ({ key, sourceLabel: `${key}.`, text: '' })), status: 'needs-review', confidence: 0, warnings: [], answerKey: null, answerSource: 'none', explanation: null, rawText: '', edited: true } });
  };
  return (
    <div className="container page">
      <div className="page-head">
        <div><h1>Check your questions</h1><p className="muted">Keep the source in view, correct the text, then accept questions for practice.</p></div>
        <div className="toolbar">
          <a className="btn btn-secondary" href={href({ name: 'keys' })}>Supply answer keys</a>
          <a className="btn btn-secondary" href={href({ name: 'setup' })}>Set up practice</a>
          <button type="button" className="btn btn-primary" onClick={addManual} disabled={manual !== null}>Add question</button>
          <button type="button" className="btn btn-secondary" disabled={importBusy} onClick={() => input.current?.click()}>{importBusy ? 'Importing…' : 'Import bank (JSON)'}</button>
          <input ref={input} className="visually-hidden" tabIndex={-1} type="file" accept=".json,application/json" aria-label="Import question bank JSON" onChange={e => { void importJson(e.target.files?.[0]); }} />
          <button type="button" className="btn btn-secondary" onClick={exportJson}>Export bank (JSON)</button>
        </div>
      </div>
      <p className="muted storage-note">{saved ? 'Bank saved on this device.' : 'Bank is in this tab.'} Only question text and source metadata are saved; original PDFs must be opened again after a reload. Export a backup before clearing browser data.</p>
      <details className="bank-help"><summary>Import and backup help</summary><p className="muted">Import appends a PDF Smart version 1 JSON bank, up to 10 MB, 5,000 questions and 500 sources. Invalid banks are rejected as a whole. JSON includes excluded questions and duplicate copies, but no original PDFs. Export a backup to keep outside browser storage.</p></details>
      <p className="muted">{eligibleQuestions(state.questions).length} ready for practice · {state.questions.length} total, including excluded and duplicate copies.</p>
      {message && <p className="callout callout-info" role="status">{message}</p>}
      {importError && <p className="callout callout-danger import-error" role="alert">{importError}</p>}
      {duplicates.size > 0 && <p className="callout callout-info" role="status">{duplicates.size} duplicate{duplicates.size === 1 ? '' : 's'} hidden, from files: {duplicateSources.join(', ')}. Matching passage, question and ordered options; diagram questions stay separate. Copies remain in the Duplicates filter and JSON export.</p>}
      {manual && <section className="panel manual-editor"><QuestionEditor key={manual.question.id} question={manual.question} isNew onCancel={() => setManual(null)} onSave={(q, accept) => {
        dispatch({ type: 'add-question', source: manual.source, question: accept ? acceptQuestion(q) : { ...q, warnings: structuralWarnings(q) } });
        setManual(null); setMessage('Manual question added.'); setFilter('all');
      }} /></section>}
      <div className="toolbar" role="group" aria-label="Filter questions">
        {(['all', 'needs-review', 'ok', 'excluded', 'duplicates'] as const).map(f => (
          <button key={f} type="button" className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {{ all: 'All', ok: 'Looks good', 'needs-review': 'Needs review', excluded: 'Excluded', duplicates: 'Duplicates' }[f]} ({counts[f]})
          </button>
        ))}
      </div>
      {shown.length === 0 && <p className="panel">{state.questions.length === 0 ? 'No questions yet. Import a bank, add a question manually, or open a PDF in the library.' : 'No questions in this filter.'}</p>}
      <ol className="q-list">{shown.map(q => {
        const loaded = docs.get(q.docId), original = state.questions.find(item => item.id === duplicates.get(q.id));
        return <li key={q.id} className={`q-card${q.status === 'needs-review' ? ' needs-review' : ''}`} aria-label={`Question ${q.number} from ${loaded?.doc.label ?? 'Unknown file'}`}>
          <div className="q-head">
            <span><strong>Q{q.number}</strong> · {loaded?.doc.label} · {loaded?.doc.fileName} · {loaded?.doc.year ?? 'Year not set'} · {q.page === q.pageEnd ? `p. ${q.page}` : `pp. ${q.page}–${q.pageEnd}`}{loaded?.doc.synthetic && ' · synthetic demo'}</span>
            <span className="q-chips"><span className={`chip ${q.status === 'ok' ? 'chip-ok' : 'chip-warn'}`}>{{ ok: 'Looks good', 'needs-review': 'Needs review', excluded: 'Excluded' }[q.status]}</span>
              <span className="chip" title="Heuristic extraction confidence, not answer correctness">{Math.round(q.confidence * 100)}% parse confidence</span><span className="chip">{q.answerKey ? `Key: ${q.answerKey}` : 'No answer key'}</span>{q.edited && <span className="chip">Human reviewed / edited</span>}</span>
          </div>
          {original && <p className="callout callout-info">Duplicate of Q{original.number} from {docs.get(original.docId)?.doc.label}. Edit this copy if its content differs; duplicate detection updates automatically.</p>}
            {q.warnings.length > 0 && <ul className="q-warnings">{q.warnings.map(w => <li key={w.code} className={`callout ${w.blocking ? 'callout-danger' : 'callout-warn'}`}>{w.message}{!w.blocking && q.edited && ' (Acknowledged)'}</li>)}</ul>}
          {editing === q.id ? <QuestionEditor question={q} onCancel={() => setEditing(null)} onSave={(question, accept) => { dispatch({ type: 'edit-question', question, accept }); setEditing(null); setMessage(`Q${q.number} ${accept ? 'saved and accepted' : 'saved for review'}.`); }} /> : <>
            {q.context && <details><summary>Shared passage / directions</summary><div className="q-context">{q.context}</div></details>}
            <p className="q-stem">{q.stem || <em className="muted">(no question text extracted)</em>}</p>
            <ul className="q-opts">{q.options.map(o => <li key={o.key}><span className="lbl">{o.sourceLabel}</span><span>{o.text || <em className="muted">(empty)</em>}</span></li>)}</ul>
            <div className="toolbar q-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(q.id)}>Edit question</button>
              {q.status === 'needs-review' && <button type="button" className="btn btn-primary btn-sm" disabled={structuralWarnings(q).length > 0} onClick={() => { dispatch({ type: 'accept-question', id: q.id }); setMessage(`Q${q.number} accepted. Blocking parsing warnings acknowledged.`); }}>Accept as checked</button>}
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => dispatch({ type: q.status === 'excluded' ? 'restore-question' : 'exclude-question', id: q.id })}>{q.status === 'excluded' ? 'Restore question' : 'Exclude question'}</button>
            </div>
          </>}
          {loaded?.pdf ? <button type="button" className="btn btn-ghost btn-sm" aria-expanded={openPreview === q.id} onClick={() => setOpenPreview(openPreview === q.id ? null : q.id)}>{openPreview === q.id ? 'Hide source page' : `View source page ${q.page}`}</button> : <p className="muted">Source not loaded — original PDF preview is unavailable{q.docId === 'manual' ? ' for manual questions' : ' after reload or JSON import'}.</p>}
          {openPreview === q.id && loaded?.pdf && <div className="review-preview"><PagePreview pdf={loaded.pdf} page={q.page} width={560} label={`Page ${q.page} of ${loaded.doc.label}`} /></div>}
        </li>;
      })}</ol>
      {state.docs.length > 0 && <div className="clear-bank">
        {clearPending ? <><p>Remove every saved question and source on this device? Export a backup first.</p><div className="toolbar"><button type="button" className="btn btn-danger" onClick={() => { for (const d of state.docs) void d.pdf?.loadingTask.destroy(); dispatch({ type: 'reset' }); setClearPending(false); setManual(null); setEditing(null); setMessage('Bank cleared.'); }}>Confirm clear bank</button><button type="button" className="btn btn-secondary" onClick={() => setClearPending(false)}>Keep bank</button></div></> : <button type="button" className="btn btn-ghost" onClick={() => setClearPending(true)}>Clear saved bank</button>}
      </div>}
    </div>
  );
}
