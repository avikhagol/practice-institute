// Turn 4: a full journey on a REAL official CTET paper (local, git-ignored fixture; see
// fixtures/real/PROVENANCE.md). Skipped automatically when the fixture is absent.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const SHOTS = join(import.meta.dirname, '../../screenshots/turn4');
const REAL = join(import.meta.dirname, '../../fixtures/real/ctet-dec2024-paper1-setH.pdf');
mkdirSync(SHOTS, { recursive: true });

test('real CTET paper: upload → review → practice → timed exam → keyboard navigator → ungraded results', async ({ page }, info) => {
  test.skip(!existsSync(REAL), 'real paper is a local-only fixture');
  test.setTimeout(150_000);
  const shot = (name: string, fullPage = false) => page.screenshot({ path: join(SHOTS, `${name}-${info.project.name}.png`), fullPage });

  await page.goto('./#/library');
  await page.locator('input[type=file]').setInputFiles(REAL);
  await expect(page.getByText(/Done · 150 question candidates/)).toBeVisible({ timeout: 90_000 });

  // Review: after the Turn 4 parser fixes only the unreadable stacked-fraction item needs review.
  await page.getByRole('link', { name: /Questions \(150\)/ }).click();
  await page.getByRole('button', { name: /Needs review/ }).click();
  await expect(page.locator('.q-card')).toHaveCount(1);
  await expect(page.locator('.q-card')).toContainText('An option has no readable text');
  await shot('real-review');

  // Practice: seeded, keyboard-only option selection, supplied answer honestly absent.
  await page.getByRole('link', { name: 'Set up practice', exact: true }).click();
  await page.getByLabel('Question count').fill('5');
  await page.getByLabel('Seed').fill('2024');
  await page.getByRole('button', { name: 'Start practice' }).click();
  await expect(page.getByRole('heading', { name: 'Question 1 of 5' })).toBeFocused();
  await expect(page.locator('.provenance')).toContainText('ctet-dec2024-paper1-setH.pdf');
  await page.getByRole('radio').first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('radio').nth(1)).toBeChecked();
  await page.getByRole('button', { name: 'Show supplied answer' }).click();
  await expect(page.getByText('No answer key supplied. This question is ungraded.')).toBeVisible();
  await shot('real-practice', true);
  await page.getByRole('button', { name: 'Submit attempt', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Keep answering' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Submit attempt', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Submit attempt', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm submit' }).click();
  await expect(page.getByText(/1 attempted · 4 unanswered/)).toBeVisible();

  // Exam: 10 questions, 2 minutes.
  await page.getByRole('link', { name: 'Practice', exact: true }).click();
  await page.getByLabel('Mode', { exact: true }).selectOption('exam');
  await page.getByLabel('Question count').fill('10');
  await page.getByLabel('Duration (minutes)').fill('2');
  await page.getByRole('button', { name: 'Read exam instructions' }).click();
  await page.getByRole('button', { name: 'Start exam', exact: true }).click();
  await expect(page.getByRole('timer')).toContainText(/0[12]:\d\d/);
  await page.getByRole('radio').nth(2).check();
  await page.getByRole('button', { name: 'Mark for later' }).click();

  // Navigator reachable on every viewport; on mobile it is a drawer that Escape closes.
  const toggle = page.getByRole('button', { name: /^Questions \(\d+\/10\)$/ });
  if (await toggle.isVisible()) {
    await toggle.click();
    await expect(page.getByRole('button', { name: 'Close navigator' })).toBeFocused();
    await shot('real-exam-drawer');
    await page.keyboard.press('Escape');
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
  }
  await page.getByRole('button', { name: 'Question 1, answered, marked' }).focus();
  await page.getByRole('button', { name: 'Question 4, unanswered' }).click();
  await expect(page.getByRole('heading', { name: 'Question 4 of 10' })).toBeFocused();
  await page.getByRole('radio').first().check();
  await shot('real-exam', true);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Question 4 of 10' })).toBeVisible();
  await expect(page.getByRole('radio').first()).toBeChecked();

  // WCAG 1.4.10 reflow: 320 CSS px (≈ 400% zoom of a 1280px window) must not scroll sideways.
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: 320, height: 640 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await expect(page.getByRole('button', { name: 'Submit attempt', exact: true })).toBeInViewport();
  await shot('real-exam-320px');
  await page.evaluate(() => window.scrollTo(0, 600));
  const submit = page.getByRole('button', { name: 'Submit attempt', exact: true });
  await expect(submit).toBeInViewport();
  expect(await submit.evaluate(el => {
    const box = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  })).toBe(true);
  await page.setViewportSize(size);

  await page.getByRole('button', { name: 'Submit attempt', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm submit' }).click();
  await expect(page.getByRole('heading', { name: 'Your results' })).toBeVisible();
  await expect(page.getByText(/2 attempted · 8 unanswered/)).toBeVisible();
  await expect(page.getByText(/Ungraded/).first()).toBeVisible();
  await shot('real-results', true);
});
