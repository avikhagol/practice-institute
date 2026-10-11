import { useState } from 'react';
import { answerOf, ATTEMPT_STORAGE_KEY, grade } from '../lib/attempt/attempt';
import { downloadJson } from '../lib/download';
import { useAttempts } from '../state/attempts';
import { provenanceLine } from '../lib/provenance';
import { href } from '../router';

export function Results({ id }: { id?: string }) {
  const { attempts, clear } = useAttempts(); const [confirm, setConfirm] = useState(false); const [error, setError] = useState('');
  const a = attempts.find(a => a.id === id);
  const exportAll = () => downloadJson('pdf-smart-results.json', { format: 'pdf-smart-results', version: 1, attempts: attempts.map(a => ({ ...a, result: a.submittedAt === null ? null : grade(a) })) });
  return <section className="container page"><div className="page-head"><div><h1>{a?.submittedAt !== null && a ? 'Your results' : 'Attempts and backups'}</h1><p className="muted">Results use the keys frozen at start. A supplied key is not a verified official answer.</p></div><div className="toolbar"><a className="btn btn-primary" href={href({ name: 'setup' })}>New practice or exam</a><button className="btn btn-secondary" onClick={exportAll}>Export all attempts (JSON)</button></div></div>
    {a && a.submittedAt !== null && (() => {
      const g = grade(a);
      return <><p className={`callout ${a.reason === 'timeout' ? 'callout-warn' : 'callout-info'}`} role="status">{a.reason === 'timeout' ? 'Time’s up — submitted automatically.' : 'Submitted. Your answers are locked.'}</p>
        <div className="panel result-summary"><h2>{g.keyed === 0 ? 'Ungraded — no answer keys supplied' : g.keyed < a.questions.length ? `Partially graded — ${g.keyed}/${a.questions.length} questions have keys` : 'Graded against supplied keys'}</h2><p>{g.attempted} attempted · {g.unanswered} unanswered · {Math.floor(g.elapsedMs / 60_000)}m {Math.floor(g.elapsedMs / 1000) % 60}s elapsed</p><p>{g.correct} correct · {g.incorrect} incorrect · {g.keyedUnanswered} unanswered with keys · {a.questions.length - g.keyed} ungraded</p>{g.score !== null ? <p><strong>Score on keyed questions: {Number(g.score.toFixed(6))}</strong> · Scheme: correct {a.scheme!.correct}, incorrect {a.scheme!.incorrect}, unanswered {a.scheme!.unanswered}</p> : <p>No numeric score: {g.keyed ? 'no marking scheme was supplied.' : 'no keys were supplied.'}</p>}<p className="muted">Seed: {a.seed} · Started {new Date(a.startedAt).toLocaleString()}</p><button className="btn btn-secondary" onClick={() => downloadJson('pdf-smart-result.json', { format: 'pdf-smart-result', version: 1, attempt: a, result: g })}>Export this result (JSON)</button></div>
        <ol className="q-list">{a.questions.map((q, i) => {
          const s = a.sources.find(s => s.id === q.docId)!; const answer = answerOf(a, q.id);
          const outcome = !q.answerKey ? 'Ungraded' : !answer ? 'Unanswered' : answer === q.answerKey ? 'Correct' : 'Incorrect';
          return <li className="q-card" key={q.id}><h2>Question {i + 1} · {outcome}</h2><p className="muted">{provenanceLine(q.number, q, s)}{a.marked.includes(q.id) && ' · Marked'}</p>{q.context && <div className="q-context">{q.context}</div>}<p className="q-stem">{q.stem}</p><ul className="q-opts">{q.options.map(o => <li key={o.key}><span className="lbl">{o.sourceLabel}</span><span>{o.text}{answer === o.key && ' · Your answer'}{q.answerKey === o.key && ' · Supplied key'}</span></li>)}</ul><p>Your answer: {answer ?? 'Unanswered'} · Supplied key: {q.answerKey ?? 'None'}{q.answerKey && ` (${q.answerSource})`}</p>{q.explanation && <p className="q-context">{q.explanation}</p>}</li>;
        })}</ol></>;
    })()}
    {id && !a && <p className="callout callout-warn">That attempt is unavailable on this device.</p>}
    <h2>Saved attempts ({attempts.length}/20)</h2>{!attempts.length && <p>No attempts yet.</p>}<ul className="attempt-history">{[...attempts].reverse().map(item => <li key={item.id}><a href={href(item.submittedAt === null ? { name: 'attempt', id: item.id } : { name: 'results', id: item.id })}>{item.mode} · {new Date(item.startedAt).toLocaleString()} · {item.questions.length} questions · {item.submittedAt === null ? 'Resume active attempt' : item.reason === 'timeout' ? 'Timed out' : 'Submitted'}</a></li>)}</ul>
    <div className="clear-bank"><button className="btn btn-secondary" onClick={() => { try { const raw = localStorage.getItem(ATTEMPT_STORAGE_KEY); downloadJson('pdf-smart-raw-attempt-backup.json', { rawSavedAttempts: raw }); } catch { setError('Browser storage cannot be read. Export the attempts still available in this tab above.'); } }}>Export raw saved attempt backup</button>{error && <p className="callout callout-danger" role="alert">{error}</p>}
    {confirm ? <div className="panel"><p>Clear all saved attempts, including active answers and deadlines? This cannot be undone. Export a backup first. Your question bank stays available.</p><div className="toolbar"><button className="btn btn-danger" onClick={() => { clear(); setConfirm(false); }}>Confirm clear attempts</button><button className="btn btn-secondary" onClick={() => setConfirm(false)}>Keep attempts</button></div></div> : <button className="btn btn-ghost" onClick={() => setConfirm(true)}>Clear saved attempts</button>}</div>
  </section>;
}
