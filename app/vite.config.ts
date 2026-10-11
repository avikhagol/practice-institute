/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// The student API origin is fixed at build time (VITE_PI_API_BASE, see .env.example) so the
// CSP can allow exactly that origin. No secrets belong in VITE_* variables: they are public.
const API_BASE = (process.env.VITE_PI_API_BASE ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
const API_ORIGIN = new URL(API_BASE).origin;

// Production-only CSP: network access only to our own origin and the configured API origin,
// no eval, no plugins. (Dev mode needs inline HMR preamble scripts, so it is build-only.)
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${API_ORIGIN} blob: data:`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'practice-institute-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
    ],
  };
}

// GitHub Pages project sites live under /<repo>/. Set BASE_PATH=/<repo>/ at build
// time (see README). Default './' keeps the build relocatable for local previews.
// All app routes are hash-based (#/review, #/exam ...) so no 404.html fallback is needed.
const base = process.env.BASE_PATH ?? './';

export default defineConfig({
  base,
  plugins: [react(), cspPlugin()],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
  define: { 'import.meta.env.VITE_PI_API_BASE': JSON.stringify(API_BASE) },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
