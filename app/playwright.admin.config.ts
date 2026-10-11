import { defineConfig } from '@playwright/test';
import baseline from './playwright.config';
export default defineConfig({
  ...baseline, testDir:'./admin-e2e', outputDir:'../reports/admin-playwright-results',
  use:{...baseline.use,baseURL:'http://127.0.0.1:8789/admin/'},
  webServer:{command:'npm run build:admin && ../backend/.venv/bin/python ../backend/tests/browser_server.py',url:'http://127.0.0.1:8789/admin/',reuseExistingServer:false,timeout:180000},
});
