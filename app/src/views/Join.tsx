import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, type ExamInfo } from '../lib/api/client';
import { rememberAttempt } from '../lib/api/resume';
import { formatWhen } from '../lib/api/time';
import { href, navigate } from '../router';
import { useConnection } from '../state/connection';

const LANG_LABEL = { en: 'English', hi: 'हिन्दी (Hindi)' } as const;

export function Join({ code }: { code: string }) {
  const conn = useConnection();
  const [exam, setExam] = useState<ExamInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [alias, setAlias] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const sent = Date.now();
    api.exam(code).then(
      (e) => { if (live) { setExam(e); conn.observe(sent, Date.now(), e.server_now); } },
      (e: unknown) => { if (live) setLoadError(e instanceof ApiError && e.status === 404 ? 'No open exam uses that code. Check it with your teacher.' : (e as Error).message); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const onJoin = async (e: FormEvent) => {
    e.preventDefault();
    if (!exam) return;
    const name = alias.trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 40) {
      setError('Use 2–40 characters for your display name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.join(code, name);
      rememberAttempt({ attemptId: r.attempt_id, token: r.token, code: exam.code, title: exam.title, alias: name, joinedAt: Date.now() });
      navigate({ name: 'exam', id: r.attempt_id });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <section className="container page narrow">
        <h1>Exam not found</h1>
        <p className="callout callout-warn" role="alert">{loadError}</p>
        <a className="btn btn-secondary" href={href({ name: 'home' })}>Try another code</a>
      </section>
    );
  }
  if (!exam) return <section className="container page narrow" aria-busy="true"><p className="muted">Looking up exam {code}…</p></section>;

  const now = Date.now() + conn.offset;
  const lateJoinEnds = exam.opens_at + exam.late_join_s * 1000;
  const closed = exam.status !== 'published' || now >= exam.closes_at || (exam.mode === 'cohort' && now > lateJoinEnds);
  const notYet = exam.mode === 'independent' && now < exam.opens_at;

  return (
    <section className="container page narrow">
      <p className="eyebrow">Exam {exam.code}</p>
      <h1>{exam.title}</h1>
      <dl className="exam-facts">
        <div><dt>Format</dt><dd>{exam.mode === 'cohort' ? 'Scheduled batch exam — everyone starts and ends together' : 'Take it any time in the window'}</dd></div>
        <div><dt>{exam.mode === 'cohort' ? 'Starts' : 'Opens'}</dt><dd>{formatWhen(exam.opens_at)}</dd></div>
        <div><dt>{exam.mode === 'cohort' ? 'Ends' : 'Closes'}</dt><dd>{formatWhen(exam.closes_at)}</dd></div>
        <div><dt>Time allowed</dt><dd>{Math.round(exam.duration_s / 60)} minutes{exam.mode === 'cohort' ? ' (late joiners still finish at the common end)' : ''}</dd></div>
        <div><dt>Questions</dt><dd>{exam.question_count}{exam.scored ? ` · +${exam.marks.correct} correct${exam.marks.wrong ? `, −${exam.marks.wrong} wrong` : ', no negative marking'}` : ' · practice (not scored)'}</dd></div>
        <div><dt>Attempts</dt><dd>{exam.max_attempts} per saved identity{exam.mode === 'independent' ? ' · reattempt after finishing, within availability' : ''}</dd></div>
        {exam.random_subset && <div><dt>Paper selection</dt><dd>Seeded subset of {exam.question_count} from {exam.pool_count} questions. Papers may differ in difficulty.</dd></div>}
        <div><dt>Languages</dt><dd>{exam.languages.map((l) => LANG_LABEL[l]).join(' · ') || '—'}</dd></div>
      </dl>
      {exam.instructions && (
        <div className="instructions">
          <h2>Instructions</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{exam.instructions}</p>
        </div>
      )}
      {closed ? (
        <p className="callout callout-warn" role="alert">This exam is no longer accepting new participants.</p>
      ) : notYet ? (
        <p className="callout" role="status">This exam opens {formatWhen(exam.opens_at)}. Come back then.</p>
      ) : (
        <form className="join-card" onSubmit={onJoin} noValidate>
          <label htmlFor="alias" className="field-label">Your display name</label>
          <div className="join-row">
            <input id="alias" className="input" autoComplete="nickname" maxLength={40} value={alias}
              aria-invalid={error ? true : undefined} aria-describedby={error ? 'alias-error' : 'alias-help'}
              onChange={(e) => { setAlias(e.target.value); setError(null); }} />
            <button type="submit" className="btn btn-primary" disabled={busy || conn.status === 'offline'}>
              {busy ? 'Joining…' : exam.mode === 'cohort' && now < exam.opens_at ? 'Join the lobby' : 'Start exam'}
            </button>
          </div>
          {error ? <p id="alias-error" className="field-error" role="alert">{error}</p>
            : <p id="alias-help" className="field-help">Shown to your teacher. A nickname is fine. This browser will remember your attempt so you can resume.</p>}
          {conn.status === 'offline' && <p className="field-error" role="alert">The exam server is unreachable right now. Joining needs a connection.</p>}
        </form>
      )}
    </section>
  );
}
