import { _electron } from '../../app/node_modules/playwright-core/index.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import os from 'node:os';

if (process.argv.includes('--packaged')) {
  throw new Error('Packaged CLI inspection is disabled by Electron fuses. Use packaging/scripts/linux-install-container.sh for installed GUI tests; this Playwright IPC harness is development-only.');
}
const root = path.resolve('..');
// This repository is on an NTFS mount that reports fixed root ownership and 0777.
// Private-profile checks must be exercised on a filesystem with real POSIX ownership.
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-electron-smoke-ünï '));
const free = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const env = { ...process.env, HOME: profile, USERPROFILE: profile, XDG_CONFIG_HOME: path.join(profile, 'config'), XDG_DATA_HOME: path.join(profile, 'data'), XDG_STATE_HOME: path.join(profile, 'state') };
delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.argv.includes('--packaged');
const application = await _electron.launch({ executablePath: packaged ? path.join(root, 'release/linux-unpacked/practice-institute') : path.resolve('node_modules/electron/dist/electron'), args: packaged ? [] : [path.resolve('.')], env, timeout: 30_000 });
try {
  const page = await application.firstWindow();
  await page.waitForFunction(() => !!window.pi);
  let ready = false;
  for (let n = 0; n < 300; n++) {
    if ((await page.evaluate(() => window.pi.getState())).activity !== null) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, 'Launcher initialization did not complete.');
  const security = await application.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; const p = win.webContents.getLastWebPreferences(); return { sandbox: p.sandbox, node: p.nodeIntegration, isolation: p.contextIsolation }; });
  assert.deepEqual(security, { sandbox: true, node: false, isolation: true });
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  const before = await page.evaluate(() => window.pi.getState()); assert.equal(before.ownerExists, false);
  const password = 'Synthetic-🔒-' + randomBytes(16).toString('hex');
  const created = await page.evaluate(input => window.pi.createOwner(input), { username: 'synthetic-owner', password, confirm: password }); assert.ok(!JSON.stringify(created).includes(password));
  assert.equal(created.ok, true, JSON.stringify(created));
  const ports = { ownerPort: await free(), publicPort: await free() };
  assert.equal((await page.evaluate(value => window.pi.saveSettings(value), ports)).ok, true);
  await page.evaluate(() => { window.smokeStates = []; window.pi.onState(s => window.smokeStates.push(s.server.kind)); });
  assert.equal((await page.evaluate(() => window.pi.startServer())).ok, true);
  const running = await page.evaluate(() => window.pi.getState()); assert.equal(running.server.kind, 'running'); assert.equal(running.keepAwakeActive, true);
  const login = await fetch(running.server.ownerUrl + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'synthetic-owner', password }) });
  assert.equal(login.status, 200, 'Unicode credentials did not survive the stdin setup pipe.'); await login.body?.cancel();
  const states = await page.evaluate(() => window.smokeStates); assert.ok(states.includes('starting') && states.includes('probing') && states.includes('running'));
  const bad = await page.evaluate(() => window.pi.openFolder('/tmp')); assert.equal(bad.ok, false);
  const restore = await page.evaluate(() => window.pi.restore('wrong')); assert.equal(restore.code, 'not-confirmed');
  const saveWhileRunning = await page.evaluate(() => window.pi.saveSettings({ ownerPort: 8877 })); assert.equal(saveWhileRunning.code, 'server-running');
  const backupParent = path.join(profile, 'recovery-test'); await fs.mkdir(backupParent);
  // Tests alone select synthetic folders/confirm dialogs. No real owner profile is touched.
  await application.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, backupParent);
  const backedUp = await page.evaluate(() => window.pi.backup()); assert.equal(backedUp.ok, true);
  const bundle = path.join(backupParent, backedUp.value.folderName);
  assert.ok(await fs.stat(path.join(bundle, 'manifest.json')));
  assert.equal((await page.evaluate(() => window.pi.getState())).server.kind, 'running');
  await application.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); }, bundle);
  const restored = await page.evaluate(() => window.pi.restore('RESTORE')); assert.equal(restored.ok, true); assert.ok(restored.value.previousDataFolder.includes('.pre-restore-'));
  assert.equal((await page.evaluate(() => window.pi.getState())).server.kind, 'running');
  assert.equal((await page.evaluate(() => window.pi.stopServer())).ok, true);
  assert.equal((await page.evaluate(() => window.pi.getState())).server.kind, 'stopped');
  const logDir = path.join(profile, 'state/practice-institute/logs');
  for (const file of await fs.readdir(logDir)) assert.ok(!(await fs.readFile(path.join(logDir, file), 'utf8')).includes(password));
  console.log(`Electron ${packaged ? 'unpacked' : 'development'} IPC smoke passed: security preferences/preload, first-run setup, real readiness transitions, keep-awake, payload rejection, full backup/restore/restart, stop, no password in logs. Playwright supplies --no-sandbox; production OS sandbox enforcement remains separate.`);
} finally {
  // Failed assertions while serving must also stop our child, rather than block
  // automation on the native close warning. These dialogs belong to this fixture.
  await application.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); }).catch(() => {});
  const page = application.windows()[0];
  for (let n = 0; page && n < 100; n++) {
    const r = await page.evaluate(() => window.pi.stopServer()).catch(() => null);
    if (!r || r.ok || r.code !== 'busy') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await application.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await application.close();
  await fs.rm(profile, { recursive: true, force: true });
}
