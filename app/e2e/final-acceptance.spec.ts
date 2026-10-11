// Turn 6: final acceptance checks.
// 1. Accessibility-tree audit: the tree Chromium exposes to screen readers, captured with
//    ariaSnapshot on every main screen. This is NOT a substitute for a real NVDA/VoiceOver/Orca pass.
// 2. Browser text-size preference: Chromium's own default font size setting (Settings → Appearance →
//    Font size) raised from 16px to 32px in a real profile, rather than CSS injected by the test.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const SHOTS = join(import.meta.dirname, '../../screenshots/turn6');
const TREES = join(import.meta.dirname, '../../reports/a11y');
mkdirSync(SHOTS, { recursive: true });
mkdirSync(TREES, { recursive: true });

// Interactive roles that must always carry an accessible name.
const UNNAMED = /^\s*- (button|link|radio|checkbox|textbox|spinbutton|combobox|switch|tab|slider)(\s*\[[^\]]*\])?:?\s*$/;

async function audit(page: Page, name: string, project: string) {
  const tree = await page.locator('body').ariaSnapshot();
  writeFileSync(join(TREES, `${name}-${project}.yaml`), tree + '\n');
  expect(tree.split('\n').filter((line) => UNNAMED.test(line)), `${name}: unnamed controls`).toEqual([]);
  expect(tree, `${name}: main landmark`).toMatch(/^\s*- main/m);
  expect(tree, `${name}: heading`).toMatch(/- heading "[^"]+" \[level=[12]\]/);
  // Form fields must be programmatically labelled (label/aria-label/aria-labelledby), not placeholder-only.
  const unlabelled = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')]
      // Skip fields not exposed to AT (e.g. the hidden file input opened by a labelled button).
      .filter((el) => el.type !== 'hidden' && !el.closest('[hidden], [aria-hidden="true"]') && !(el.labels?.length || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')))
      .map((el) => el.outerHTML.slice(0, 120)));
  expect(unlabelled, `${name}: unlabelled fields`).toEqual([]);
}

test('accessibility tree exposes named controls, landmarks and labelled fields on every main screen', async ({ page }, info) => {
  const p = info.project.name;
  await page.goto('./#/local');
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  await audit(page, 'landing', p);

  await page.getByRole('button', { name: 'Try the example paper' }).click();
  await expect(page.getByText(/Done · 12 question candidates/)).toBeVisible();
  await audit(page, 'library', p);

  await page.getByRole('link', { name: 'Questions (12)' }).click();
  await audit(page, 'review', p);
  await page.locator('.q-card').first().getByRole('button', { name: 'Edit question', exact: true }).click();
  await audit(page, 'review-editor', p);
  await page.getByRole('button', { name: 'Cancel' }).first().click();

  await page.getByRole('link', { name: 'Set up practice', exact: true }).click();
  await page.getByLabel('Mode', { exact: true }).selectOption('exam');
  await page.getByLabel('Question count').fill('3');
  await page.getByLabel('Duration (minutes)').fill('5');
  await audit(page, 'setup', p);
  await page.getByRole('button', { name: 'Read exam instructions' }).click();
  await page.getByRole('button', { name: 'Start exam', exact: true }).click();
  await expect(page.getByRole('timer')).toBeVisible();
  await audit(page, 'exam', p);
  // Options sit in a fieldset/legend group, so a screen reader announces the group name with each choice.
  await expect(page.getByRole('group', { name: 'Your answer' }).getByRole('radio')).not.toHaveCount(0);

  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Submit attempt', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm submit' }).click();
  await expect(page.getByRole('heading', { name: 'Your results' })).toBeVisible();
  await audit(page, 'results', p);
});

test('Chromium default font size preference at 200% keeps the journey usable without sideways scrolling', async ({ playwright, launchOptions, baseURL }, info) => {
  test.skip(info.project.name !== 'desktop', 'one real-profile run is enough; the device emulation is irrelevant here');
  const profile = mkdtempSync(join(tmpdir(), 'practice-institute-fontpref-'));
  mkdirSync(join(profile, 'Default'));
  writeFileSync(join(profile, 'Default', 'Preferences'), JSON.stringify({ webkit: { webprefs: { default_font_size: 32, default_fixed_font_size: 26 } } }));
  const context = await playwright.chromium.launchPersistentContext(profile, { ...launchOptions, baseURL, viewport: { width: 1280, height: 900 } });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    const fits = () => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    await page.goto('./#/local');
    // Prove the browser preference (not test CSS) is in effect.
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('32px');
    await fits();
    await page.screenshot({ path: join(SHOTS, 'landing-fontpref-200.png'), fullPage: true });
    await page.getByRole('button', { name: 'Try the example paper' }).click();
    await expect(page.getByText(/Done · 12 question candidates/)).toBeVisible();
    await fits();
    await page.getByRole('link', { name: 'Questions (12)' }).click();
    await fits();
    await page.screenshot({ path: join(SHOTS, 'review-fontpref-200.png') });
    await page.getByRole('link', { name: 'Set up practice', exact: true }).click();
    await page.getByLabel('Mode', { exact: true }).selectOption('exam');
    await page.getByLabel('Question count').fill('3');
    await page.getByLabel('Duration (minutes)').fill('5');
    await page.getByRole('button', { name: 'Read exam instructions' }).click();
    await page.getByRole('button', { name: 'Start exam', exact: true }).click();
    await fits();
    const submit = page.getByRole('button', { name: 'Submit attempt', exact: true });
    await page.evaluate(() => window.scrollTo(0, 400));
    await expect(submit).toBeInViewport();
    await page.getByRole('radio').first().check();
    await page.screenshot({ path: join(SHOTS, 'exam-fontpref-200.png') });
    await submit.click();
    await expect(page.getByRole('button', { name: 'Keep answering' })).toBeFocused();
    await page.getByRole('button', { name: 'Confirm submit' }).click();
    await expect(page.getByRole('heading', { name: 'Your results' })).toBeVisible();
    await fits();
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
