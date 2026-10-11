import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const ROOT = join(import.meta.dirname, '../..');

test('mixed PDF queue continues after malformed, scanned and locked files; valid bank survives reload', async ({ page }) => {
  await page.goto('./#/library');
  await page.locator('input[type=file]').setInputFiles([
    { name: 'malformed.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\ninvalid objects') },
    { name: 'scan.pdf', mimeType: 'application/pdf', buffer: readFileSync(join(ROOT, 'fixtures/synthetic/image-only.pdf')) },
    { name: 'locked.pdf', mimeType: 'application/pdf', buffer: readFileSync(join(ROOT, 'fixtures/synthetic/password.pdf')) },
    { name: 'valid-after-errors.pdf', mimeType: 'application/pdf', buffer: readFileSync(join(ROOT, 'app/public/demo/pdf-smart-synthetic-demo.pdf')) },
  ]);
  await expect(page.getByText(/damaged or invalid|could not open this file/)).toBeVisible();
  await expect(page.getByText(/This PDF is password-protected/)).toBeVisible();
  await expect(page.getByText(/Done · 0 question candidates/)).toBeVisible();
  await expect(page.getByText(/Done · 12 question candidates/)).toBeVisible();
  await expect(page.locator('.doc-card')).toHaveCount(2);
  await page.getByRole('link', { name: 'Questions (12)' }).click();
  await expect(page.locator('.q-card')).toHaveCount(12);
  await page.reload();
  await expect(page.locator('.q-card')).toHaveCount(12);
  await expect(page.getByText('Source not loaded').first()).toBeVisible();
});

test('blocked storage reads report both failures; explicit retry recovers bank and attempt persistence', async ({ page }) => {
  await page.addInitScript(() => {
    const originalGet = Storage.prototype.getItem;
    const originalSet = Storage.prototype.setItem;
    Object.assign(window, { storageBlocked: sessionStorage.getItem('test-storage-recovered') !== 'true' });
    Storage.prototype.getItem = function (key) {
      if (Reflect.get(window, 'storageBlocked')) throw new DOMException('blocked', 'SecurityError');
      return originalGet.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (Reflect.get(window, 'storageBlocked')) throw new DOMException('blocked', 'SecurityError');
      originalSet.call(this, key, value);
    };
  });
  await page.goto('./#/local');
  await expect(page.getByRole('alert').filter({ hasText: 'saved bank could not be read' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Saved attempts could not be read' })).toBeVisible();
  await page.getByRole('button', { name: 'Try the example paper' }).click();
  await expect(page.getByText(/Done · 12 question candidates/)).toBeVisible();
  await page.getByRole('link', { name: 'Questions (12)' }).click();
  await page.getByRole('link', { name: 'Set up practice', exact: true }).click();
  await page.getByLabel('Question count').fill('2');
  await page.getByRole('button', { name: 'Start practice' }).click();
  await page.getByRole('radio').first().check();
  await expect(page.getByRole('alert').filter({ hasText: 'latest attempt changes could not be saved' })).toBeVisible();
  await page.evaluate(() => Reflect.set(window, 'storageBlocked', false));
  await page.getByRole('button', { name: 'Retry saving', exact: true }).click();
  await page.getByRole('button', { name: 'Retry saving attempts' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const saved = await page.evaluate(() => ({
    bank: JSON.parse(localStorage.getItem('pdf-smart-bank-v1')!),
    attempts: JSON.parse(localStorage.getItem('pdf-smart-attempts-v1')!),
  }));
  expect(saved.bank.questions).toHaveLength(12);
  expect(Object.keys(saved.attempts.attempts[0].answers)).toHaveLength(1);
  await page.evaluate(() => sessionStorage.setItem('test-storage-recovered', 'true'));
  await page.reload();
  await expect(page.getByRole('radio').first()).toBeChecked();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
