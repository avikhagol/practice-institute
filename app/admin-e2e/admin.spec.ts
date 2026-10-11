import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

async function login(page: import('@playwright/test').Page) {
  await page.goto('./');
  await page.getByLabel('Username', {exact:true}).fill('browser-owner');
  await page.getByLabel('Password', {exact:true}).fill('disposable-browser-password');
  await page.getByRole('button', {name:'Sign in', exact:true}).click();
  await expect(page.getByRole('heading', {name:'Dashboard', exact:true})).toBeVisible();
}

test('owner uploads, reviews bilingual text, publishes and inspects attempts', async ({page},info)=>{
  test.skip(info.project.name!=='desktop','full workflow runs once against the shared disposable server');
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await login(page);
  await page.getByRole('button',{name:'Sources',exact:true}).click();
  await page.getByLabel('Original PDF', {exact:true}).setInputFiles(resolve('public/demo/pdf-smart-synthetic-demo.pdf'));
  await page.getByLabel('Source label').fill('Browser synthetic source');
  await page.getByLabel('Year',{exact:true}).fill('2026');
  await page.getByLabel('Subject',{exact:true}).fill('Learning');
  await page.getByLabel('Provenance / licence / consent note').fill('Original synthetic fixture created for this project. Permission granted.');
  await page.getByLabel('I have permission').check();
  await page.getByLabel('This is a synthetic').check();
  await page.getByRole('button',{name:'Upload & extract text'}).click();
  await expect(page.getByText(/12 question candidates imported as needs review/)).toBeVisible({timeout:60000});
  await page.getByRole('button',{name:'Question bank',exact:true}).click();
  const sources = (await (await page.request.get('/api/admin/sources')).json()).sources;
  const source = sources.find((s: { label: string }) => s.label === 'Browser synthetic source');
  const candidates = (await (await page.request.get(`/api/admin/questions?source_id=${source.id}`)).json()).questions;
  const candidate = candidates.find((q: { source_number: number }) => q.source_number === 1);
  await page.getByRole('button',{name:`Review question ${candidate.id}`,exact:true}).click();
  await page.getByLabel('Hindi stem', {exact:true}).fill('कौन सा विकल्प सही है?');
  for(const [key,text] of Object.entries({A:'पहला विकल्प',B:'दूसरा विकल्प',C:'तीसरा विकल्प',D:'चौथा विकल्प'})) await page.getByLabel(`Hindi option ${key}`,{exact:true}).fill(text);
  await page.getByLabel('Correct option key').selectOption('A');
  await page.getByLabel('I verified this answer').check();
  await page.getByLabel('Review status').selectOption('reviewed');
  await expect(page.getByRole('button',{name:'Save question',exact:true})).toBeDisabled();
  await page.getByLabel('I checked the text').check();
  await expect(page.getByRole('img',{name:/Original source page \d+/})).toBeVisible();
  await page.getByRole('button',{name:'Crop & OCR correction',exact:true}).click();
  await expect(page.getByText('Crop selection',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Top half',exact:true}).click();
  await expect(page.getByText('Crop preview',{exact:true})).toBeVisible();
  await page.screenshot({path:'../screenshots/turn3/admin-crop-review-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'Close crop mode',exact:true}).click();
  await page.screenshot({path:'../screenshots/turn2/admin-review-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'Save question',exact:true}).click();
  await expect(page.getByText('Question saved.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Exams',exact:true}).click();
  await page.getByLabel('Sample count').fill('1');
  await page.getByRole('button',{name:'Sample matching bank'}).click();
  await expect(page.getByText('Selected 1 questions with seed practice-1.')).toBeVisible();
  await page.getByLabel('Exam title').fill('Browser bilingual exam');
  await page.getByRole('button',{name:'Create draft · 1 questions'}).click();
  await expect(page.getByText(/Draft .* created/)).toBeVisible();
  const examRow = page.locator('.exam-row').filter({hasText:'Browser bilingual exam'});
  await examRow.getByRole('button',{name:'Publish paper'}).click();
  await expect(page.getByText(/Published .* Share this join code/)).toBeVisible();
  const code=(await examRow.locator('.code').innerText()).trim();
  const joined=await page.request.post(`http://127.0.0.1:8789/api/v1/exams/${code}/join`,{data:{alias:'Browser student'}});
  expect(joined.status()).toBe(201);
  const attempt=await joined.json();
  const state=await page.request.get(`http://127.0.0.1:8789/api/v1/attempts/${attempt.attempt_id}`,{headers:{Authorization:`Bearer ${attempt.token}`}});
  expect((await state.json()).questions[0].stem.hi).toBe('कौन सा विकल्प सही है?');
  await examRow.getByRole('button',{name:'View attempts'}).click();
  await expect(page.getByRole('cell',{name:'Browser student',exact:true})).toBeVisible();
  await page.getByLabel('Release scores').check();
  await expect(page.getByText('Scores released.',{exact:true})).toBeVisible();
  await page.screenshot({path:'../screenshots/turn2/admin-results-desktop.png',fullPage:true});
  await page.reload();
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Sign out'}).click();
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});

test('admin desk remains usable on narrow and wide screens',async({page},info)=>{
  await login(page);
  await page.getByRole('button',{name:'Question bank',exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  await page.screenshot({path:`../screenshots/turn2/admin-bank-${info.project.name}.png`,fullPage:true});
  await page.getByRole('button',{name:'Add manual question'}).click();
  await expect(page.getByLabel('English stem',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Hindi stem',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
});


test('bulk review respects filters, preserves keys and recovers from a partial failure', async ({ page }, info) => {
  await login(page);
  const session = await (await page.request.get('/api/admin/me')).json();
  const prefix = `Bulk review ${info.project.name}`;
  const response = await page.request.post('/api/admin/questions', {
    headers: { 'X-CSRF-Token': session.csrf_token },
    data: [1, 2, 3].map(n => ({
      stem_en: `${prefix} question ${n}`, options: [{ key: 'A', en: 'One' }, { key: 'B', en: 'Two' }],
      answer_key: n === 1 ? 'A' : null, key_verified: n === 1,
      status: n === 3 ? 'excluded' : 'needs-review',
    })),
  });
  expect(response.status()).toBe(201);
  const { ids } = await response.json();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText('Up to date.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Question bank', exact: true }).click();
  await page.getByLabel('Search bank').fill(prefix);
  await page.getByLabel('Status', { exact: true }).selectOption('needs-review');
  const selectAll = page.getByRole('checkbox', { name: 'Select all matching questions', exact: true });
  await page.getByRole('checkbox', { name: `Select question ${ids[0]}`, exact: true }).check();
  await expect(selectAll).toHaveJSProperty('indeterminate', true);
  await selectAll.check();
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
  const apply = page.getByRole('button', { name: 'Apply to selected', exact: true });
  await expect(apply).toBeDisabled();
  await page.getByLabel('I checked the text, option pairing, and warnings for all selected').check();
  await apply.click();
  await expect(page.getByText('2 questions marked reviewed.', { exact: false })).toBeVisible();
  const bank = (await (await page.request.get('/api/admin/questions')).json()).questions;
  expect(bank.find((q: { id: number }) => q.id === ids[0])).toMatchObject({ status: 'reviewed', answer_key: 'A', key_verified: 1, version: 2 });
  expect(bank.find((q: { id: number }) => q.id === ids[1])).toMatchObject({ status: 'reviewed', answer_key: null, key_verified: 0, version: 2 });
  expect(bank.find((q: { id: number }) => q.id === ids[2])).toMatchObject({ status: 'excluded', version: 1 });
  await page.getByLabel('Status', { exact: true }).selectOption('reviewed');
  await selectAll.check();
  await page.getByLabel('Search bank').fill(`${prefix} question 1`);
  await expect(page.getByText('0 selected', { exact: true })).toBeVisible();
  await page.getByLabel('Search bank').fill(prefix);
  await selectAll.check();
  await page.getByLabel('Bulk action').selectOption('needs-review');
  await page.route(`**/api/admin/questions/${ids[1]}`, route => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ detail: 'question changed; reload before editing' }) }));
  await apply.click();
  await expect(page.getByRole('alert')).toContainText('1 of 2 questions updated. Remaining questions are still selected.');
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
  await page.unroute(`**/api/admin/questions/${ids[1]}`);
  await apply.click();
  await expect(page.getByText('1 question marked needs review.', { exact: false })).toBeVisible();
  await page.getByLabel('Status', { exact: true }).selectOption('');
  await selectAll.check();
  await page.getByLabel('Bulk action').selectOption('excluded');
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: `../screenshots/bulk-review-${info.project.name}.png`, fullPage: true });
  await apply.click();
  await expect(page.getByText('3 questions marked excluded.', { exact: false })).toBeVisible();
});
