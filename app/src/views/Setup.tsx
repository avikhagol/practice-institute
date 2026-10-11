import { useState } from 'react';
import { createAttempt, selectedPool, type Setup as SetupOptions } from '../lib/attempt/attempt';
import { useStore } from '../state/store';
import { useAttempts } from '../state/attempts';
import { href, navigate } from '../router';
import { randomId } from '../lib/id';

export function Setup() {
  const { state } = useStore(); const { attempts, start } = useAttempts();
  const sources = state.docs.map(d => d.doc);
  const [setup, setSetup] = useState<SetupOptions>(() => ({ mode: 'practice', sourceIds: sources.map(s => s.id), year: '', count: Math.max(1, Math.min(10, selectedPool(state.questions, sources, sources.map(s => s.id), '').length)), seed: 'study-1', minutes: 30, scheme: null }));
  const [instructions, setInstructions] = useState(false); const [error, setError] = useState('');
  const pool = selectedPool(state.questions, sources, setup.sourceIds, setup.year);
  const active = attempts.find(a => a.submittedAt === null);
  const update = (patch: Partial<SetupOptions>) => { setSetup(s => ({ ...s, ...patch })); setInstructions(false); setError(''); };
  const begin = () => {
    try {
      const a = createAttempt(state.questions, sources, setup, Date.now(), randomId());
      if (setup.mode === 'exam' && !instructions) { setInstructions(true); return; }
      start(a); navigate({ name: 'attempt', id: a.id });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not start.'); }
  };
  return <section className="container page"><div className="page-head"><div><h1>Make time to practise</h1><p className="muted">Choose checked questions. The same seed and unchanged pool reproduce the same order.</p></div><a className="btn btn-secondary" href={href({ name: 'results' })}>Past attempts</a></div>
    {active ? <div className="panel"><h2>You have an active {active.mode}</h2><p>Resume it and submit before starting another. Exam time continues while you leave this screen.</p><a className="btn btn-primary" href={href({ name: 'attempt', id: active.id })}>Resume attempt</a></div> : <form className="panel setup-form" onSubmit={e => { e.preventDefault(); begin(); }}>
      <fieldset><legend>Sources</legend><p className="muted">Select files, then optionally narrow by year. Duplicate detection runs within this selection.</p><div className="toolbar"><button type="button" className="btn btn-secondary btn-sm" onClick={() => update({ sourceIds: sources.map(s => s.id) })}>Select all sources</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => update({ sourceIds: [] })}>Select none</button></div>{sources.map(s => <label className="source-choice" key={s.id}><input type="checkbox" checked={setup.sourceIds.includes(s.id)} onChange={e => update({ sourceIds: e.target.checked ? [...setup.sourceIds, s.id] : setup.sourceIds.filter(id => id !== s.id) })} /><span>{s.label} · {s.fileName} · {s.year ?? 'Year not set'}</span></label>)}{!sources.length && <p>No sources yet. <a href={href({ name: 'review' })}>Add or import questions</a>.</p>}</fieldset>
      <div className="setup-fields"><label className="field">Year filter<select aria-label="Year filter" value={setup.year} onChange={e => update({ year: e.target.value })}><option value="">All years</option>{[...new Set(sources.map(s => s.year ?? 'unknown'))].sort().map(y => <option value={y} key={y}>{y === 'unknown' ? 'Year not set' : y}</option>)}</select></label>
      <label className="field">Mode<select aria-label="Mode" value={setup.mode} onChange={e => update({ mode: e.target.value as SetupOptions['mode'] })}><option value="practice">Practice · untimed</option><option value="exam">Exam · timed</option></select></label>
      <label className="field">Question count<input type="number" min={1} max={Math.max(1, pool.length)} required value={setup.count} onChange={e => update({ count: Number(e.target.value) })} /></label>
      <label className="field">Seed<input maxLength={200} required value={setup.seed} onChange={e => update({ seed: e.target.value })} /></label>
      {setup.mode === 'exam' && <label className="field">Duration (minutes)<input type="number" min={1} max={1440} step={1} required value={setup.minutes} onChange={e => update({ minutes: Number(e.target.value) })} /></label>}</div>
      <p role="status"><strong>{pool.length} ready questions</strong> in this selection. Questions with blocking warnings and excluded questions are left out.</p>
      <label className="source-choice"><input type="checkbox" checked={setup.scheme !== null} onChange={e => update({ scheme: e.target.checked ? { correct: 0, incorrect: 0, unanswered: 0 } : null })} />Use my marking scheme (optional)</label>
      {setup.scheme && <><p className="muted">Enter your own points; there are no official defaults. Negative values deduct points. Only questions with supplied keys can be scored.</p><div className="setup-fields">{(['correct', 'incorrect', 'unanswered'] as const).map(k => <label key={k} className="field">Points for {k}<input type="number" step="any" min={-1000} max={1000} required value={setup.scheme![k]} onChange={e => update({ scheme: { ...setup.scheme!, [k]: Number(e.target.value) } })} /></label>)}</div></>}
      {error && <p className="callout callout-danger" role="alert">{error}</p>}
      {instructions && <div className="callout callout-info"><h2>Before your exam</h2><p>{setup.count} questions · {setup.minutes} minutes. The timer starts when you choose Start exam. Leaving the page or putting the browser in the background does not pause it. At the deadline, answers lock and the attempt submits automatically. Early submission requires confirmation.</p><p>Questions, source labels, keys and your marking scheme are frozen at start. Missing keys remain ungraded. Browser storage can fail; keep a backup. Use one tab for attempts.</p></div>}
      <button type="submit" className="btn btn-primary" disabled={!pool.length}>{setup.mode === 'practice' ? 'Start practice' : instructions ? 'Start exam' : 'Read exam instructions'}</button>
    </form>}
  </section>;
}
