import { defineConfig } from '@playwright/test';
import baseline from './playwright.config';
// Packaged acceptance: the student Pages build talks to the PACKAGED runtime's public
// (StudentGateway) listener; the owner uses the packaged admin on the owner listener.
// The spec spawns release/linux-unpacked/resources/runtime itself (PI_PACKAGED_ROOT overrides).
// Ports differ from the other suites so they never collide with a dev/preview server.
const PUBLIC_PORT = 8798, STUDENT_PORT = 4327;
export default defineConfig({
  ...baseline,
  testDir: './packaged-e2e', outputDir: '../reports/packaged-playwright-results',
  timeout: 300000,
  projects: baseline.projects!.filter(p => p.name === 'desktop'),
  use: { ...baseline.use, baseURL: `http://127.0.0.1:${STUDENT_PORT}/practice-institute/` },
  webServer: {
    command: `VITE_PI_API_BASE=http://127.0.0.1:${PUBLIC_PORT} npm run build:pages && npx vite preview --base /practice-institute/ --port ${STUDENT_PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${STUDENT_PORT}/practice-institute/`, reuseExistingServer: false, timeout: 180000,
  },
});
