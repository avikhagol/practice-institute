// Turn 5 packaged acceptance: the BUILT runtime (bundled CPython + packaged admin) launched exactly
// as the Electron launcher does (PACKAGING.md §2), one owner browser and two isolated student
// browsers. Disposable synthetic data only; never the owner's profile.
import { test, expect, request, type APIRequestContext, type Page } from '@playwright/test';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import http from 'node:http';

const RUNTIME = resolve(process.env.PI_PACKAGED_ROOT ?? '../release/linux-unpacked/resources/runtime');
const PYTHON = join(RUNTIME, 'python/bin/python3');
const OWNER_PORT = 8797, PUBLIC_PORT = 8798;
const OWNER = `http://127.0.0.1:${OWNER_PORT}`, PUBLIC = `http://127.0.0.1:${PUBLIC_PORT}`;
const USER = 'packaged-owner', PASSWORD = 'disposable pässword ✓ 2026';
const SHOTS = resolve('../screenshots/packaged');
let parent: string, dataDir: string, backups: string;
let runtime: ChildProcessWithoutNullStreams | undefined;
let api: APIRequestContext;
let joinLimit = '20';

function env() {
  // Same allowlist as desktop/src/main/runtime.ts runtimeEnv().
  return { HOME: process.env.HOME ?? '', LANG: process.env.LANG ?? 'C.UTF-8', PATH: '/usr/bin:/bin', PI_DATA_DIR: dataDir,
    PI_ADMIN_DIST: join(RUNTIME, 'admin'), PI_ALLOWED_ORIGINS: 'http://127.0.0.1:4327', PI_COOKIE_SECURE: 'false',
    PI_TRUST_PROXY_HEADERS: 'false', PI_JOIN_RATE_PER_MIN: joinLimit, PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1' };
}
function cli(args: string[], input = '') {
  const r = spawnSync(PYTHON, ['-I', '-B', '-X', 'utf8', '-m', 'practice_institute.cli', ...args], { cwd: RUNTIME, env: env(), input, encoding: 'utf8', timeout: 60000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
function serve() {
  const child = spawn(PYTHON, ['-I', '-B', '-X', 'utf8', '-m', 'practice_institute.cli', 'serve-desktop', '--stdin-control',
    '--owner-port', String(OWNER_PORT), '--public-port', String(PUBLIC_PORT)], { cwd: RUNTIME, env: env(), stdio: 'pipe' });
  const events: Record<string, unknown>[] = [];
  let stderr = '';
  child.stderr.on('data', d => { stderr += d.toString(); });
  createInterface({ input: child.stdout }).on('line', line => { try { events.push(JSON.parse(line)); } catch { events.push({ raw: line }); } });
  const exited = new Promise<number | null>(done => child.once('exit', code => done(code)));
  return { child, events, exited, stderr: () => stderr };
}
let current: ReturnType<typeof serve> | undefined;
async function start() {
  current = serve();
  runtime = current.child;
  const c = current;
  await expect.poll(() => {
    if (c.child.exitCode !== null) throw new Error(`runtime exited ${c.child.exitCode}: ${JSON.stringify(c.events)} ${c.stderr()}`);
    return c.events.find(e => e.event === 'ready');
  }, { timeout: 30000 }).toMatchObject({ owner_url: OWNER, public_url: PUBLIC });
  // Launcher "probing" self-check (PACKAGING.md §2).
  expect((await api.get(`${OWNER}/api/v1/health`)).status()).toBe(200);
  expect((await api.get(`${PUBLIC}/api/v1/health`)).status()).toBe(200);
  expect((await api.get(`${PUBLIC}/api/admin/me`)).status()).toBe(404);
}
async function stop() {
  if (!current || current.child.exitCode !== null) return;
  current.child.stdin.write('stop\n');
  expect(await current.exited).toBe(0);
  expect(current.events.map(e => e.event)).toEqual(['ready', 'stopping', 'stopped']);
}

test.beforeAll(async () => {
  expect(existsSync(PYTHON), `packaged runtime missing: ${PYTHON}`).toBe(true);
  parent = mkdtempSync(join(tmpdir(), 'pi-packaged-'));
  dataDir = join(parent, 'Owner data Παράδειγμα');
  backups = join(parent, 'backups ü');
  api = await request.newContext();
  expect(JSON.parse(cli(['owner-status']).stdout).owner_exists).toBe(false);
  const created = cli(['setup-owner', '--stdin-json'], JSON.stringify({ username: USER, password: PASSWORD, confirm: PASSWORD }) + '\n');
  expect(JSON.parse(created.stdout)).toMatchObject({ ok: true, code: 'created' });
  expect(created.stdout + created.stderr).not.toContain(PASSWORD);
  await start();
});
test.afterAll(async () => {
  if (current && current.child.exitCode === null) { current.child.stdin.write('stop\n'); await current.exited; }
  await api?.dispose();
  if (parent) rmSync(parent, { recursive: true, force: true });
});

async function login(page: Page) {
  await page.goto(`${OWNER}/admin/`);
  await page.getByLabel('Username', { exact: true }).fill(USER);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
}
async function csrf(page: Page) { return (await (await page.request.get(`${OWNER}/api/admin/me`)).json()).csrf_token as string; }
async function enroll(page: Page, code: string, alias: string) {
  await page.goto(`./#/join/${code}`);
  await page.getByLabel('Your display name').fill(alias);
  const response = page.waitForResponse(r => r.url() === `${PUBLIC}/api/v1/exams/${code}/join` && r.request().method() === 'POST');
  await page.getByRole('button', { name: /Start exam|Join the lobby/ }).click();
  return (await response).json() as Promise<{ attempt_id: string; token: string; deadline_at: number }>;
}
async function attempt(j: { attempt_id: string; token: string }) {
  return (await api.get(`${PUBLIC}/api/v1/attempts/${j.attempt_id}`, { headers: { Authorization: `Bearer ${j.token}` } })).json();
}

test('packaged runtime: owner upload, bulk review, exam select-all, publish; two students; restart, timeout, release, full recovery', async ({ browser }, info) => {
  const errors: string[] = [];
  const ownerCtx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const ca = await browser.newContext(info.project.use), cb = await browser.newContext(info.project.use);
  try {
    const o = await ownerCtx.newPage(), a = await ca.newPage(), b = await cb.newPage();
    for (const p of [o, a, b]) p.on('pageerror', e => errors.push(e.message));
    await login(o);

    // 1. Synthetic PDF upload + local extraction through the packaged runtime.
    await o.getByRole('button', { name: 'Sources', exact: true }).click();
    await o.getByLabel('Original PDF', { exact: true }).setInputFiles(resolve('public/demo/pdf-smart-synthetic-demo.pdf'));
    await o.getByLabel('Source label').fill('Packaged synthetic source');
    await o.getByLabel('Year', { exact: true }).fill('2026');
    await o.getByLabel('Subject', { exact: true }).fill('Learning');
    await o.getByLabel('Provenance / licence / consent note').fill('Original synthetic fixture created for this project. Permission granted.');
    await o.getByLabel('I have permission').check();
    await o.getByLabel('This is a synthetic').check();
    await o.getByRole('button', { name: 'Upload & extract text' }).click();
    await expect(o.getByText(/12 question candidates imported as needs review/)).toBeVisible({ timeout: 60000 });

    // 2. Keyed synthetic items (keys individually verified), then UI bulk review of exactly that filter.
    const token = await csrf(o);
    const imported = await o.request.post(`${OWNER}/api/admin/questions`, { headers: { 'X-CSRF-Token': token }, data: [1, 2, 3, 4].map(n => ({
      stem_en: `Packaged item ${n}: choose the first option.`, stem_hi: `पैकेज प्रश्न ${n}: पहला विकल्प चुनिए।`, subject: 'Packaged',
      options: [{ key: 'A', en: 'First', hi: 'पहला' }, { key: 'B', en: 'Second', hi: 'दूसरा' }],
      answer_key: 'A', key_verified: true, status: 'needs-review',
    })) });
    expect(imported.status()).toBe(201);
    const ids: number[] = (await imported.json()).ids;
    await o.getByRole('button', { name: 'Refresh', exact: true }).click();
    await o.getByRole('button', { name: 'Question bank', exact: true }).click();
    await o.getByLabel('Search bank').fill('Packaged item');
    await o.getByRole('combobox', { name: /^Status\b/ }).selectOption('needs-review');
    await o.getByRole('checkbox', { name: 'Select all matching questions', exact: true }).check();
    await expect(o.getByText('4 selected', { exact: true })).toBeVisible();
    await o.getByLabel('I checked the text, option pairing, and warnings for all selected').check();
    await o.getByRole('button', { name: 'Apply to selected', exact: true }).click();
    await expect(o.getByText('4 questions marked reviewed.', { exact: false })).toBeVisible();
    const bank = (await (await o.request.get(`${OWNER}/api/admin/questions`)).json()).questions as { id: number; status: string; answer_key: string; key_verified: number; source_id: number | null }[];
    for (const id of ids) expect(bank.find(q => q.id === id)).toMatchObject({ status: 'reviewed', answer_key: 'A', key_verified: 1 });
    expect(bank.filter(q => q.source_id !== null).every(q => q.status === 'needs-review')).toBe(true);

    // 3. Exam builder select-all on the Subject filter → scored independent draft → publish.
    await o.getByRole('button', { name: 'Exams', exact: true }).click();
    await o.getByRole('combobox', { name: /^Subject\b/ }).selectOption('Packaged');
    const selectAll = o.getByLabel(/Select all matching questions \(/);
    await selectAll.check();
    await expect(o.getByText('Select all matching questions (4 of 4 selected)')).toBeVisible();
    await o.getByLabel('Exam title').fill('Packaged two-student exam');
    await o.getByLabel('Duration (minutes)').fill('1');
    await o.getByRole('button', { name: 'Create draft · 4 questions' }).click();
    await expect(o.getByText(/Draft .* created/)).toBeVisible();
    const row = o.locator('.exam-row').filter({ hasText: 'Packaged two-student exam' });
    await row.getByRole('button', { name: 'Publish paper' }).click();
    await expect(o.getByText(/Published .* Share this join code/)).toBeVisible();
    const code = (await row.locator('.code').innerText()).trim();
    await o.screenshot({ path: join(SHOTS, 'owner-published.png'), fullPage: true });

    // 4. Two isolated student browsers on the Pages build → public gateway only.
    const [ja, jb] = await Promise.all([enroll(a, code, 'Asha packaged'), enroll(b, code, 'Kabir packaged')]);
    await expect(a.getByRole('radio').first()).toBeVisible();
    await expect(b.getByRole('radio').first()).toBeVisible();
    expect(JSON.stringify(await attempt(ja))).not.toMatch(/answer_key|explanation|bank_id/);
    expect((await api.get(`${PUBLIC}/api/v1/attempts/${jb.attempt_id}`, { headers: { Authorization: `Bearer ${ja.token}` } })).status()).toBe(404);
    expect((await a.request.get(`${PUBLIC}/api/admin/exams`)).status()).toBe(404);
    await a.getByRole('radio').first().check();
    await expect(a.getByText('All answers saved ✓', { exact: true })).toBeVisible();
    await b.getByRole('radio').first().check();
    await expect(b.getByText('All answers saved ✓', { exact: true })).toBeVisible();
    expect(Object.keys((await attempt(jb)).answers)).toEqual(['q1']);
    await a.screenshot({ path: join(SHOTS, 'student-a-exam.png'), fullPage: true });

    // 5. Managed stop/start mid-exam: unsaved edit survives and syncs on reconnect.
    await stop();
    await a.getByRole('button', { name: 'Question 2, not answered', exact: true }).click();
    await a.getByRole('radio').first().check();
    await expect(a.getByRole('alert')).toContainText('Not saved yet');
    await start();
    await expect(a.getByText('All answers saved ✓', { exact: true })).toBeVisible({ timeout: 15000 });
    expect((await attempt(ja)).answers.q2.choice).toBe('A');

    // 6. A submits; B is left to time out server-side (1-minute duration).
    await a.getByRole('button', { name: 'Submit exam…', exact: true }).click();
    await a.getByRole('button', { name: 'Submit exam', exact: true }).click();
    await expect(a.getByRole('heading', { name: 'Submitted', exact: true })).toBeVisible();
    await expect.poll(async () => (await attempt(jb)).status, { timeout: 90000, intervals: [2000] }).toBe('expired');
    await b.reload();
    await expect(b.getByRole('heading', { name: /Time is up/ })).toBeVisible();

    // 7. Owner sees both attempts (admin session survived the restart) and releases scores in the UI.
    await o.reload();
    await o.getByRole('button', { name: 'Exams', exact: true }).click();
    await row.getByRole('button', { name: 'View attempts' }).click();
    await expect(o.getByRole('cell', { name: 'Asha packaged', exact: true })).toBeVisible();
    await expect(o.getByRole('cell', { name: 'Kabir packaged', exact: true })).toBeVisible();
    await o.getByLabel('Release scores').check();
    await expect(o.getByText('Scores released.', { exact: true })).toBeVisible();
    await a.getByRole('button', { name: 'Check for results' }).click();
    await b.getByRole('button', { name: 'Check for results' }).click();
    await expect(a.getByText('2 correct · 0 wrong · 2 unanswered of 4', { exact: true })).toBeVisible();
    await expect(b.getByText('1 correct · 0 wrong · 3 unanswered of 4', { exact: true })).toBeVisible();
    await b.screenshot({ path: join(SHOTS, 'student-b-results.png'), fullPage: true });

    // 8. Profile lock: a second runtime on the same profile refuses to start.
    const second = serve();
    expect(await second.exited).toBe(4);
    expect(second.events[0]).toMatchObject({ event: 'error', code: 'already-running' });

    // 9. Full backup with the managed writer stopped, a post-backup change, full restore, restart.
    const examId = (await (await o.request.get(`${OWNER}/api/admin/exams`)).json()).exams.find((e: { code: string }) => e.code === code).id;
    await stop();
    const bundle = join(backups, 'full backup 1');
    const backed = cli(['backup', '--full', bundle]);
    expect(backed.status, backed.stderr).toBe(0);
    await start();
    const late = await enroll(a, code, 'After backup');
    expect(late.attempt_id).toBeTruthy();
    await stop();
    const restored = cli(['restore', '--full', bundle]);
    expect(restored.status, restored.stderr).toBe(0);
    expect(restored.stdout).toContain('previous data kept at');
    await start();
    await login(o);
    const after = (await (await o.request.get(`${OWNER}/api/admin/exams/${examId}/attempts`)).json()).attempts as { alias: string; status: string }[];
    expect(after.map(v => `${v.alias}:${v.status}`).sort()).toEqual(['Asha packaged:submitted', 'Kabir packaged:expired']);
    expect((await o.request.get(`${OWNER}/api/admin/sources`)).ok()).toBe(true);
    expect(errors).toEqual([]);
  } finally { await ownerCtx.close(); await ca.close(); await cb.close(); }
});

test('packaged listeners: gateway rejects admin, static and encoded paths; CORS allowlist; owner admin same-origin only', async () => {
  for (const path of ['/api/admin/me', '/admin/', '/', '/api/v1/../admin/me', '/api/v1/%2e%2e/admin/me', '/api/v1%2Fhealth',
    '/api/v1/health%00', '/api/v1/%61dmin', '/api/v1//health']) {
    const r = await api.fetch(`${PUBLIC}${path}`, { method: 'GET', maxRedirects: 0 });
    expect(r.status(), path).toBe(404);
  }
  for (const method of ['PUT', 'DELETE', 'PATCH']) expect((await api.fetch(`${PUBLIC}/api/v1/health`, { method })).status()).toBe(404);
  const ok = await api.fetch(`${PUBLIC}/api/v1/health`, { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:4327', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  expect(ok.headers()['access-control-allow-origin']).toBe('http://127.0.0.1:4327');
  const bad = await api.fetch(`${PUBLIC}/api/v1/health`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
  expect(bad.headers()['access-control-allow-origin']).toBeUndefined();
  expect((await api.get(`${OWNER}/api/admin/me`, { headers: { Origin: 'http://127.0.0.1:4327' } })).status()).toBe(403);
  expect((await api.get(`${OWNER}/admin/`)).status()).toBe(200);
});

// Node's raw path option preserves traversal/encoding bytes that browser URL parsers
// normalize away. Test the real listener's decision, not the test client's rewriting.
test('packaged raw request targets and owner Host guard fail closed', async () => {
  const raw = (port: number, path: string, headers = {}) => new Promise<number>( (resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, headers, method: 'GET' }, response => {
      response.resume(); resolve(response.statusCode!);
    });
    req.setTimeout(5000, () => req.destroy(new Error('raw request timeout')));
    req.on('error', reject); req.end();
  });
  for (const path of ['/api/v1/../admin/', '/api/v1/%2e%2e/admin/', '/api/v1%2fhealth', '/api/v1/%252e%252e/admin/',
    '/api/v1/health%00', '/api/v10/health', '/api/v1//health', '/api/v1/health;', '/api/v1/health\\x', '/api/v1/' + 'a'.repeat(129)]) {
    expect(await raw(PUBLIC_PORT, path), path).toBe(404);
  }
  for (const host of ['evil.example', 'evil.example:' + OWNER_PORT, '127.0.0.1', '127.0.0.1:' + PUBLIC_PORT,
    'localhost:' + OWNER_PORT + '.evil.example', '[::1]:' + OWNER_PORT]) {
    expect(await raw(OWNER_PORT, '/admin/', { Host: host, Origin: 'http://' + host }), host).toBe(404);
  }
  expect(await raw(OWNER_PORT, '/admin/', { Host: 'localhost:' + OWNER_PORT })).toBe(200);
});

test('packaged student identity uses valid Cloudflare IP only on loopback student listener', async () => {
  await stop(); joinLimit = '1'; await start();
  try {
    const owner = await request.newContext();
    try {
      const login = await owner.post(`${OWNER}/api/admin/login`, { data: { username: USER, password: PASSWORD } });
      expect(login.status()).toBe(200);
      const headers = { 'X-CSRF-Token': (await login.json()).csrf_token };
      const question = await owner.post(`${OWNER}/api/admin/questions`, { headers, data: [{
        stem_en: 'Synthetic rate-limit question', options: [{ key: 'A', en: 'One' }, { key: 'B', en: 'Two' }],
        answer_key: 'A', key_verified: true, status: 'reviewed',
      }] });
      expect(question.status()).toBe(201);
      const draft = await owner.post(`${OWNER}/api/admin/exams`, { headers, data: {
        title: 'Synthetic rate-limit exam', mode: 'independent', duration_s: 600,
        opens_at: Date.now() - 1000, closes_at: Date.now() + 3600000,
        question_ids: (await question.json()).ids,
      } });
      expect(draft.status()).toBe(201);
      const exam = await draft.json();
      expect((await owner.post(`${OWNER}/api/admin/exams/${exam.id}/publish`, { headers })).status()).toBe(200);
      const code = exam.code;
      const join = (base: string, alias: string, ip: string) => api.post(`${base}/api/v1/exams/${code}/join`, {
        headers: { 'CF-Connecting-IP': ip }, data: { alias },
      });
      expect((await join(PUBLIC, 'IP A first', '192.0.2.1')).status()).toBe(201);
      expect((await join(PUBLIC, 'IP A second', '192.0.2.1')).status()).toBe(429);
      expect((await join(PUBLIC, 'IP B first', '2001:db8::2')).status()).toBe(201);
      expect((await join(PUBLIC, 'Invalid header first', 'not-an-ip')).status()).toBe(201);
      expect((await join(PUBLIC, 'Invalid header second', 'another-invalid')).status()).toBe(429);
      // The single app shares limiter state: invalid public headers used the peer
      // bucket above. Owner requests MUST use that same peer despite valid CF headers.
      expect((await join(OWNER, 'Owner CF cannot bypass peer', '192.0.2.99')).status()).toBe(429);
    } finally { await owner.dispose(); }
  } finally { await stop(); joinLimit = '20'; await start(); }
});
