import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../lib/api/client';
import { useRoute } from '../router';
import { serverOffset } from '../lib/api/time';

export type ConnStatus = 'checking' | 'online' | 'offline';

interface Conn {
  status: ConnStatus;
  /** server − client clock, ms. */
  offset: number;
  lastOk: number | null;
  /** Feed timing from any successful API response (keeps offset fresh without extra polling). */
  observe: (sentAt: number, receivedAt: number, serverNow: number) => void;
  markOffline: () => void;
  recheck: () => void;
}

const Ctx = createContext<Conn | null>(null);
const POLL_MS = 15_000;

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const route = useRoute(false);
  const active = ['home', 'join', 'exam'].includes(route.name);
  const [status, setStatus] = useState<ConnStatus>('checking');
  const [offset, setOffset] = useState(0);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const best = useRef<{ rtt: number; at: number } | null>(null);

  const observe = useCallback((sentAt: number, receivedAt: number, serverNow: number) => {
    const rtt = receivedAt - sentAt;
    // Prefer low-latency samples; refresh at least once a minute to follow drift.
    if (!best.current || rtt <= best.current.rtt * 1.5 || receivedAt - best.current.at > 60_000) {
      best.current = { rtt, at: receivedAt };
      setOffset(serverOffset(sentAt, receivedAt, serverNow));
    }
    setStatus('online');
    setLastOk(receivedAt);
  }, []);

  const recheck = useCallback(async () => {
    const sent = Date.now();
    try {
      const h = await api.health();
      observe(sent, Date.now(), h.server_now);
    } catch {
      setStatus('offline');
    }
  }, [observe]);

  useEffect(() => {
    if (!active) return;
    void recheck();
    const id = setInterval(() => void recheck(), POLL_MS);
    const onOnline = () => void recheck();
    const onOffline = () => setStatus('offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      clearInterval(id);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [active, recheck]);

  const markOffline = useCallback(() => setStatus('offline'), []);
  const value = useMemo<Conn>(
    () => ({ status, offset, lastOk, observe, markOffline, recheck: () => void recheck() }),
    [status, offset, lastOk, observe, recheck, markOffline],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useConnection(): Conn {
  const c = useContext(Ctx);
  if (!c) throw new Error('useConnection outside ConnectionProvider');
  return c;
}

export function ConnectionPill() {
  const { status, recheck } = useConnection();
  const label = status === 'online' ? 'Server connected' : status === 'offline' ? 'Server unreachable' : 'Connecting…';
  return (
    <button type="button" className={`conn-pill conn-${status}`} onClick={recheck} title="Check the connection to the exam server">
      <span className="conn-dot" aria-hidden="true" />
      <span role="status" aria-live="polite">{label}</span>
    </button>
  );
}
