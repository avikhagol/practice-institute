import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { downloadJson } from '../lib/download';
import { keyTemplate, parseKey } from '../lib/bank/keys';
import type { Question } from '../lib/types';

function KeyEditor({ q }: { q: Question }) {
  const { dispatch } = useStore();
  const [key, setKey] = useState(q.answerKey ?? '');
  const [explanation, setExplanation] = useState(q.explanation ?? '');
  const [saved, setSaved] = useState(false);
  useEffect(() => { setKey(q.answerKey ?? ''); setExplanation(q.explanation ?? ''); }, [q]);
  return <form className="panel key-row" onSubmit={e => { e.preventDefault(); dispatch({ type: 'set-keys', patches: [{ id: q.id, key: key || null, explanation: explanation || null }], source: 'manual' }); setSaved(true); }}>
    <h2>Q{q.number} · p. {q.page}</h2><p className="q-stem">{q.stem}</p>
    <p className="muted">Question ID: {q.id} · {q.answerSource === 'none' ? 'No supplied key' : `Key supplied: ${q.answerSource}`}</p>
    <label className="field">Answer for Q{q.number}<select aria-label={`Answer for Q${q.number}`} value={key} onChange={e => { setKey(e.target.value); setSaved(false); }}><option value="">No key (ungraded)</option>{q.options.map(o => <option key={o.key} value={o.key}>{o.key} · {o.sourceLabel} {o.text}</option>)}</select></label>
    <label className="field">Explanation for Q{q.number} (optional)<textarea rows={2} maxLength={100_000} value={explanation} onChange={e => { setExplanation(e.target.value); setSaved(false); }} /></label>
    <button className="btn btn-secondary" type="submit">Save key for Q{q.number}</button>{saved && <span role="status"> Saved to bank</span>}
  </form>;
}
export function Keys() {
  const { state, dispatch } = useStore();
  const [source, setSource] = useState(state.docs[0]?.doc.id ?? '');
  const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const qs = state.questions.filter(q => q.docId === source);
  const importKey = async (file?: File) => {
    if (!file) return;
    setError(''); setMessage('');
    try {
      if (file.size > 1024 * 1024) throw new Error('Answer key exceeds 1 MB.');
      const patches = parseKey(await file.text(), state.questions, source);
      dispatch({ type: 'set-keys', patches, source: 'imported' }); setMessage(`Applied ${patches.length} answer-key entries to the selected source.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not import key.'); }
    finally { if (input.current) input.current.value = ''; }
  };
  return <section className="container page"><h1>Supply answer keys</h1><p className="muted">Keys are supplied by you; Practice Institute does not infer or verify official answers. Changes apply to future attempts. Existing attempt snapshots keep their original keys.</p>
    <label className="field">Source for answer keys<select aria-label="Source for answer keys" value={source} onChange={e => { setSource(e.target.value); setError(''); setMessage(''); }}><option value="" disabled>Select a source</option>{state.docs.map(({ doc }) => <option key={doc.id} value={doc.id}>{doc.label} · {doc.fileName}</option>)}</select></label>
    <div className="toolbar"><button className="btn btn-secondary" disabled={!qs.length} onClick={() => downloadJson('pdf-smart-answer-key.json', keyTemplate(state.questions, source))}>Export key template</button><button className="btn btn-secondary" disabled={!qs.length} onClick={() => input.current?.click()}>Import answer key (JSON)</button><input className="visually-hidden" tabIndex={-1} ref={input} type="file" accept=".json,application/json" aria-label="Import answer key JSON" onChange={e => { void importKey(e.target.files?.[0]); }} /></div>
    <details className="bank-help"><summary>How question numbers map to keys</summary><p>Export the selected source’s template. Each entry pairs its printed number with its stable questionId and canonical key (A–E). Repeated printed numbers stay separate by ID. Set key to null to clear it. Printed option labels such as (1) are not canonical keys. Import validates every entry before applying any. Maximum 1 MB.</p></details>
    {error && <p className="callout callout-danger" role="alert">{error}</p>}{message && <p className="callout callout-info" role="status">{message}</p>}
    {!qs.length && <p className="panel">Add or import questions first.</p>}{qs.map(q => <KeyEditor key={q.id} q={q} />)}
  </section>;
}
