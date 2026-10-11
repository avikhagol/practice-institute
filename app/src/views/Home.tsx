import { useState, type FormEvent } from 'react';
import { href, navigate } from '../router';
import { loadResume } from '../lib/api/resume';

const CODE_RE = /^[A-Za-z0-9]{4,12}$/;

export function Home() {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const saved = loadResume();

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const clean = code.trim().toUpperCase();
    if (!CODE_RE.test(clean)) {
      setError('Exam codes are 4–12 letters or digits, e.g. K7M2QX.');
      return;
    }
    navigate({ name: 'join', code: clean });
  };

  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <p className="eyebrow">Mock exams for CTET, UGC NET &amp; more</p>
            <h1>
              Practise together, <em>calmly</em>.
            </h1>
            <p className="lede">
              Join your batch’s scheduled mock exam or take one at your own pace — in English, हिन्दी, or both side by side. Your answers save
              to the institute’s server as you go.
            </p>
            <form className="join-card" onSubmit={onSubmit} noValidate aria-labelledby="join-title">
              <h2 id="join-title" className="join-title">Have an exam code?</h2>
              <label htmlFor="exam-code" className="field-label">Exam code</label>
              <div className="join-row">
                <input
                  id="exam-code"
                  className="input input-code"
                  inputMode="text"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={12}
                  placeholder="K7M2QX"
                  value={code}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'code-error' : 'code-help'}
                  onChange={(e) => { setCode(e.target.value); setError(null); }}
                />
                <button type="submit" className="btn btn-primary">Find exam</button>
              </div>
              {error ? (
                <p id="code-error" className="field-error" role="alert">{error}</p>
              ) : (
                <p id="code-help" className="field-help">Your teacher shares this code. It lets you join — it never shows anyone else’s answers.</p>
              )}
            </form>
          </div>
          <div className="paper-stack" aria-hidden="true">
            <div className="paper-sheet" />
            <div className="paper-sheet" />
            <div className="paper-sheet">
              <div className="sheet-line" style={{ width: '45%' }} />
              <p className="sheet-q">Q 13. Learners who prefer doing and moving are…</p>
              <p className="sheet-q sheet-hi" lang="hi">प्र 13. जो शिक्षार्थी करके और चलकर सीखते हैं, वे…</p>
              <div className="sheet-opt">A · visual / दृश्य</div>
              <div className="sheet-opt is-picked">B · kinaesthetic / गतिक</div>
              <div className="sheet-opt">C · auditory / श्रव्य</div>
              <span className="sheet-timer">24:59</span>
            </div>
          </div>
        </div>
      </section>

      {saved.length > 0 && (
        <section className="container resume" aria-labelledby="resume-title">
          <h2 id="resume-title">Continue where you left off</h2>
          <ul className="resume-list">
            {saved.slice(0, 6).map((r) => (
              <li key={r.attemptId} className="resume-item">
                <div>
                  <strong>{r.title}</strong>
                  <span className="muted"> · as {r.alias} · code {r.code}</span>
                </div>
                <a className="btn btn-secondary btn-sm" href={href({ name: 'exam', id: r.attemptId })}>Open</a>
              </li>
            ))}
          </ul>
          <p className="field-help">Resume links work only on this device and browser. Use the same browser to come back.</p>
        </section>
      )}

      <section className="steps container" aria-labelledby="how">
        <h2 id="how" style={{ fontSize: 'var(--text-3xl)' }}>How it works</h2>
        <ol className="steps-grid">
          <li className="step">
            <h3>Join with a code</h3>
            <p>Enter the code and a display name. Use a nickname if you prefer — rankings, when shown, use names you choose.</p>
          </li>
          <li className="step">
            <h3>Answer at your pace</h3>
            <p>Every answer is saved to the server and shows a ✓ once confirmed. Reloading or losing Wi-Fi never resets your timer.</p>
          </li>
          <li className="step">
            <h3>See your results</h3>
            <p>Scores and explanations appear when your teacher releases them — usually after everyone has finished.</p>
          </li>
        </ol>
      </section>

      <section className="honest" aria-labelledby="local-mode">
        <div className="container">
          <h2 id="local-mode" style={{ fontSize: 'var(--text-2xl)' }}>Practising on your own with PDFs?</h2>
          <p>
            The <a href={href({ name: 'local' })}>personal PDF practice mode</a> opens papers on this device only, with nothing uploaded. It is
            separate from institute exams: results there are not sent to your teacher.
          </p>
        </div>
      </section>
    </>
  );
}
