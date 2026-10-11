import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const SHOTS = join(import.meta.dirname, '../../screenshots/turn5');
mkdirSync(SHOTS, { recursive: true });

async function fits(page: Page) {
  await expect.poll(() => page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))).toMatchObject({ overflow: 0 });
  for (const link of await page.locator('.nav a').all()) {
    // The narrow header scrolls normally; check horizontal bounds even below the fold.
    const box = (await link.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
}

test('320px reflow keeps populated Library, metadata and Review editors within the viewport', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('./#/local');
  await page.getByRole('button', { name: 'Try the example paper' }).click();
  await expect(page.getByText(/Done · 12 question candidates/)).toBeVisible();
  await fits(page);
  await page.screenshot({ path: join(SHOTS, `library-320-${info.project.name}.png`), fullPage: true });
  await page.getByRole('button', { name: 'Edit label and year' }).click();
  await fits(page);
  await page.getByRole('button', { name: 'Save source' }).click();
  await page.getByRole('link', { name: 'Questions (12)' }).click();
  await fits(page);
  await page.getByRole('button', { name: /^Needs review/ }).click();
  await expect(page.locator('.q-card')).toHaveCount(1);
  await page.locator('.q-card').first().getByRole('button', { name: 'Edit question', exact: true }).click();
  await fits(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(SHOTS, `review-editor-320-${info.project.name}.png`), fullPage: true });
});

test('200% text enlargement keeps Library, Review and practice controls usable', async ({ page }, info) => {
  // Automated text-size stress check; real browser text-only zoom/AT still needs manual validation.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('./#/local');
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  await page.getByRole('button', { name: 'Try the example paper' }).click();
  await expect(page.getByText(/Done · 12 question candidates/)).toBeVisible();
  await fits(page);
  await page.getByRole('link', { name: 'Questions (12)' }).click();
  await fits(page);
  await page.getByRole('link', { name: 'Set up practice', exact: true }).click();
  await page.getByLabel('Question count').fill('2');
  await page.getByRole('button', { name: 'Start practice' }).click();
  await fits(page);
  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Submit attempt', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Keep answering' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Submit attempt', exact: true })).toBeFocused();
  await page.screenshot({ path: join(SHOTS, `practice-text-200-${info.project.name}.png`), fullPage: true });
});
