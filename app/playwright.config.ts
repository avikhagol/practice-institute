import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium, defineConfig, devices } from '@playwright/test';

// E2E tests run against the PRODUCTION build served under a GitHub Pages-style
// repository subpath (/practice-institute/), not the dev server.
const PORT = 4317;
// Optional: reuse an already-installed Chromium instead of `npx playwright install`
// (e.g. PW_CHROMIUM=~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome).
// Without the env var, falls back to the newest cached full Chromium only when the
// browser matching this Playwright version is not installed.
function findChromium(): string | undefined {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM;
  try {
    if (existsSync(chromium.executablePath())) return undefined;
  } catch {
    /* fall through */
  }
  const cache = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(cache)) return undefined;
  const dirs = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
  for (const d of dirs) {
    const p = join(cache, d, 'chrome-linux64', 'chrome');
    if (existsSync(p)) return p;
  }
  return undefined;
}
const executablePath = findChromium();

export default defineConfig({
  testDir: './e2e',
  outputDir: '../reports/playwright-results',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}/practice-institute/`,
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    launchOptions: { executablePath },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `node scripts/make-error-fixtures.mjs && npm run build:pages && npx vite preview --base /practice-institute/ --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/practice-institute/`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
