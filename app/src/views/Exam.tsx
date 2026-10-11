import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, type AttemptResult, type AttemptState, type ExamQuestion, type LangText } from '../lib/api/client';
import { findAttempt, rememberAttempt } from '../lib/api/resume';
import { acknowledge, batch, edit, initQueue, pendingCount, type QueueState } from '../lib/api/saveQueue';
import { formatRemaining, formatWhen } from '../lib/api/time';
import { href, navigate } from '../router';
import { useConnection } from '../state/connection';

type View = 'en' | 'hi' | 'both';
const PENDING_KEY = (id: string) => `practice-institute-pending-${id}`;
const WARNING_KEY = (id: string) => `practice-institute-unsaved-warning-${id}`;
const VIEW_KEY = 'practice-institute-lang-view';

function loadCarry(id: string): QueueState | undefined {
  try {
    const raw = localStorage.getItem(PENDING_KEY(id));
    return raw ? (JSON.parse(raw) as QueueState) : undefined;
  } catch {
    return undefined;
  }
}

/** Renders original text in the chosen language; never invents a translation. */
function Bilingual({ text, view, as: Tag = 'p', className }: { text: LangText; view: View; as?: 'p' | 'span' | 'div'; className?: string }) {
  const wantEn = view !== 'hi';
  const wantHi = view !== 'en';
  const en = wantEn ? text.en : null;
  const hi = wantHi ? text.hi : null;
  const fallback = !en && !hi ? (text.en ?? text.hi) : null;
  return (
    <Tag className={className}>
      {en && <span className="t-en" lang="en">{en}</span>}
      {hi && <span className="t-hi" lang="hi">{hi}</span>}
      {fallback && (
        <>
          <span className={text.en ? 't-en' : 't-hi'} lang={text.en ? 'en' : 'hi'}>{fallback}</span>
          <span className="t-missing">{text.en ? 'हिन्दी संस्करण उपलब्ध नहीं · Hindi version not in source' : 'English version not in source'}</span>
        </>
      )}
    </Tag>
  );
}

function LanguageSwitch({ view, setView }: { view: View; setView: (v: View) => void }) {
  return (
    <div className="seg" role="group" aria-label="Question language">
      {(['en', 'hi', 'both'] as View[]).map((v) => (
        <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>{v === 'en' ? 'English' : v === 'hi' ? 'हिन्दी' : 'Both'}</button>
      ))}
    </div>
  );
}

type ReviewItem = NonNullable<AttemptResult['review']>[number];
type Outcome = 'correct' | 'wrong' | 'unanswered' | 'unkeyed';
const OUTCOME_LABEL: Record<Outcome, string> = { correct: 'Correct', wrong: 'Wrong', unanswered: 'Not answered', unkeyed: 'No answer key' };
const OUTCOME_ICON: Record<Outcome, string> = { correct: '✓', wrong: '✗', unanswered: '–', unkeyed: '?' };

function outcomeOf(r: ReviewItem): Outcome {
  if (!r.your_choice) return 'unanswered';
  if (!r.answer_key) return 'unkeyed';
  return r.your_choice === r.answer_key ? 'correct' : 'wrong';
}

/** Released answer review: only the questions this attempt was assigned, in the order it saw them. */
function AnswerReview({ review, view, setView }: { review: ReviewItem[]; view: View; setView: (v: View) => void }) {
  const [filter, setFilter] = useState<'all' | Outcome>('all');
  const items = review.map((r, i) => ({ r, n: i + 1, outcome: outcomeOf(r) }));
  const count = (o: Outcome) => items.filter((x) => x.outcome === o).length;
  const filters = (['all', 'wrong', 'unanswered', 'correct', 'unkeyed'] as const).filter((f) => f === 'all' || count(f) > 0);
  const shown = filter === 'all' ? items : items.filter((x) => x.outcome === filter);
  return (
    <section className="answer-review" aria-labelledby="review-title">
      <div className="review-head">
        <h2 id="review-title">Review answers</h2>
        <LanguageSwitch view={view} setView={setView} />
      </div>
      <div className="seg seg-wrap" role="group" aria-label="Show questions">
        {filters.map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f === 'all' ? `All (${items.length})` : `${OUTCOME_LABEL[f]} (${count(f)})`}
          </button>
        ))}
      </div>
      <p className="visually-hidden" role="status" aria-live="polite">Showing {shown.length} of {items.length} questions</p>
      <ol className="review-list">
        {shown.map(({ r, n, outcome }) => (
          <li key={r.qid}>
            <article className={`review-card is-${outcome}`} aria-labelledby={`review-${r.qid}`}>
              <p className="review-meta">
                <span id={`review-${r.qid}`}>Question {n}</span>
                <span className={`outcome outcome-${outcome}`}><span aria-hidden="true">{OUTCOME_ICON[outcome]}</span> {OUTCOME_LABEL[outcome]}</span>
              </p>
              {(r.context.en || r.context.hi) && <Bilingual text={r.context} view={view} as="div" className="q-context" />}
              <Bilingual text={r.stem} view={view} as="div" className="q-stem review-stem" />
              <ul className="review-options">
                {r.options.map((o) => {
                  const mine = r.your_choice === o.key;
                  const key = r.answer_key === o.key;
                  return (
                    <li key={o.key} className={`review-option${key ? ' is-key' : ''}${mine && !key ? ' is-mine-wrong' : ''}`}>
                      <span className="option-key">{o.key}</span>
                      <Bilingual text={{ en: o.en, hi: o.hi }} view={view} as="span" />
                      <span className="review-tags">
                        {key && <span className="tag tag-key">✓ Correct answer</span>}
                        {mine && <span className={`tag ${key ? 'tag-key' : 'tag-wrong'}`}>Your answer</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {!r.your_choice && <p className="muted review-note">You did not answer this question.</p>}
              {!r.answer_key && <p className="muted review-note">This question has no answer key, so it was not scored.</p>}
              <div className="explanation">
                <h3>Explanation</h3>
                {r.explanation.en || r.explanation.hi
                  ? <Bilingual text={r.explanation} view={view} as="div" />
                  : <p className="muted">No explanation was provided for this question.</p>}
              </div>
            </article>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Exam({ id }: { id: string }) {
  const conn = useConnection();
  const { observe, markOffline } = conn;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusedPhase = useRef('');
  const entry = findAttempt(id);
  const [state, setState] = useState<AttemptState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [saveError, setSaveError] = useState<string | null>(() => localStorage.getItem(WARNING_KEY(id)));
  const [current, setCurrent] = useState(0);
  const [view, setView] = useState<View>(() => (localStorage.getItem(VIEW_KEY) as View) || 'both');
  const [now, setNow] = useState(() => Date.now());
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [resultNote, setResultNote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const inFlight = useRef(false);
  const queueRef = useRef<QueueState | null>(null);
  queueRef.current = queue;

  const token = entry?.token;

  const refresh = useCallback(async () => {
    if (!token) return;
    const sent = Date.now();
    try {
      const s = await api.attempt(id, token);
      observe(sent, Date.now(), s.server_now);
      setState(s);
      if (s.status !== 'active' && pendingCount(initQueue(s.answers, s.last_seq, queueRef.current ?? loadCarry(id))) > 0) {
        const warning = 'Some changes never reached the server before this attempt closed. Only acknowledged answers count.';
        setSaveError(warning);
        localStorage.setItem(WARNING_KEY(id), warning);
      }
      setQueue((q) => initQueue(s.answers, s.last_seq, s.status === 'active' ? q ?? loadCarry(id) : undefined));
      setError(null);
      if (s.status !== 'active') {
        localStorage.removeItem(PENDING_KEY(id));
        try {
          setResult(await api.result(id, token));
          setResultNote(null);
        } catch {
          setResultNote('Could not load results right now. Try again in a moment.');
        }
      }
    } catch (e) {
      if (e instanceof ApiError && e.offline) markOffline();
      else setError((e as Error).message);
    }
  }, [id, token, observe, markOffline]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  useEffect(() => { localStorage.setItem(VIEW_KEY, view); }, [view]);
  useEffect(() => { if (queue && state?.status === 'active') localStorage.setItem(PENDING_KEY(id), JSON.stringify(queue)); }, [queue, id, state?.status]);

  const serverNow = now + conn.offset;
  const phase = !state ? 'loading' : state.status !== 'active' ? 'finished' : state.phase === 'lobby' ? 'lobby' : 'running';

  // Announce a new screen once, without moving focus on timer ticks or polling.
  useEffect(() => {
    if (!state || !queue || error) return;
    const screen = `${id}:${phase}`;
    if (focusedPhase.current !== screen && headingRef.current) {
      focusedPhase.current = screen;
      headingRef.current.focus();
    }
  }, [id, phase, !!state, !!queue, error]);

  // Poll active attempts to discover owner extensions, closure and reconnect state.
  useEffect(() => {
    if (state && state.status !== 'active') return;
    const timer = setInterval(() => void refresh(), 5000);
    const online = () => void refresh();
    window.addEventListener('online', online);
    return () => { clearInterval(timer); window.removeEventListener('online', online); };
  }, [state?.status, refresh]);
  useEffect(() => { if (confirming) dialogRef.current?.showModal(); }, [confirming]);

  // Lobby: poll until the common start, then load questions.
  useEffect(() => {
    if (state?.phase === 'lobby' && serverNow >= state.started_at) void refresh();
  }, [state, serverNow, refresh]);
  useEffect(() => {
    if (state?.phase !== 'lobby') return;
    const t = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(t);
  }, [state?.phase, refresh]);

  const flush = useCallback(async () => {
    const q = queueRef.current;
    if (!token || !q || inFlight.current || pendingCount(q) === 0) return;
    inFlight.current = true;
    const sent = Date.now();
    try {
      const ack = await api.save(id, token, batch(q));
      observe(sent, Date.now(), ack.server_now);
      setQueue((cur) => (cur ? acknowledge(cur, ack.acked) : cur));
      setState(cur => cur ? { ...cur, deadline_at: ack.deadline_at } : cur);
      setSaveError(null);
    } catch (e) {
      if (e instanceof ApiError && e.offline) {
        markOffline();
        setSaveError('Not saved yet — you appear to be offline. Keep answering; we will retry automatically.');
      } else if (e instanceof ApiError && e.status === 409) {
        setSaveError('The server has closed this attempt. Changes after the deadline are not accepted.');
        void refresh();
      } else {
        setSaveError((e as Error).message);
      }
    } finally {
      inFlight.current = false;
    }
  }, [id, token, observe, markOffline, refresh]);

  // Debounced autosave + periodic retry while anything is pending.
  useEffect(() => {
    if (state?.status !== 'active' || !queue || pendingCount(queue) === 0) return;
    const t = setTimeout(() => void flush(), 600);
    const r = setInterval(() => void flush(), 5000);
    return () => { clearTimeout(t); clearInterval(r); };
  }, [queue, flush, state?.status]);

  // At the deadline the server finalises on its own; we just re-sync.
  useEffect(() => {
    if (phase === 'running' && state && serverNow > state.deadline_at + 2500) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase === 'running' && state ? serverNow > state.deadline_at + 2500 : false]);

  if (!entry) {
    return (
      <section className="container page narrow">
        <h1>Can’t open this attempt here</h1>
        <p className="callout callout-warn">Attempts can only be resumed in the browser where you joined. Open it on that device, or ask your teacher for help.</p>
        <a className="btn btn-secondary" href={href({ name: 'home' })}>Back to home</a>
      </section>
    );
  }
  if (error) return <section className="container page narrow"><p className="callout callout-danger" role="alert">{error}</p></section>;
  if (!state || !queue) return <section className="container page narrow" aria-busy="true"><p className="muted">{conn.status === 'offline' ? 'The server is unavailable. Your saved attempt stays here; we will reconnect automatically.' : 'Loading your exam…'}</p></section>;

  if (phase === 'lobby') {
    return (
      <section className="container page narrow lobby">
        <p className="eyebrow">Lobby · {state.exam.title}</p>
        <h1 ref={headingRef} tabIndex={-1}>Waiting for the exam to start</h1>
        <p className="timer-big" aria-live="off">Starting in {formatRemaining(state.started_at - serverNow)}</p>
        <p>You’re in as <strong>{state.alias}</strong>. The questions appear here automatically at {formatWhen(state.started_at)}. Everyone finishes at {formatWhen(state.deadline_at)}.</p>
        {state.exam.instructions && <div className="instructions"><h2>Instructions</h2><p style={{ whiteSpace: 'pre-wrap' }}>{state.exam.instructions}</p></div>}
      </section>
    );
  }

  if (phase === 'finished') {
    return (
      <section className="container page narrow">
        <p className="eyebrow">{state.exam.title}</p>
        <h1 ref={headingRef} tabIndex={-1}>{state.finish_reason === 'timeout' ? 'Time is up — your answers were submitted' : 'Submitted'}</h1>
        <p>The server recorded your attempt{state.finished_at ? ` at ${formatWhen(state.finished_at)}` : ''}. Only answers accepted by the server count.</p>
        {result?.scores_released ? (
          <div className="score-card">
            <p className="eyebrow">Score</p>
            <p className="score">{result.score ?? '—'}</p>
            <p>{result.correct} correct · {result.wrong} wrong · {result.unanswered} unanswered of {result.total}</p>
          </div>
        ) : result?.answers_released ? (
          <p className="callout">Your teacher has released the answers. Scores are not released yet.</p>
        ) : (
          <p className="callout">Results will appear here once your teacher releases them. Reopen this page later.</p>
        )}
        {saveError && <p className="callout callout-warn" role="alert">{saveError}</p>}
        <div className="finish-actions">
          <button type="button" className="btn btn-secondary" disabled={checking} onClick={async () => {
            setChecking(true);
            try { await refresh(); } finally { setChecking(false); }
          }}>{checking ? 'Checking…' : 'Check for results'}</button>
        {state.exam.mode === 'independent' && state.attempt_number < state.exam.max_attempts && serverNow < state.exam.closes_at && state.exam.status === 'published' && (
          <button type="button" className="btn btn-primary" disabled={submitting} onClick={async () => {
            setSubmitting(true);
            try {
              const r = await api.reattempt(id, token!);
              rememberAttempt({ attemptId: r.attempt_id, token: r.token, code: r.exam.code, title: r.exam.title, alias: state.alias, joinedAt: Date.now() });
              navigate({ name: 'exam', id: r.attempt_id });
            } catch (e) { setSaveError((e as Error).message); }
            finally { setSubmitting(false); }
          }}>Try again · attempt {state.attempt_number + 1} of {state.exam.max_attempts}</button>
        )}
        </div>
        <p className="muted" role="status" aria-live="polite">{resultNote ?? (checking ? 'Checking for released results…' : '')}</p>
        {result?.answers_released && result.review && <AnswerReview review={result.review} view={view} setView={setView} />}
      </section>
    );
  }

  const qs = state.questions;
  const q: ExamQuestion | undefined = qs[current];
  const answered = qs.filter((x) => queue.local[x.qid]?.choice).length;
  const pending = pendingCount(queue);
  const remaining = state.deadline_at - serverNow;

  const submit = async () => {
    setSubmitting(true);
    const sent = Date.now();
    try {
      const r = await api.submit(id, token!, batch(queue));
      observe(sent, Date.now(), r.server_now);
      await refresh();
    } catch (e) {
      setSaveError(e instanceof ApiError && e.offline ? 'Submit did not reach the server. Your exam is NOT submitted yet — reconnect and try again.' : (e as Error).message);
    } finally {
      setSubmitting(false);
      setConfirming(false);
    }
  };

  return (
    <section className="container page exam">
      <h1 ref={headingRef} tabIndex={-1}>{state.exam.title}</h1>
      <div className="exam-bar" role="region" aria-label="Exam status">
        <span className={`timer ${remaining < 60_000 ? 'timer-low' : ''}`} aria-label={`Time left ${formatRemaining(remaining)}`}>{formatRemaining(remaining)}</span>
        <span className={`save-state ${pending ? 'is-pending' : 'is-saved'}`} role="status" aria-live="polite">
          {pending ? `${pending} change${pending > 1 ? 's' : ''} not yet saved` : 'All answers saved ✓'}
        </span>
        <span className="muted">{answered}/{qs.length} answered</span>
        <LanguageSwitch view={view} setView={setView} />
      </div>
      {saveError && <p className="callout callout-warn" role="alert">{saveError}</p>}

      {q && (
        <article className="question-card" aria-labelledby={`stem-${q.qid}`}>
          <p className="q-number">Question {current + 1} of {qs.length}</p>
          {(q.context.en || q.context.hi) && <Bilingual text={q.context} view={view} as="div" className="q-context" />}
          <fieldset disabled={remaining <= 0 || submitting}>
            <legend id={`stem-${q.qid}`}><Bilingual text={q.stem} view={view} as="span" className="q-stem" /></legend>
            {q.options.map((o) => (
              <label key={o.key} className={`option ${queue.local[q.qid]?.choice === o.key ? 'is-selected' : ''}`}>
                <input type="radio" name={`q-${q.qid}`} value={o.key} checked={queue.local[q.qid]?.choice === o.key}
                  onChange={() => setQueue((cur) => (cur ? edit(cur, q.qid, { choice: o.key }) : cur))} />
                <span className="option-key">{o.key}</span>
                <Bilingual text={{ en: o.en, hi: o.hi }} view={view} as="span" />
              </label>
            ))}
          </fieldset>
          <div className="q-actions">
            <button type="button" className="btn btn-ghost btn-sm" disabled={!queue.local[q.qid]?.choice}
              onClick={() => setQueue((cur) => (cur ? edit(cur, q.qid, { choice: null }) : cur))}>Clear answer</button>
            <label className="mark-toggle">
              <input type="checkbox" checked={!!queue.local[q.qid]?.marked}
                onChange={(e) => setQueue((cur) => (cur ? edit(cur, q.qid, { marked: e.target.checked }) : cur))} />
              Mark for review
            </label>
          </div>
          <div className="q-nav">
            <button type="button" className="btn btn-secondary" disabled={current === 0} onClick={() => setCurrent((c) => c - 1)}>← Previous</button>
            {current < qs.length - 1
              ? <button type="button" className="btn btn-primary" onClick={() => setCurrent((c) => c + 1)}>Next →</button>
              : <button type="button" className="btn btn-primary" onClick={() => setConfirming(true)}>Review &amp; submit</button>}
          </div>
        </article>
      )}

      <nav className="navigator" aria-label="Question navigator">
        <ol>
          {qs.map((x, i) => {
            const a = queue.local[x.qid];
            const cls = [a?.choice ? 'is-answered' : '', a?.marked ? 'is-marked' : '', i === current ? 'is-current' : '', queue.pending[x.qid] ? 'is-pending' : ''].join(' ');
            return (
              <li key={x.qid}>
                <button type="button" className={`nav-cell ${cls}`} aria-current={i === current ? 'step' : undefined} onClick={() => setCurrent(i)}
                  aria-label={`Question ${i + 1}${a?.choice ? ', answered' : ', not answered'}${a?.marked ? ', marked for review' : ''}${queue.pending[x.qid] ? ', saving' : ''}`}>
                  {i + 1}
                </button>
              </li>
            );
          })}
        </ol>
        <button type="button" className="btn btn-secondary btn-block" onClick={() => setConfirming(true)}>Submit exam…</button>
      </nav>

      {confirming && (
        <dialog ref={dialogRef} className="confirm" aria-labelledby="confirm-title" onCancel={() => setConfirming(false)}>
          <h2 id="confirm-title">Submit now?</h2>
          <p>{answered} of {qs.length} answered · {qs.filter((x) => queue.local[x.qid]?.marked).length} marked for review. You cannot change answers after submitting.</p>
          {pending > 0 && <p className="callout callout-warn">{pending} change(s) are not yet saved; they will be sent with your submission.</p>}
          <div className="q-nav">
            <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)} autoFocus>Keep working</button>
            <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={submitting}>{submitting ? 'Submitting…' : 'Submit exam'}</button>
          </div>
        </dialog>
      )}
    </section>
  );
}
