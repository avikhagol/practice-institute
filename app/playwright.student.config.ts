import { defineConfig } from '@playwright/test';
import baseline from './playwright.config';
export default defineConfig({
  ...baseline,
  testDir: './student-e2e', outputDir: '../reports/student-playwright-results',
  timeout: 120000,
  webServer: {
    command: 'VITE_PI_API_BASE=http://127.0.0.1:8791 npm run build:pages && npx vite preview --base /practice-institute/ --port 4317 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4317/practice-institute/', reuseExistingServer: false, timeout: 180000,
  },
});
