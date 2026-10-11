import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(__dirname, '../../screenshots/turn1');
const REAL = join(__dirname, '../../fixtures/real/ctet-dec2024-paper1-setH.pdf');
mkdirSync(SHOTS, { recursive: true });

test('landing page renders under the Pages subpath without console errors', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('./#/local');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Turn exam PDFs into');
  await expect(page.getByText('Private by design.')).toBeVisible();
  await page.screenshot({ path: join(SHOTS, `landing-${info.project.name}.png`), fullPage: true });
  expect(errors).toEqual([]);
});

test('example paper runs through PDF.js extraction, reader and review', async ({ page }, info) => {
  await page.goto('./#/local');
  await page.getByRole('button', { name: 'Try the example paper' }).click();
  await expect(page).toHaveURL(/#\/library$/);
  await expect(page.getByText(/Done · 12 question candidates/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Synthetic demo — not a real exam paper')).toBeVisible();
  await page.screenshot({ path: join(SHOTS, `library-${info.project.name}.png`), fullPage: true });

  await page.getByRole('link', { name: 'Read as page' }).click();
  await expect(page.getByText('A learner who remembers best after building a model', { exact: false })).toBeVisible();
  await expect(page.getByRole('img', { name: /Original page 1 of/ })).toBeVisible();
  await expect(page.getByText(/^Original page 1 of/)).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: join(SHOTS, `reader-${info.project.name}.png`), fullPage: false });

  await page.getByRole('link', { name: /Questions \(12\)/ }).click();
  await page.getByRole('button', { name: /Needs review/ }).click();
  await expect(page.getByText('Only 2 option(s) detected; expected 4.')).toBeVisible();
  await page.screenshot({ path: join(SHOTS, `review-${info.project.name}.png`), fullPage: false });
});

test('non-PDF and corrupt files fail per-file with a clear message', async ({ page }) => {
  await page.goto('./#/library');
  await page.locator('input[type=file]').setInputFiles([
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
    { name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nthis is not really a pdf') },
    { name: 'empty.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0) },
  ]);
  await expect(page.getByText('Not a PDF file. Only .pdf documents are supported.')).toBeVisible();
  await expect(page.getByText(/damaged or invalid|could not open this file/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('The file is empty (0 bytes).')).toBeVisible();
});

test('real official CTET paper (local fixture) extracts 150 candidates', async ({ page }, info) => {
  test.skip(!existsSync(REAL) || info.project.name !== 'desktop', 'real paper is a local-only fixture');
  await page.goto('./#/library');
  await page.locator('input[type=file]').setInputFiles(REAL);
  await expect(page.getByText(/Done · 150 question candidates/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/legacy \(non-Unicode\) font/).first()).toBeVisible();
  await page.screenshot({ path: join(SHOTS, `real-ctet-library-${info.project.name}.png`), fullPage: true });
});
