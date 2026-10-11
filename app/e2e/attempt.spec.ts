import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
const SHOTS = join(import.meta.dirname, '../../screenshots/turn3'); mkdirSync(SHOTS, { recursive: true });
const source = { id: 'one', fileName: 'original-demo.pdf', label: 'Study source', year: '2024', sizeBytes: 12, pageCount: 2, pagesProcessed: 2, addedAt: 10, warnings: [], synthetic: true };
const qs = Array.from({ length: 3 }, (_, i) => ({ id: `one:q${i + 1}`, docId: 'one', number: i + 1, page: 1, pageEnd: 1, stem: `Original study question ${i + 1}?`, context: i === 0 ? 'A shared passage.' : null, options: ['A', 'B', 'C'].map(key => ({ key, sourceLabel: `(${key})`, text: `Choice ${key}` })), status: 'ok', confidence: .9, warnings: [], answerKey: i < 2 ? 'A' : null, answerSource: i < 2 ? 'manual' : 'none', explanation: i < 2 ? 'A supplied explanation.' : null, rawText: 'Original extraction', edited: false }));
const bank = { format: 'pdf-smart-question-bank', version: 1, sources: [source], questions: qs };
async function prepare(page: Page) {
  await page.goto('./#/review');
  await page.getByLabel('Import question bank JSON').setInputFiles({ name: 'bank.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bank)) });
  await page.getByRole('link', { name: 'Set up practice', exact: true }).click();
  await page.getByLabel('Question count').fill('3');
}
async function exam(page: Page) {
  await prepare(page); await page.getByLabel('Mode', { exact: true }).selectOption('exam');
  await page.getByLabel('Duration (minutes)').fill('1');
  await page.getByRole('button', { name: 'Read exam instructions' }).click();
  await expect(page.getByRole('heading', { name: 'Before your exam' })).toBeVisible();
  await page.getByRole('button', { name: 'Start exam', exact: true }).click();
  await expect(page.getByRole('timer')).toContainText('01:00');
}

test('practice navigates, marks and reloads; bank edits cannot alter snapshots; results export and clear', async ({ page }, info) => {
  await prepare(page); await page.getByLabel('Use my marking scheme (optional)').check();
  await page.getByLabel('Points for correct').fill('2'); await page.getByLabel('Points for incorrect').fill('-0.5');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(SHOTS, `setup-${info.project.name}.png`), fullPage: true });
  await page.getByRole('button', { name: 'Start practice' }).click();
  const stem = await page.locator('.attempt-question .q-stem').first().textContent();
  await page.getByRole('radio').first().focus(); await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('radio').nth(1)).toBeChecked();
  await page.getByRole('radio').first().check(); await page.getByRole('button', { name: 'Mark for later' }).click();
  await page.getByRole('button', { name: 'Show supplied answer' }).click();
  await expect(page.locator('.practice-key')).toContainText(/Supplied key:|No answer key supplied/);
  await page.getByRole('button', { name: 'Next question' }).click(); await page.reload();
  await expect(page.getByRole('heading', { name: 'Question 2 of 3' })).toBeVisible();
  await page.getByRole('button', { name: 'Previous question' }).click(); await expect(page.getByRole('radio').first()).toBeChecked();
  await expect(page.getByRole('button', { name: 'Unmark question' })).toHaveAttribute('aria-pressed', 'true');
  const attemptUrl = page.url();
  await page.getByRole('link', { name: 'Questions (3)', exact: true }).click();
  await page.locator('.q-card').first().getByRole('button', { name: 'Edit question', exact: true }).click();
  await page.getByLabel('Question text', { exact: true }).fill('Changed bank question'); await page.getByRole('button', { name: 'Save and accept' }).click();
  await page.getByRole('link', { name: 'Supply answer keys' }).click();
  await page.getByLabel('Answer for Q1', { exact: true }).selectOption('B'); await page.getByRole('button', { name: 'Save key for Q1', exact: true }).click();
  await expect(page.getByText('Saved to bank', { exact: true })).toBeVisible();
  await page.goto(attemptUrl); await expect(page.locator('.attempt-question .q-stem').first()).toHaveText(stem!);
  await page.screenshot({ path: join(SHOTS, `practice-${info.project.name}.png`), fullPage: true });
  await page.getByRole('button', { name: 'Submit attempt', exact: true }).click(); await page.getByRole('button', { name: 'Keep answering' }).click();
  await page.getByRole('button', { name: 'Submit attempt', exact: true }).click(); await page.getByRole('button', { name: 'Confirm submit' }).click();
  await expect(page.getByRole('heading', { name: 'Your results' })).toBeVisible();
  await expect(page.getByText('Partially graded — 2/3 questions have keys')).toBeVisible();
  await expect(page.getByText(/1 attempted · 2 unanswered/)).toBeVisible();
  await expect(page.locator('.q-card')).not.toContainText(['Changed bank question', 'Changed bank question', 'Changed bank question']);
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export this result (JSON)' }).click();
  const exported = JSON.parse(readFileSync((await (await download).path())!, 'utf8'));
  expect(exported.attempt.questions.find((q: { number: number }) => q.number === 1).answerKey).toBe('A'); expect(exported.result.keyed).toBe(2);
  await page.screenshot({ path: join(SHOTS, `results-${info.project.name}.png`), fullPage: true });
  await page.reload(); await expect(page.getByText('Submitted. Your answers are locked.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear saved attempts', exact: true }).click(); await page.getByRole('button', { name: 'Confirm clear attempts' }).click();
  await expect(page.getByText('Saved attempts (0/20)')).toBeVisible(); await expect(page.getByRole('link', { name: 'Questions (3)' })).toBeVisible();
});

test('absolute exam deadline survives reload and background expiry, submits once and locks answers', async ({ page }, info) => {
  await page.clock.install({ time: new Date('2026-10-11T12:00:00Z') });
  await exam(page); await expect(page.getByRole('button', { name: 'Show supplied answer' })).toHaveCount(0);
  await page.getByRole('radio').first().check(); await page.clock.fastForward('00:20'); await page.reload();
  await expect(page.getByRole('timer')).toContainText('00:40'); await expect(page.getByRole('radio').first()).toBeChecked();
  if (info.project.name === 'mobile') { await page.getByRole('button', { name: 'Questions (1/3)' }).click(); await expect(page.getByRole('button', { name: 'Question 1, answered', exact: true })).toBeVisible(); }
  await page.screenshot({ path: join(SHOTS, `exam-${info.project.name}.png`), fullPage: false });
  await page.getByRole('link', { name: 'Library (1)' }).click();
  await page.clock.fastForward('00:50'); await page.reload();
  await page.getByRole('link', { name: 'Practice', exact: true }).click(); await page.getByRole('link', { name: 'Past attempts' }).click();
  await page.getByRole('link', { name: /exam · .*Timed out/ }).click();
  await expect(page.getByText('Time’s up — submitted automatically.')).toBeVisible();
  await expect(page.getByText(/1m 0s elapsed/)).toBeVisible();
  const before = await page.evaluate(() => localStorage.getItem('pdf-smart-attempts-v1'));
  await page.clock.fastForward('00:20'); await page.reload(); expect(await page.evaluate(() => localStorage.getItem('pdf-smart-attempts-v1'))).toBe(before);
  const stored = JSON.parse(before!); const attempt = stored.attempts[0];
  await page.goto(`./#/attempt/${attempt.id}`); await expect(page.getByRole('heading', { name: 'Your results' })).toBeVisible(); await expect(page.getByRole('radio')).toHaveCount(0);
});

test('reload past deadline submits immediately even without a prior timer tick', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-11T12:00:00Z') }); await exam(page);
  await page.getByRole('radio').first().check();
  await page.clock.setSystemTime(new Date('2026-10-11T12:02:00Z')); await page.reload();
  await expect(page.getByText('Time’s up — submitted automatically.')).toBeVisible();
  const a = await page.evaluate(() => JSON.parse(localStorage.getItem('pdf-smart-attempts-v1')!).attempts[0]);
  expect(a.submittedAt).toBe(a.deadline); expect(Object.keys(a.answers)).toHaveLength(1);
});

test('source filtering promotes hidden copies and year selection narrows the pool', async ({ page }) => {
  await page.goto('./#/review');
  const two = { ...source, id: 'two', label: 'Copy source', fileName: 'copy.pdf', year: '2025' };
  const copies = qs.map(q => ({ ...q, id: q.id.replace('one', 'two'), docId: 'two' }));
  await page.getByLabel('Import question bank JSON').setInputFiles({ name: 'bank.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...bank, sources: [source, two], questions: [...qs, ...copies] })) });
  await page.getByRole('link', { name: 'Set up practice', exact: true }).click();
  await page.getByLabel(/Study source · original-demo.pdf/).uncheck(); await page.getByLabel('Question count').fill('3');
  await expect(page.getByText('3 ready questions', { exact: true })).toBeVisible();
  await page.getByLabel('Year filter').selectOption('2024'); await expect(page.getByText('0 ready questions', { exact: true })).toBeVisible();
  await page.getByLabel('Year filter').selectOption('2025'); await page.getByRole('button', { name: 'Start practice' }).click();
  await expect(page.locator('.provenance')).toContainText('copy.pdf');
});

test('key imports reject wrong mappings atomically, manual keys survive reload, no keys stays ungraded', async ({ page }) => {
  await prepare(page); await page.getByRole('link', { name: 'Questions (3)' }).click(); await page.getByRole('link', { name: 'Supply answer keys' }).click();
  const entries = qs.map(q => ({ questionId: q.id, number: q.number, key: null }));
  const key = { format: 'pdf-smart-answer-key', version: 1, sourceId: 'one', entries };
  await page.getByLabel('Import answer key JSON').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...key, entries: [entries[0], { ...entries[1], number: 99 }] })) });
  await expect(page.getByRole('alert')).toContainText('number and questionId'); await expect(page.getByLabel('Answer for Q1', { exact: true })).toHaveValue('A');
  await page.getByLabel('Answer for Q1', { exact: true }).selectOption('B');
  await page.getByLabel('Import answer key JSON').setInputFiles({ name: 'same-key.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...key, entries: qs.map(q => ({ questionId: q.id, number: q.number, key: q.answerKey })) })) });
  await expect(page.getByLabel('Answer for Q1', { exact: true })).toHaveValue('A');
  await page.getByLabel('Import answer key JSON').setInputFiles({ name: 'keys.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(key)) });
  await expect(page.getByText('Applied 3 answer-key entries', { exact: false })).toBeVisible(); await page.reload(); await expect(page.getByLabel('Answer for Q1', { exact: true })).toHaveValue('');
  await page.getByRole('link', { name: 'Practice', exact: true }).click(); await page.getByLabel('Question count').fill('3'); await page.getByRole('button', { name: 'Start practice' }).click();
  await page.getByRole('button', { name: 'Submit attempt', exact: true }).click(); await page.getByRole('button', { name: 'Confirm submit' }).click();
  await expect(page.getByText('Ungraded — no answer keys supplied')).toBeVisible(); await expect(page.getByText('No numeric score: no keys were supplied.')).toBeVisible();
});

test('attempt save failures and corrupt saved copies stay visible with recovery controls', async ({ page }) => {
  await page.addInitScript(() => { const set = Storage.prototype.setItem; Storage.prototype.setItem = function(k, v) { if (k === 'pdf-smart-attempts-v1') throw new DOMException('full', 'QuotaExceededError'); set.call(this, k, v); }; });
  await prepare(page); await page.getByRole('button', { name: 'Start practice' }).click();
  await expect(page.getByRole('alert')).toContainText('latest attempt changes could not be saved');
  await page.getByRole('button', { name: 'Retry saving attempts' }).click(); await expect(page.getByRole('alert')).toContainText('could not be saved');
});

test('corrupt saved attempt is preserved until explicitly cleared', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pdf-smart-attempts-v1', 'broken'));
  await page.goto('./#/results'); await expect(page.getByRole('alert')).toContainText('saved copy is untouched');
  expect(await page.evaluate(() => localStorage.getItem('pdf-smart-attempts-v1'))).toBe('broken');
  await page.getByRole('button', { name: 'Clear saved attempts', exact: true }).click(); await page.getByRole('button', { name: 'Confirm clear attempts' }).click();
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('pdf-smart-attempts-v1')))! ).attempts).toEqual([]);
});


test('PDF extraction leads to practice, then a configured exam with early confirmed submission', async ({ page }) => {
  await page.goto('./#/local'); await page.getByRole('button', { name: 'Try the example paper' }).click();
  await expect(page.getByText(/Done · 12 question candidates/)).toBeVisible();
  await page.getByRole('link', { name: 'Questions (12)' }).click();
  await page.getByRole('link', { name: 'Set up practice', exact: true }).click();
  await page.getByLabel('Question count').fill('2'); await page.getByRole('button', { name: 'Start practice' }).click();
  await page.getByRole('radio').first().check(); await page.getByRole('button', { name: 'Mark for later' }).click();
  await page.getByRole('button', { name: 'Next question' }).click(); await page.getByRole('radio').nth(1).check();
  await page.getByRole('button', { name: 'Submit attempt', exact: true }).click(); await page.getByRole('button', { name: 'Confirm submit' }).click();
  await expect(page.getByText('Ungraded — no answer keys supplied')).toBeVisible();
  await page.getByRole('link', { name: 'New practice or exam' }).click(); await page.getByLabel('Mode', { exact: true }).selectOption('exam');
  await page.getByLabel('Question count').fill('2'); await page.getByLabel('Duration (minutes)').fill('2');
  await page.getByRole('button', { name: 'Read exam instructions' }).click(); await page.getByRole('button', { name: 'Start exam', exact: true }).click();
  await page.getByRole('radio').first().check(); await page.getByRole('button', { name: 'Mark for later' }).click();
  await page.getByRole('button', { name: 'Next question' }).click();
  await page.getByRole('button', { name: 'Submit attempt', exact: true }).click();
  await expect(page.getByText('1 unanswered · 1 marked for later.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Keep answering' }).click(); await expect(page.getByRole('radio').first()).toBeEnabled();
  await page.getByRole('button', { name: 'Submit attempt', exact: true }).click(); await page.getByRole('button', { name: 'Confirm submit' }).click();
  await expect(page.getByText('Submitted. Your answers are locked.')).toBeVisible(); await expect(page.getByText(/1 attempted · 1 unanswered/)).toBeVisible();
  await expect(page.getByText('Saved attempts (2/20)')).toBeVisible();
});
