import { test, expect, request, type APIRequestContext, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const API = 'http://127.0.0.1:8791';
const ROOT = resolve('..');
const SHOTS = join(ROOT, 'screenshots/turn4');
const SHOTS5 = join(ROOT, 'screenshots/turn5');
const SHOTS6 = join(ROOT, 'screenshots/turn6');
let folder: string;
let server: ChildProcess;
let owner: APIRequestContext;
let csrf: string;

async function start() {
  server = spawn(resolve('../backend/.venv/bin/python'), ['tests/student_browser_server.py'], {
    cwd: resolve('../backend'),
    env: { ...process.env, PI_DATA_DIR: folder, PI_ALLOWED_ORIGINS: 'http://127.0.0.1:4317', PI_STUDENT_BROWSER_TEST: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let diagnostics = '';
  server.stderr!.on('data', data => { diagnostics += data.toString(); });
  await expect.poll(async () => {
    if (server.exitCode !== null) throw new Error(`backend exited: ${diagnostics}`);
    try { return (await owner.get(`${API}/api/v1/health`, { timeout: 1000 })).ok(); } catch { return false; }
  }, { timeout: 20000 }).toBe(true);
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise<void>(done => server.once('exit', () => done()));
  server.kill('SIGKILL'); // real process loss; same SQLite files used on restart
  await exited;
}
test.beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), 'pi-student-browser-'));
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(SHOTS5, { recursive: true });
  mkdirSync(SHOTS6, { recursive: true });
  owner = await request.newContext();
  await start();
  const login = await owner.post(`${API}/api/admin/login`, { data: { username: 'browser-owner', password: 'disposable-browser-password' } });
  expect(login.status()).toBe(200);
  csrf = (await login.json()).csrf_token;
});
test.afterAll(async () => { await stop(); await owner?.dispose(); rmSync(folder, { recursive: true, force: true }); });

async function admin(path: string, data: unknown) {
  const res = await owner.post(`${API}/api/admin/${path}`, { data, headers: { 'X-CSRF-Token': csrf } });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}
async function paper(mode: 'cohort' | 'independent', extra: Record<string, unknown> = {}) {
  // OCR imports must pass through explicit human correction/review/key verification.
  const candidates = Array.from({ length: 4 }, (_, i) => ({
    stem_en: `Synthetic OCR corrected item ${i + 1}: choose the first option.`,
    stem_hi: `संशोधित प्रश्न ${i + 1}: पहला विकल्प चुनिए।`,
    origin: 'ocr', status: 'needs-review', key_verified: false,
    options: [{ key: 'A', en: 'First', hi: 'पहला' }, { key: 'B', en: 'Second', hi: 'दूसरा' }],
    ...(i === 0 ? { explanation_en: 'The stem asks for the first option, which is A.', explanation_hi: 'प्रश्न पहला विकल्प माँगता है, इसलिए उत्तर A है।' } : {}),
  }));
  const imported = await admin('questions', candidates);
  for (const [index, id] of imported.ids.entries()) {
    const res = await owner.patch(`${API}/api/admin/questions/${id}`, {
      headers: { 'X-CSRF-Token': csrf }, data: { ...candidates[index], version: 1, status: 'reviewed', answer_key: 'A', key_verified: true },
    });
    expect(res.ok(), await res.text()).toBe(true);
  }
  const time = (await (await owner.get(`${API}/api/v1/time`)).json()).server_now;
  const exam = await admin('exams', { title: `Synthetic ${mode} journey`, mode, question_ids: imported.ids,
    opens_at: time + (mode === 'cohort' ? 6000 : -1000), closes_at: time + 180000,
    duration_s: mode === 'cohort' ? 30 : 90, late_join_s: 120, ...extra });
  await admin(`exams/${exam.id}/publish`, {});
  return exam;
}
async function enroll(page: Page, code: string, alias: string) {
  await page.goto(`./#/join/${code}`);
  await page.getByLabel('Your display name').fill(alias);
  const response = page.waitForResponse(r => r.url().endsWith(`/exams/${code}/join`) && r.request().method() === 'POST');
  await page.getByRole('button', { name: /Start exam|Join the lobby/ }).click();
  return (await response).json();
}
async function state(j: { attempt_id: string; token: string }) {
  return (await owner.get(`${API}/api/v1/attempts/${j.attempt_id}`, { headers: { Authorization: `Bearer ${j.token}` } })).json();
}

test('two cohort browsers: lobby, isolated saves, offline acknowledgement, extension, process restart, early/timeout submit and release', async ({ browser }, info) => {
  const errors: string[] = [];
  const contextA = await browser.newContext(info.project.use);
  const contextB = await browser.newContext(info.project.use);
  try {
    const a = await contextA.newPage(), b = await contextB.newPage();
    for (const p of [a, b]) p.on('pageerror', e => errors.push(e.message));
    await a.addInitScript(() => { const realNow = Date.now; Date.now = () => realNow() + 90000; });
    const exam = await paper('cohort');
    const [ja, jb] = await Promise.all([enroll(a, exam.code, 'Asha'), enroll(b, exam.code, 'Kabir')]);
    expect(ja.deadline_at).toBe(jb.deadline_at);
    await expect(a.getByRole('heading', { name: 'Waiting for the exam to start' })).toBeFocused();
    await expect(a.locator('.timer-big')).toHaveAttribute('aria-live', 'off');
    await a.screenshot({ path: join(SHOTS6, `lobby-${info.project.name}.png`), fullPage: true });
    expect((await state(ja)).questions).toEqual([]);
    await expect(a.getByRole('radio').first()).toBeVisible({ timeout: 15000 });
    await expect(b.getByRole('radio').first()).toBeVisible({ timeout: 15000 });
    await expect(a.getByRole('heading', { name: exam.title ?? 'Synthetic cohort journey', exact: true })).toBeFocused();
    const initial = await state(ja);
    expect(JSON.stringify(initial)).not.toMatch(/answer_key|explanation|bank_id/);
    expect((await owner.get(`${API}/api/v1/attempts/${jb.attempt_id}`, { headers: { Authorization: `Bearer ${ja.token}` } })).status()).toBe(404);
    expect((await a.request.get(`${API}/api/admin/exams`)).status()).toBe(401);
    await a.getByRole('button', { name: 'हिन्दी', exact: true }).click();
    await expect(a.locator('.q-stem')).toContainText('पहला विकल्प');
    await a.getByRole('radio').first().check();
    await a.getByLabel('Mark for review', { exact: true }).check();
    await expect(a.getByText('All answers saved ✓', { exact: true })).toBeVisible();
    expect((await state(jb)).answers).toEqual({});
    await a.screenshot({ path: join(SHOTS, `cohort-hindi-${info.project.name}.png`), fullPage: true });
    await a.reload();
    await expect(a.getByRole('radio').first()).toBeChecked();
    await expect(a.getByLabel('Mark for review', { exact: true })).toBeChecked();

    await contextB.setOffline(true);
    await b.getByRole('radio').first().check();
    await expect(b.getByText('1 change not yet saved', { exact: true })).toBeVisible();
    await expect(b.getByRole('alert')).toContainText('Not saved yet');
    expect((await state(jb)).answers).toEqual({});
    await b.screenshot({ path: join(SHOTS, `cohort-pending-${info.project.name}.png`), fullPage: true });
    await b.getByRole('button', { name: 'Submit exam…', exact: true }).click();
    await b.getByRole('button', { name: 'Submit exam', exact: true }).click();
    await expect(b.getByRole('alert')).toContainText('NOT submitted yet');
    expect((await state(jb)).status).toBe('active');
    await contextB.setOffline(false);
    await expect(b.getByText('All answers saved ✓', { exact: true })).toBeVisible({ timeout: 12000 });
    expect((await state(jb)).answers.q1.choice).toBe('A');

    const beforeExtension = Number((await b.locator('.timer').innerText()).split(':')[1]);
    await admin(`exams/${exam.id}/extend`, { seconds: 12 });
    await expect.poll(async () => (await state(jb)).deadline_at).toBe(jb.deadline_at + 12000);
    // UI discovers extension without a reload or another edit.
    await expect.poll(async () => Number((await b.locator('.timer').innerText()).split(':')[1]), { timeout: 8000 }).toBeGreaterThan(beforeExtension + 5);
    await stop();
    await a.getByRole('button', { name: 'Question 2, not answered', exact: true }).click();
    await a.getByRole('radio').first().check();
    await expect(a.getByRole('alert')).toContainText('Not saved yet');
    await a.reload();
    await expect(a.getByText('The server is unavailable. Your saved attempt stays here; we will reconnect automatically.')).toBeVisible();
    await start();
    await expect(a.getByText('All answers saved ✓', { exact: true })).toBeVisible({ timeout: 12000 });
    expect((await state(ja)).deadline_at).toBe(ja.deadline_at + 12000);
    expect((await state(ja)).answers.q2.choice).toBe('A');
    await a.getByRole('button', { name: 'Submit exam…', exact: true }).click();
    await expect(a.getByRole('button', { name: 'Keep working' })).toBeFocused();
    await a.keyboard.press('Escape');
    await expect(a.getByRole('dialog')).not.toBeVisible();
    await a.getByRole('button', { name: 'Submit exam…', exact: true }).click();
    await a.getByRole('button', { name: 'Submit exam', exact: true }).click();
    await expect(a.getByRole('heading', { name: 'Submitted', exact: true })).toBeVisible();
    await expect(a.getByText(/Results will appear/)).toBeVisible();
    // Silent browser: offline with unacknowledged edit, no timeout callback reaches API.
    await contextB.setOffline(true);
    await b.getByRole('button', { name: 'Question 2, not answered', exact: true }).click();
    await b.getByRole('radio').first().check();
    await expect(b.getByText('1 change not yet saved', { exact: true })).toBeVisible();
    await expect.poll(async () => {
      const r = await owner.get(`${API}/api/admin/exams/${exam.id}/attempts`);
      return (await r.json()).attempts.find((v: { id: string }) => v.id === jb.attempt_id).status;
    }, { timeout: 65000, intervals: [1000] }).toBe('expired');
    await contextB.setOffline(false);
    await b.reload();
    await expect(b.getByRole('heading', { name: /Time is up/ })).toBeVisible();
    await expect(b.getByRole('alert')).toContainText('never reached the server');
    await admin(`exams/${exam.id}/release`, { scores: true, answers: true });
    await a.getByRole('button', { name: 'Check for results' }).click();
    await b.getByRole('button', { name: 'Check for results' }).click();
    await expect(a.getByText('2 correct · 0 wrong · 2 unanswered of 4', { exact: true })).toBeVisible();
    await expect(b.getByText('1 correct · 0 wrong · 3 unanswered of 4', { exact: true })).toBeVisible();
    // Released answer review: assigned questions only, outcome in words, explanation or explicit absence.
    const review = b.getByRole('region', { name: 'Review answers' });
    await expect(review.getByRole('listitem').filter({ has: b.locator('.review-card') })).toHaveCount(4);
    await expect(review.getByRole('button', { name: 'Not answered (3)' })).toBeVisible();
    await expect(review.locator('.review-card').first()).toContainText('Correct');
    await expect(review.locator('.review-card').first()).toContainText('The stem asks for the first option');
    await expect(review.locator('.review-card').nth(1)).toContainText('You did not answer this question.');
    await expect(review.locator('.review-card').nth(1)).toContainText('No explanation was provided');
    await review.getByRole('button', { name: 'Not answered (3)' }).click();
    await expect(review.locator('.review-card')).toHaveCount(3);
    await review.getByRole('button', { name: 'हिन्दी', exact: true }).click();
    await review.getByRole('button', { name: 'All (4)' }).click();
    await expect(review.locator('.review-card').first()).toContainText('प्रश्न पहला विकल्प माँगता है');
    await review.getByRole('button', { name: 'Both', exact: true }).click();
    expect(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await b.screenshot({ path: join(SHOTS5, `cohort-review-${info.project.name}.png`), fullPage: true });
    const persisted = (await (await owner.get(`${API}/api/admin/exams/${exam.id}/attempts`)).json()).attempts;
    expect(persisted.map((v: { status: string }) => v.status).sort()).toEqual(['expired', 'submitted']);
    await b.screenshot({ path: join(SHOTS, `cohort-results-${info.project.name}.png`), fullPage: true });
    expect(errors).toEqual([]);
  } finally { await contextA.close(); await contextB.close(); }
});

test('independent browsers: per-student deadlines, stable subsets, authenticated reattempt and limit', async ({ browser }, info) => {
  const ca = await browser.newContext(info.project.use), cb = await browser.newContext(info.project.use);
  try {
    const a = await ca.newPage(), b = await cb.newPage();
    const exam = await paper('independent', { max_attempts: 2, subset_count: 2, subset_seed: 'journey-4', shuffle: 'per-attempt' });
    const ja = await enroll(a, exam.code, 'Asha independent');
    await expect(a.getByRole('radio').first()).toBeVisible();
    const jb = await enroll(b, exam.code, 'Kabir independent');
    expect(jb.started_at).toBeGreaterThan(ja.started_at);
    expect(jb.deadline_at - jb.started_at).toBe(90000);
    const initial = await state(ja);
    expect(initial.questions).toHaveLength(2);
    await a.reload();
    expect((await state(ja)).questions).toEqual(initial.questions);
    await a.getByRole('button', { name: 'Both', exact: true }).click();
    await a.getByRole('radio').first().check();
    await a.getByRole('button', { name: 'Next →', exact: true }).click();
    await a.getByRole('radio').first().check();
    await a.screenshot({ path: join(SHOTS, `independent-bilingual-${info.project.name}.png`), fullPage: true });
    expect(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await a.getByRole('button', { name: 'Submit exam…', exact: true }).click();
    await a.getByRole('button', { name: 'Submit exam', exact: true }).click();
    await expect(a.getByRole('heading', { name: 'Submitted', exact: true })).toBeVisible();
    await admin(`exams/${exam.id}/release`, { scores: true });
    await a.getByRole('button', { name: 'Check for results' }).click();
    await expect(a.getByText('2 correct · 0 wrong · 0 unanswered of 2', { exact: true })).toBeVisible();
    const nextResponse = a.waitForResponse(r => r.url().endsWith('/reattempt'));
    await a.getByRole('button', { name: 'Try again · attempt 2 of 2' }).click();
    const second = await (await nextResponse).json();
    await expect(a.getByRole('radio').first()).toBeVisible();
    expect((await state(second)).attempt_number).toBe(2);
    expect((await state(second)).answers).toEqual({});
    expect((await state(jb)).status).toBe('active');
    await a.getByRole('button', { name: 'Submit exam…', exact: true }).click();
    await a.getByRole('button', { name: 'Submit exam', exact: true }).click();
    await expect(a.getByRole('heading', { name: 'Submitted', exact: true })).toBeVisible();
    await expect(a.getByRole('button', { name: /Try again/ })).toHaveCount(0);
    expect((await owner.post(`${API}/api/v1/attempts/${second.attempt_id}/reattempt`, { data: {}, headers: { Authorization: `Bearer ${second.token}` } })).status()).toBe(409);
  } finally { await ca.close(); await cb.close(); }
});

test('320px keyboard-only journey: join, answer, submit, released review without horizontal scroll', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'one 320px CSS-pixel run covers both projects');
  const context = await browser.newContext({ viewport: { width: 320, height: 640 } });
  const errors: string[] = [];
  const noOverflow = async (p: Page) => expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  try {
    const p = await context.newPage();
    p.on('pageerror', e => errors.push(e.message));
    const exam = await paper('independent', { subset_count: 2, subset_seed: 'reflow-5' });
    await p.goto(`./#/join/${exam.code}`);
    await expect(p.getByLabel('Your display name')).toBeVisible();
    await p.screenshot({ path: join(SHOTS6, 'join-320.png'), fullPage: true });
    await noOverflow(p);
    await p.getByLabel('Your display name').focus();
    await p.keyboard.type('Meera 320');
    const joined = p.waitForResponse(r => r.url().endsWith('/join') && r.request().method() === 'POST');
    await p.keyboard.press('Enter');
    const j = await (await joined).json();
    await expect(p.getByRole('radio').first()).toBeVisible();
    await noOverflow(p);
    // Radios: focus the group, Space selects; the selection must be visible and saved.
    await p.getByRole('radio').first().focus();
    await p.keyboard.press('Space');
    await expect(p.getByRole('radio').first()).toBeChecked();
    await expect(p.locator('.option:focus-within')).toHaveCount(1);
    await p.getByRole('button', { name: 'Next →' }).focus();
    await p.keyboard.press('Enter');
    await p.getByRole('radio').nth(1).focus();
    await p.keyboard.press('Space');
    await expect(p.getByText('All answers saved ✓', { exact: true })).toBeVisible();
    await noOverflow(p);
    await p.screenshot({ path: join(SHOTS5, 'exam-320.png'), fullPage: true });
    await p.getByRole('button', { name: 'Review & submit' }).focus();
    await p.keyboard.press('Enter');
    await expect(p.getByRole('button', { name: 'Keep working' })).toBeFocused();
    await p.keyboard.press('Tab');
    await expect(p.getByRole('button', { name: 'Submit exam', exact: true })).toBeFocused();
    await p.keyboard.press('Enter');
    await expect(p.getByRole('heading', { name: 'Submitted', exact: true })).toBeFocused();
    await p.screenshot({ path: join(SHOTS6, 'finished-320.png'), fullPage: true });
    await admin(`exams/${exam.id}/release`, { answers: true });
    await p.getByRole('button', { name: 'Check for results' }).focus();
    await p.keyboard.press('Enter');
    await expect(p.getByText('Scores are not released yet.')).toBeVisible();
    const review = p.getByRole('region', { name: 'Review answers' });
    await expect(review.locator('.review-card')).toHaveCount(2);
    await expect(review.getByText('Wrong', { exact: false }).first()).toBeVisible();
    await expect(review.getByText('Your answer').first()).toBeVisible();
    await expect(review.getByText('✓ Correct answer')).toHaveCount(2);
    await review.getByRole('button', { name: /^Wrong \(1\)$/ }).focus();
    await p.keyboard.press('Enter');
    await expect(review.locator('.review-card')).toHaveCount(1);
    await expect(p.getByRole('status').filter({ hasText: 'Showing 1 of 2 questions' })).toBeAttached();
    expect(JSON.stringify(await state(j))).not.toMatch(/answer_key/);
    await noOverflow(p);
    await p.screenshot({ path: join(SHOTS5, 'review-320.png'), fullPage: true });
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('Pages subpath assets and real browser allowed/disallowed CORS', async ({ browser }, info) => {
  const context = await browser.newContext(info.project.use);
  const page = await context.newPage();
  try {
    await page.goto('./');
    const assets = [
      'pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap', 'pdfjs/wasm/openjpeg.wasm', 'tesseract/worker.min.js',
      'tesseract/tesseract-core-lstm.wasm.js',
      'tesseract/lang-data/eng.traineddata.gz', 'tesseract/lang-data/hin.traineddata.gz',
    ];
    // Resolve against the repository base; never accept a Vite HTML fallback as an asset.
    for (const asset of assets) {
      const response = await page.request.get(`/practice-institute/${asset}`);
      expect(response.ok(), asset).toBe(true);
      expect(response.headers()['content-type'], asset).not.toContain('text/html');
      expect((await response.body()).byteLength, asset).toBeGreaterThan(1000);
    }
    const exam = await paper('independent');
    const allowed = await page.evaluate(async ({ api, code }) => {
      const joined = await fetch(`${api}/api/v1/exams/${code}/join`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alias: 'Browser CORS allowed' }),
      });
      const j = await joined.json();
      const saved = await fetch(`${api}/api/v1/attempts/${j.attempt_id}/answers`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${j.token}` },
        body: JSON.stringify({ changes: [{ qid: 'q1', choice: 'A', seq: 1 }] }),
      });
      const result = await saved.json();
      return { joined: joined.status, saved: saved.status, ack: result.acked };
    }, { api: API, code: exam.code });
    expect(allowed).toEqual({ joined: 201, saved: 200, ack: { q1: 1 } });
    // Same static build, different browser origin. CSP still permits the configured API;
    // the backend's CORS allowlist must reject this origin's JSON POST preflight.
    await page.goto('http://localhost:4317/practice-institute/');
    const denied = await page.evaluate(async ({ api, code }) => {
      const outcomes = [];
      for (const [path, init] of [
        ['/api/v1/health', {}],
        [`/api/v1/exams/${code}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alias: 'Browser CORS denied' }) }],
      ] as const) {
        try { await fetch(api + path, init); outcomes.push('readable'); }
        catch { outcomes.push('blocked'); }
      }
      return outcomes;
    }, { api: API, code: exam.code });
    expect(denied).toEqual(['blocked', 'blocked']);
    const attempts = await owner.get(`${API}/api/admin/exams/${exam.id}/attempts`);
    expect((await attempts.json()).attempts.map((a: { alias: string }) => a.alias)).toEqual(['Browser CORS allowed']);
    const crossAdmin = await owner.get(`${API}/api/admin/me`, { headers: { Origin: 'http://127.0.0.1:4317' } });
    expect(crossAdmin.status()).toBe(403);
  } finally { await context.close(); }
});
