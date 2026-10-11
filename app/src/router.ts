// Tiny hash router: works on GitHub Pages subpaths without a 404.html fallback.
import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'join'; code: string }
  | { name: 'exam'; id: string }
  | { name: 'local' }
  | { name: 'library' }
  | { name: 'read'; docId: string }
  | { name: 'review' }
  | { name: 'setup' }
  | { name: 'keys' }
  | { name: 'attempt'; id: string }
  | { name: 'results'; id?: string }
  | { name: 'not-found' };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/';
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'home' };
  if (parts[0] === 'join' && parts[1]) return { name: 'join', code: decodeURIComponent(parts[1]).toUpperCase() };
  if (parts[0] === 'exam' && parts[1]) return { name: 'exam', id: decodeURIComponent(parts[1]) };
  if (parts[0] === 'local' && parts.length === 1) return { name: 'local' };
  if (parts[0] === 'library' && parts.length === 1) return { name: 'library' };
  if (parts[0] === 'read' && parts[1]) return { name: 'read', docId: decodeURIComponent(parts[1]) };
  if (parts[0] === 'review' && parts.length === 1) return { name: 'review' };
  if (parts[0] === 'setup' && parts.length === 1) return { name: 'setup' };
  if (parts[0] === 'keys' && parts.length === 1) return { name: 'keys' };
  if (parts[0] === 'attempt' && parts[1]) return { name: 'attempt', id: decodeURIComponent(parts[1]) };
  if (parts[0] === 'results') return { name: 'results', id: parts[1] ? decodeURIComponent(parts[1]) : undefined };
  return { name: 'not-found' };
}

export function href(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/';
    case 'join': return `#/join/${encodeURIComponent(route.code)}`;
    case 'exam': return `#/exam/${encodeURIComponent(route.id)}`;
    case 'local': return '#/local';
    case 'library':
      return '#/library';
    case 'read':
      return `#/read/${encodeURIComponent(route.docId)}`;
    case 'review':
      return '#/review';
    case 'setup': return '#/setup';
    case 'keys': return '#/keys';
    case 'attempt': return `#/attempt/${encodeURIComponent(route.id)}`;
    case 'results': return route.id ? `#/results/${encodeURIComponent(route.id)}` : '#/results';
    default:
      return '#/';
  }
}

export function navigate(route: Route) {
  window.location.hash = href(route);
}

export function useRoute(manageFocus = true): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => {
      setRoute(parseHash(window.location.hash));
      if (!manageFocus) return;
      window.scrollTo({ top: 0 });
      // Move focus to the main landmark so screen readers announce the new view.
      document.getElementById('main')?.focus({ preventScroll: true });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, [manageFocus]);
  return route;
}
