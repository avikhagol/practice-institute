import { test, expect, type Page, type Locator } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';

async function tabTo(page: Page, target: Locator) {
  for (let n = 0; n < 160; n++) {
    if (await target.evaluate(el => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Control unreachable with Tab: ${await target.getAttribute('name')}`);
}
async function type(page: Page, target: Locator, value: string) {
  await tabTo(page, target);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(value);
}
async function activate(page: Page, target: Locator) {
  await tabTo(page, target);
  await page.keyboard.press('Enter');
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('320px admin keyboard: login, policy controls, publish, results scroll, CSV and release', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one 320px CSS-pixel keyboard pass');
  await page.setViewportSize({ width: 320, height: 640 });
  mkdirSync('../screenshots/turn6', { recursive: true });
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await noOverflow(page);
  await page.screenshot({ path: '../screenshots/turn6/admin-login-320.png', fullPage: true });
  await type(page, page.getByLabel('Username', { exact: true }), 'browser-owner');
  await type(page, page.getByLabel('Password', { exact: true }), 'disposable-browser-password');
  await activate(page, page.getByRole('button', { name: 'Sign in', exact: true }));
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await noOverflow(page);
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeFocused();
  await page.screenshot({ path: '../screenshots/turn6/admin-dashboard-320.png', fullPage: true });
  await activate(page, page.getByRole('button', { name: 'Sources', exact: true }));
  await expect(page.getByRole('heading', { name: 'Sources', exact: true })).toBeFocused();
  await noOverflow(page);
  await page.screenshot({ path: '../screenshots/turn6/admin-sources-320.png', fullPage: true });
  await activate(page, page.getByRole('button', { name: 'Question bank', exact: true }));
  await activate(page, page.getByRole('button', { name: 'Add manual question' }));
  await expect(page.getByRole('heading', { name: 'New manual question' })).toBeFocused();
  await noOverflow(page);
  await page.screenshot({ path: '../screenshots/turn6/admin-editor-320.png', fullPage: true });
  await activate(page, page.getByRole('button', { name: 'Back to bank' }));
  const session = await (await page.request.get('/api/admin/me')).json();
  const headers = { 'X-CSRF-Token': session.csrf_token };
  const seeded = await page.request.post('/api/admin/questions', { headers, data: [1, 2].map(n => ({
    stem_en: `Original keyboard fixture ${n}: choose A.`, stem_hi: `मूल प्रश्न ${n}: पहला विकल्प चुनिए।`,
    subject: 'Keyboard QA', origin: 'manual', status: 'reviewed', answer_key: 'A', key_verified: true,
    options: [{ key: 'A', en: 'First', hi: 'पहला' }, { key: 'B', en: 'Second', hi: 'दूसरा' }],
  })) });
  expect(seeded.ok()).toBe(true);
  await activate(page, page.getByRole('button', { name: 'Refresh', exact: true }));
  await expect(page.getByText('Up to date.', { exact: true })).toBeVisible();
  await activate(page, page.getByRole('button', { name: 'Exams', exact: true }));
  const subject = page.getByRole('combobox', { name: 'Subject', exact: true });
  await tabTo(page, subject);
  await page.keyboard.press('k'); await page.keyboard.press('Enter');
  await expect(subject).toHaveValue('Keyboard QA');
  await type(page, page.getByLabel('Sample count'), '2');
  await type(page, page.getByLabel('Random seed', { exact: true }), 'keyboard-6');
  await activate(page, page.getByRole('button', { name: 'Sample matching bank' }));
  await expect(page.getByText('Selected 2 questions with seed keyboard-6.')).toBeVisible();
  await type(page, page.getByLabel('Exam title'), '320px keyboard policy exam');
  const order = page.getByLabel('Question order');
  await tabTo(page, order); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(order).toHaveValue('per-attempt');
  await type(page, page.getByLabel('Attempt limit'), '2');
  await type(page, page.getByLabel('Questions per attempt'), '1');
  await type(page, page.getByLabel('Subset seed'), 'subset-keyboard-6');
  await noOverflow(page);
  await page.screenshot({ path: '../screenshots/turn6/admin-builder-320.png', fullPage: true });
  await activate(page, page.getByRole('button', { name: 'Create draft · 2 questions' }));
  await expect(page.getByText(/Draft .* created/)).toBeVisible();
  const row = page.locator('.exam-row').filter({ hasText: '320px keyboard policy exam' });
  await activate(page, row.getByRole('button', { name: 'Publish paper' }));
  await expect(page.getByText(/Published .* Share this join code/)).toBeVisible();
  const code = (await row.locator('.code').innerText()).trim();
  const exam = (await (await page.request.get('/api/admin/exams')).json()).exams.find((e: { code: string }) => e.code === code);
  expect(exam).toMatchObject({ max_attempts: 2, subset_count: 1, subset_seed: 'subset-keyboard-6' });
  const joined = await page.request.post(`/api/v1/exams/${code}/join`, { data: { alias: 'Keyboard alias that tests narrow reflow' } });
  expect(joined.status()).toBe(201);
  await activate(page, row.getByRole('button', { name: 'View attempts' }));
  await expect(page.getByRole('cell', { name: 'Keyboard alias that tests narrow reflow' })).toBeVisible();
  await noOverflow(page);
  const table = page.getByRole('region', { name: 'Attempt activity table' });
  await tabTo(page, table);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => table.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  const downloaded = page.waitForEvent('download');
  await activate(page, page.getByRole('link', { name: 'Download CSV' }));
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  expect(readFileSync((await download.path())!, 'utf8')).toContain('Keyboard alias that tests narrow reflow');
  const release = page.getByLabel('Release answers');
  await tabTo(page, release); await page.keyboard.press('Space');
  await expect(page.getByText('Answers released.', { exact: true })).toBeVisible();
  await expect(release).toBeChecked();
  await noOverflow(page);
  await table.evaluate(el => { el.scrollLeft = 0; });
  await page.screenshot({ path: '../screenshots/turn6/admin-results-320.png', fullPage: true });
  // End a real server session behind the open page; the next request must return
  // to login with an expiry announcement, unlike the unauthenticated first visit.
  expect((await page.request.post('/api/admin/logout', { headers, data: {} })).ok()).toBe(true);
  await activate(page, page.getByRole('button', { name: 'Refresh', exact: true }));
  await expect(page.getByRole('alert')).toContainText('Your session expired');
  await expect(page.getByLabel('Username', { exact: true })).toBeFocused();
});
