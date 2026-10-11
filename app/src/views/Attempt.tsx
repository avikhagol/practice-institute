import { useEffect, useRef, useState } from 'react';
import { answerOf } from '../lib/attempt/attempt';
import { useAttempts } from '../state/attempts';
import { provenanceLine } from '../lib/provenance';
import { href, navigate } from '../router';

export function AttemptView({ id }: { id: string }) {
  const { attempts, act } = useAttempts(); const a = attempts.find(a => a.id === id);
  const [now, setNow] = useState(Date.now()); const [confirm, setConfirm] = useState(false);
  const [drawer, setDrawer] = useState(false); const [showAnswer, setShowAnswer] = useState(false);
  const [announcement, setAnnouncement] = useState(''); const announced = useRef(new Set<number>());
  const heading = useRef<HTMLHeadingElement>(null);
  const drawerToggle = useRef<HTMLButtonElement>(null);
  const drawerClose = useRef<HTMLButtonElement>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  const keepAnswering = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (drawer) drawerClose.current?.focus(); }, [drawer]);
  useEffect(() => { if (confirm) keepAnswering.current?.focus(); }, [confirm]);
  // Escape dismisses the open drawer or submit confirmation and returns focus to its trigger.
  useEffect(() => {
    if (!drawer && !confirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (drawer) { setDrawer(false); drawerToggle.current?.focus(); }
      else { setConfirm(false); submitButton.current?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawer, confirm]);
  useEffect(() => {
    const update = () => { setNow(Date.now()); act(id, { type: 'tick' }); };
    update(); const timer = window.setInterval(update, 1000);
    window.addEventListener('focus', update); document.addEventListener('visibilitychange', update);
    return () => { clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, [id, act]);
  useEffect(() => { if (a?.submittedAt !== null && a?.submittedAt !== undefined) navigate({ name: 'results', id }); }, [a?.submittedAt, id]);
  useEffect(() => { setShowAnswer(false); heading.current?.focus(); }, [a?.current]);
  const remaining = a?.deadline ? Math.max(0, Math.ceil((a.deadline - now) / 1000)) : null;
  useEffect(() => {
    if (remaining === null) return;
    const threshold = [60, 300, 600].find(t => remaining > 0 && remaining <= t);
    if (threshold && !announced.current.has(threshold)) { announced.current.add(threshold); setAnnouncement(`${Math.ceil(remaining / 60)} minute${remaining > 60 ? 's' : ''} remaining.`); }
  }, [remaining]);
  if (!a) return <section className="container page"><h1>Attempt unavailable</h1><a href={href({ name: 'setup' })}>Set up practice</a></section>;
  const q = a.questions[a.current]!; const source = a.sources.find(s => s.id === q.docId)!;
  const locked = a.submittedAt !== null || (a.deadline !== null && now >= a.deadline);
  const selected = answerOf(a, q.id); const answered = Object.keys(a.answers).length;
  const go = (index: number) => { act(id, { type: 'navigate', index }); setDrawer(false); heading.current?.focus(); };
  return <section className="container page attempt-page"><div className="attempt-bar"><div><strong>{a.mode === 'exam' ? 'Exam' : 'Practice'}</strong><span className="muted"> · {answered}/{a.questions.length} answered</span></div>{remaining !== null && <span className="timer" role="timer" aria-live="off" aria-label="Time remaining">{Math.floor(remaining / 60).toString().padStart(2, '0')}:{(remaining % 60).toString().padStart(2, '0')}</span>}<button ref={submitButton} className="btn btn-primary" disabled={locked} aria-expanded={confirm} onClick={() => setConfirm(true)}>Submit attempt</button></div>
    <p className="visually-hidden" role="status">{announcement}</p>
    {confirm && <div className="panel submit-confirm" role="group" aria-label="Confirm submission"><h2>Submit and lock your answers?</h2><p>{a.questions.length - answered} unanswered · {a.marked.length} marked for later. Submission cannot be undone.</p><div className="toolbar"><button className="btn btn-primary" onClick={() => act(id, { type: 'submit' })} disabled={locked}>Confirm submit</button><button ref={keepAnswering} className="btn btn-secondary" onClick={() => { setConfirm(false); submitButton.current?.focus(); }}>Keep answering</button></div></div>}
    <div className="attempt-layout"><div className="panel attempt-question"><h1 ref={heading} tabIndex={-1} className="attempt-heading">Question {a.current + 1} of {a.questions.length}</h1><p className="muted provenance">{provenanceLine(q.number, q, source)}</p>
      {q.context && <div className="q-context">{q.context}</div>}<p className="q-stem">{q.stem}</p>
      <fieldset className="answer-options" disabled={locked}><legend>Your answer</legend>{q.options.map(o => <label className={`answer-option${selected === o.key ? ' selected' : ''}`} key={o.key}><input type="radio" name={`answer-${q.id}`} value={o.key} checked={selected === o.key} onChange={() => act(id, { type: 'answer', id: q.id, key: o.key })} /><span><strong>{o.sourceLabel}</strong> {o.text}</span></label>)}</fieldset>
      <div className="toolbar"><button className="btn btn-secondary" disabled={locked || !selected} onClick={() => act(id, { type: 'answer', id: q.id, key: null })}>Clear answer</button><button className="btn btn-secondary" disabled={locked} aria-pressed={a.marked.includes(q.id)} onClick={() => act(id, { type: 'mark', id: q.id })}>{a.marked.includes(q.id) ? 'Unmark question' : 'Mark for later'}</button></div>
      {a.mode === 'practice' && <div className="practice-key"><button className="btn btn-ghost" aria-expanded={showAnswer} onClick={() => setShowAnswer(v => !v)}>{showAnswer ? 'Hide supplied answer' : 'Show supplied answer'}</button>{showAnswer && <div className="callout callout-info">{q.answerKey ? <p>Supplied key: {q.answerKey} · {q.options.find(o => o.key === q.answerKey)?.text} ({q.answerSource})</p> : <p>No answer key supplied. This question is ungraded.</p>}{q.explanation ? <p className="q-stem">{q.explanation}</p> : <p className="muted">No explanation supplied.</p>}</div>}</div>}
      <div className="toolbar question-travel"><button className="btn btn-secondary" disabled={locked || a.current === 0} onClick={() => go(a.current - 1)}>Previous question</button><button className="btn btn-secondary" disabled={locked || a.current === a.questions.length - 1} onClick={() => go(a.current + 1)}>Next question</button></div>
    </div><aside id="question-navigator" className={`question-navigator${drawer ? ' is-open' : ''}`} aria-label="Question navigator"><div className="panel"><h2>Questions</h2><p className="muted">✓ Answered · M Marked · ○ Unanswered</p><button ref={drawerClose} className="btn btn-secondary drawer-close" onClick={() => { setDrawer(false); drawerToggle.current?.focus(); }}>Close navigator</button><div className="navigator-grid">{a.questions.map((item, i) => <button className={`nav-square${answerOf(a, item.id) ? ' answered' : ''}${a.marked.includes(item.id) ? ' marked' : ''}`} key={item.id} aria-current={i === a.current ? 'step' : undefined} aria-label={`Question ${i + 1}, ${answerOf(a, item.id) ? 'answered' : 'unanswered'}${a.marked.includes(item.id) ? ', marked' : ''}`} disabled={locked} onClick={() => go(i)}>{i + 1}<small>{answerOf(a, item.id) ? '✓' : '○'}{a.marked.includes(item.id) && ' M'}</small></button>)}</div></div></aside></div>
    <button ref={drawerToggle} className="btn btn-secondary drawer-toggle" aria-controls="question-navigator" aria-expanded={drawer} onClick={() => setDrawer(v => !v)}>Questions ({answered}/{a.questions.length})</button>
  </section>;
}
