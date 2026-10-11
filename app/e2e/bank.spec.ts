import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
const ROOT = join(import.meta.dirname, '../..');
const SHOTS = join(ROOT, 'screenshots/turn2');
mkdirSync(SHOTS, { recursive: true });

async function example(page: import('@playwright/test').Page) {
  await page.goto('./#/local'); await page.getByRole('button', { name: 'Try the example paper' }).click();
  await expect(page.getByText(/Done · 12 question candidates/)).toBeVisible();
  await page.getByRole('link', { name: 'Questions (12)' }).click();
}

test('edit, accept, exclude, restore and metadata survive reload; JSON round trips', async ({ page }, info) => {
  await example(page);
  const first = page.locator('.q-card').first();
  await first.getByRole('button', { name: 'Edit question', exact: true }).click();
  await first.getByLabel('Question text', { exact: true }).fill('Which learning method was corrected?');
  await first.getByLabel('Passage / directions (optional)').fill('A corrected shared passage.');
  await first.getByLabel('Option A', { exact: true }).fill('A corrected option');
  await first.getByLabel('Printed label for A', { exact: true }).fill('(a)');
  await first.getByRole('button', { name: 'Save and accept' }).click();
  await expect(first.getByText('Looks good', { exact: true })).toBeVisible();
  await first.getByRole('button', { name: 'Exclude question' }).click();
  await expect(first.getByText('Excluded', { exact: true })).toBeVisible();
  await first.getByRole('button', { name: 'Restore question' }).click();
  await expect(first.getByText('Looks good', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Library (1)' }).click();
  await page.getByRole('button', { name: 'Edit label and year' }).click();
  await page.getByLabel('Source label').fill('My study paper'); await page.getByLabel('Year (optional)').fill('2025');
  await page.getByRole('button', { name: 'Save source' }).click();
  await page.getByRole('link', { name: 'Questions (12)' }).click();
  await expect(first).toContainText('My study paper'); await expect(first).toContainText('2025');
  await page.reload();
  await expect(first).toContainText('Which learning method was corrected?'); await expect(first).toContainText('A corrected option');
  await expect(first).toContainText('Source not loaded');
  await expect(first.locator('.q-opts li').first()).toContainText('(a)');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(SHOTS, `bank-${info.project.name}.png`), fullPage: false });
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export bank (JSON)' }).click();
  const path = await (await download).path();
  await page.getByRole('button', { name: 'Clear saved bank', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm clear bank' }).click();
  await page.getByLabel('Import question bank JSON').setInputFiles(path!);
  await expect(page.getByText('Imported 12 questions from 1 sources.', { exact: false })).toBeVisible();
  await expect(first).toContainText('Which learning method was corrected?');
  await expect(first).toContainText('My study paper'); await expect(first).toContainText('2025');
});

test('manual entry validates, supports option removal and keyboard editing', async ({ page }, info) => {
  await page.goto('./#/review'); await page.getByRole('button', { name: 'Add question', exact: true }).click();
  await page.getByLabel('Question text', { exact: true }).fill('What is two plus two?');
  await page.getByRole('button', { name: 'Save and accept' }).click();
  await expect(page.getByRole('alert')).toContainText('Fill every option');
  await page.getByLabel('Option A', { exact: true }).fill('Four'); await page.getByLabel('Option B', { exact: true }).fill('Five');
  await page.getByRole('button', { name: 'Remove option C' }).click(); await page.getByRole('button', { name: 'Remove option D' }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(SHOTS, `editor-${info.project.name}.png`), fullPage: true });
  await page.getByRole('button', { name: 'Save and accept' }).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.q-card')).toContainText('Looks good'); await expect(page.locator('.q-opts li')).toHaveCount(2);
  await page.reload(); await expect(page.locator('.q-card')).toContainText('What is two plus two?');
});

test('flagged question can be corrected and accepted', async ({ page }) => {
  await example(page); await page.getByRole('button', { name: /^Needs review/ }).click();
  const card = page.locator('.q-card').filter({ hasText: 'Only 2 option(s) detected; expected 4.' });
  await card.getByRole('button', { name: 'Edit question', exact: true }).click();
  await card.getByRole('button', { name: 'Add option' }).click(); await card.getByLabel('Option C', { exact: true }).fill('A manually supplied third option');
  await card.getByRole('button', { name: 'Add option' }).click(); await card.getByLabel('Option D', { exact: true }).fill('A manually supplied fourth option');
  await card.getByRole('button', { name: 'Save and accept' }).click();
  await page.getByRole('button', { name: /^Looks good/ }).click();
  await expect(page.locator('.q-card').filter({ hasText: 'A manually supplied third option' })).toContainText('Looks good');
});

test('multi-file duplicate summary keeps different options separate and copies inspectable', async ({ page }) => {
  await page.goto('./#/library');
  const demo = join(ROOT, 'app/public/demo/pdf-smart-synthetic-demo.pdf');
  await page.locator('input[type=file]').setInputFiles([demo, demo]);
  await expect(page.getByText(/Done · 12 question candidates/)).toHaveCount(2);
  await page.getByRole('link', { name: 'Questions (24)' }).click();
  await expect(page.getByText(/duplicates hidden, from files/)).toBeVisible();
  await page.getByRole('button', { name: /^Duplicates/ }).click();
  const before = await page.locator('.q-card').count(); expect(before).toBeGreaterThan(0);
  await page.locator('.q-card').first().getByRole('button', { name: 'Edit question', exact: true }).click();
  await page.getByLabel('Option A', { exact: true }).fill('A distinct option from this source'); await page.getByRole('button', { name: 'Save and accept' }).click();
  await expect(page.locator('.q-card')).toHaveCount(before - 1);
  await page.getByRole('button', { name: /^All \(/ }).click();
  await expect(page.getByText('A distinct option from this source', { exact: true })).toBeVisible();
});

test('malformed JSON is rejected atomically and failed browser saves stay visible', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); }; });
  await example(page); await expect(page.getByRole('alert')).toContainText('could not be saved');
  await page.getByLabel('Import question bank JSON').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"pdf-smart-question-bank","version":9,"sources":[],"questions":[]}') });
  await expect(page.getByText(/only version 1 is supported/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Questions (12)' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry saving' }).click(); await expect(page.getByText(/latest changes could not be saved/)).toBeVisible();
});

test('password, image-only and oversize fixtures get honest messages', async ({ page }) => {
  await page.goto('./#/library');
  await page.locator('input[type=file]').setInputFiles(['password.pdf', 'image-only.pdf', 'oversize.pdf'].map(name => join(ROOT, 'fixtures/synthetic', name)));
  await expect(page.getByText(/This PDF is password-protected/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/scanned|image-only/).filter({ hasNotText: 'image-only.pdf' }).first()).toBeVisible();
  await expect(page.getByText(/limit is 40.0 MB per file/)).toBeVisible();
  await expect(page.getByText(/Done · 0 question candidates/)).toBeVisible();
});

test('unreadable stored bank is not overwritten on load', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pdf-smart-bank-v1', 'broken saved JSON'));
  await page.goto('./#/review');
  await expect(page.getByRole('alert')).toContainText('saved copy has been left untouched');
  expect(await page.evaluate(() => localStorage.getItem('pdf-smart-bank-v1'))).toBe('broken saved JSON');
});
