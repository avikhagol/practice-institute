import { href, useRoute } from './router';
import { useStore } from './state/store';
import { useIngestQueue } from './state/useIngestQueue';
import { Landing } from './views/Landing';
import { Library } from './views/Library';
import { Reader } from './views/Reader';
import { Review } from './views/Review';
import { Setup } from './views/Setup';
import { AttemptView } from './views/Attempt';
import { Results } from './views/Results';
import { Keys } from './views/Keys';
import { useAttempts } from './state/attempts';
import { BrandMark } from './components/Icons';
import { Home } from './views/Home';
import { Join } from './views/Join';
import { Exam } from './views/Exam';
import { ConnectionPill } from './state/connection';

const LOCAL_ROUTES = ['local', 'library', 'read', 'review', 'setup', 'keys', 'attempt', 'results'];

export function App() {
  const route = useRoute();
  const ingest = useIngestQueue();
  const { state, storageWarning, retrySave } = useStore();
  const { warning: attemptWarning, retry: retryAttempts } = useAttempts();
  const local = LOCAL_ROUTES.includes(route.name);
  const nav = local ? [
    { label: 'Institute exams', to: href({ name: 'home' }), active: false },
    { label: 'PDF practice', to: href({ name: 'local' }), active: route.name === 'local' },
    { label: `Library${state.docs.length ? ` (${state.docs.length})` : ''}`, to: href({ name: 'library' }), active: route.name === 'library' || route.name === 'read' },
    { label: `Questions${state.questions.length ? ` (${state.questions.length})` : ''}`, to: href({ name: 'review' }), active: route.name === 'review' },
    { label: 'Practice', to: href({ name: 'setup' }), active: ['setup', 'attempt', 'results'].includes(route.name) },
  ] : [
    { label: 'Join an exam', to: href({ name: 'home' }), active: ['home', 'join', 'exam'].includes(route.name) },
    { label: 'PDF practice (on this device)', to: href({ name: 'local' }), active: false },
  ];

  return (
    <>
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>
        Skip to content
      </a>
      <header className="site-header">
        <div className="container">
          <a className="brand" href={href({ name: 'home' })}>
            <BrandMark className="brand-mark" />
            Practice Institute
          </a>
          <nav className="nav" aria-label="Main">
            {nav.map((n) => (
              <a key={n.to} href={n.to} aria-current={n.active ? 'page' : undefined}>
                {n.label}
              </a>
            ))}
          </nav>
          {!local && <ConnectionPill />}
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        {local && <p className="container mode-banner">Personal PDF practice — runs only in this browser; nothing here is sent to your teacher.</p>}
        {storageWarning && <div className="container storage-warning" role="alert"><p className="callout callout-warn">{storageWarning}</p><button type="button" className="btn btn-secondary btn-sm" onClick={retrySave}>Retry saving</button></div>}
        {attemptWarning && <div className="container storage-warning" role="alert"><p className="callout callout-warn">{attemptWarning}</p><button className="btn btn-secondary btn-sm" onClick={retryAttempts}>Retry saving attempts</button><a className="btn btn-secondary btn-sm" href={href({ name: 'results' })}>Attempt backups</a></div>}
        {route.name === 'setup' && <Setup />}
        {route.name === 'attempt' && <AttemptView key={route.id} id={route.id} />}
        {route.name === 'results' && <Results id={route.id} />}
        {route.name === 'keys' && <Keys />}
        {route.name === 'home' && <Home />}
        {route.name === 'join' && <Join key={route.code} code={route.code} />}
        {route.name === 'exam' && <Exam key={route.id} id={route.id} />}
        {route.name === 'local' && <Landing ingest={ingest} />}
        {route.name === 'library' && <Library ingest={ingest} />}
        {route.name === 'read' && <Reader docId={route.docId} />}
        {route.name === 'review' && <Review />}
        {route.name === 'not-found' && (
          <section className="container page empty">
            <h1>Page not found</h1>
            <p className="muted">That link doesn’t match anything in Practice Institute.</p>
            <a className="btn btn-primary" href={href({ name: 'home' })}>
              Go home
            </a>
          </section>
        )}
      </main>
      <footer className="site-footer">
        <div className="container">
          {local
            ? 'PDF practice runs entirely in your browser. Your PDFs are never uploaded. Extraction is heuristic — always check questions against the original page.'
            : 'Practice Institute · Institute exams are saved on your institute’s server. Results appear when your teacher releases them.'}
        </div>
      </footer>
    </>
  );
}
