// U4: launcher screenshots into the ignored .cache/screenshots/ using a disposable synthetic profile.
// Run from desktop/ after `npm run build`:  xvfb-run -a node scripts/screenshots.mjs
import { _electron } from '../../app/node_modules/playwright-core/index.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import assert from 'node:assert/strict';

const root = path.resolve('..');
const outDir = path.join(root, '.cache', 'screenshots');
await fs.mkdir(outDir, { recursive: true });
// POSIX temp dir (the repo mount cannot hold a private profile). Removed in `finally`.
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-shots-'));
const free = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const env = { ...process.env, HOME: profile, USERPROFILE: profile, XDG_CONFIG_HOME: path.join(profile, 'config'), XDG_DATA_HOME: path.join(profile, 'data'), XDG_STATE_HOME: path.join(profile, 'state') };
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({ executablePath: path.resolve('node_modules/electron/dist/electron'), args: [path.resolve('.')], env, timeout: 30_000 });
const shots = [];
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.pi);
  for (let n = 0; n < 300; n++) { if ((await page.evaluate(() => window.pi.getState())).activity !== null) break; await new Promise(r => setTimeout(r, 100)); }
  const shot = async name => { const file = path.join(outDir, `${name}.png`); await page.screenshot({ path: file }); shots.push(file); };
  const nav = label => page.getByRole('button', { name: label, exact: true }).click();
  await page.waitForSelector('#owner-username');
  await shot('01-first-run-step1');
  await page.fill('#owner-username', 'synthetic-owner');
  await page.fill('#owner-password', 'short'); await page.fill('#owner-confirm', 'other');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForSelector('#owner-password-error:not(:empty), #owner-confirm-error:not(:empty)');
  await shot('02-first-run-errors');
  const password = 'Synthetic-' + randomBytes(12).toString('hex');
  await page.fill('#owner-password', password); await page.fill('#owner-confirm', password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForSelector('#fr-origin');
  await shot('03-first-run-step2');
  await page.getByRole('button', { name: 'Set up later' }).click();
  await page.waitForSelector('.cards');
  await shot('04-home-stopped');
  assert.equal((await page.evaluate(ports => window.pi.saveSettings(ports), { ownerPort: await free(), publicPort: await free() })).ok, true);
  await page.getByRole('button', { name: 'Start server' }).click();
  // Poll the typed state with a bounded deadline; no promise predicate in waitForFunction.
  let running = false;
  for (let n = 0; n < 450; n++) {
    const state = await page.evaluate(() => window.pi.getState());
    if (state.server.kind === 'running') { running = true; break; }
    if (state.server.kind === 'failed') throw Error(`Screenshot server failed: ${state.server.reason}`);
    await new Promise(r => setTimeout(r, 100));
  }
  assert.equal(running, true, 'Screenshot server did not become ready');
  await shot('05-home-running');
  await nav('Setup'); await shot('06-setup-locked');
  await nav('Tunnel'); await shot('07-tunnel');
  await nav('Backup'); await shot('08-backup');
  await page.getByRole('button', { name: 'Restore from backup…' }).click();
  await shot('09-restore-confirm');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await nav('Help'); await shot('10-help');
  await nav('Home');
  await page.getByRole('button', { name: 'Stop server' }).click();
  for (let n = 0; n < 100; n++) { if ((await page.evaluate(() => window.pi.getState())).server.kind === 'stopped') break; await new Promise(r => setTimeout(r, 100)); }
  console.log(`Wrote ${shots.length} screenshots to ${path.relative(root, outDir)}`);
} finally {
  // A failed screenshot must not hang indefinitely on the native active-server close dialog.
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); }).catch(() => {});
  const page = app.windows()[0];
  for (let n = 0; page && n < 100; n++) {
    const result = await page.evaluate(() => window.pi.stopServer()).catch(() => null);
    if (!result || result.ok || result.code !== 'busy') break;
    await new Promise(r => setTimeout(r, 100));
  }
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await app.close().catch(() => {});
  await fs.rm(profile, { recursive: true, force: true });
}
