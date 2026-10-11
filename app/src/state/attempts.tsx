import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ATTEMPT_LIMIT, ATTEMPT_STORAGE_KEY, parseAttempts, serializeAttempts, transition, type Attempt, type AttemptAction } from '../lib/attempt/attempt';

const Ctx = createContext<{
  attempts: Attempt[]; warning: string | null; retry: () => void;
  start: (a: Attempt) => void; act: (id: string, action: AttemptAction) => void; clear: () => void;
} | null>(null);
export function AttemptsProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(() => {
    try {
      const text = localStorage.getItem(ATTEMPT_STORAGE_KEY);
      const attempts = text ? parseAttempts(text).map(a => transition(a, { type: 'tick' }, Date.now())) : [];
      return { attempts, warning: null };
    } catch { return { attempts: [], warning: 'Saved attempts could not be read. The saved copy is untouched. Export the raw saved copy before clearing attempts or starting a new one.' }; }
  });
  const [attempts, setAttempts] = useState(initial.attempts);
  const current = useRef(attempts);
  const [warning, setWarning] = useState<string | null>(initial.warning);
  const save = useCallback((next: Attempt[]) => {
    try { localStorage.setItem(ATTEMPT_STORAGE_KEY, serializeAttempts(next)); setWarning(null); }
    catch { setWarning('Your latest attempt changes could not be saved on this device. Keep this tab open, retry saving, and export a backup from Results. Reload may lose answers or the deadline.'); }
  }, []);
  const commit = useCallback((next: Attempt[]) => {
    if (next === current.current) return;
    current.current = next; setAttempts(next); save(next);
  }, [save]);
  const act = useCallback((id: string, action: AttemptAction) => {
    const old = current.current;
    const next = old.map(a => a.id === id ? transition(a, action, Date.now()) : a);
    if (next.some((a, i) => a !== old[i])) commit(next);
  }, [commit]);
  useEffect(() => {
    // Persist reconciled reload expiry, but preserve corrupt data until an explicit change.
    if (!initial.warning && current.current.length) save(current.current);
    const tick = () => {
      const old = current.current;
      const next = old.map(a => transition(a, { type: 'tick' }, Date.now()));
      if (next.some((a, i) => a !== old[i])) commit(next);
    };
    const timer = window.setInterval(tick, 1000);
    window.addEventListener('focus', tick); document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); document.removeEventListener('visibilitychange', tick); };
  }, [commit, save, initial.warning]);
  return <Ctx.Provider value={{ attempts, warning, retry: () => save(current.current), act,
    start: a => {
      if (current.current.some(a => a.submittedAt === null)) throw new Error('Finish the active attempt first.');
      if (current.current.length >= ATTEMPT_LIMIT) throw new Error('The device holds at most 20 attempts. Export a backup and clear attempts before starting another.');
      commit([...current.current, a]);
    }, clear: () => commit([]),
  }}>{children}</Ctx.Provider>;
}
export function useAttempts() { const ctx = useContext(Ctx); if (!ctx) throw new Error('useAttempts outside provider'); return ctx; }
