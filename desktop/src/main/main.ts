import { app, BrowserWindow, Menu, Tray, nativeImage, dialog, powerSaveBlocker, session } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { profilePaths, ensurePrivateDir, runtimePaths, APP_USER_MODEL_ID } from './paths';
import { ConfigStore } from './config';
import { Logs } from './logs';
import { Runtime } from './runtime';
import { Tunnel } from './tunnel';
import { Bridge, registerIpc } from './ipc';
import { IPC } from '../shared/ipc';

const dirs = profilePaths(process.platform, app.getPath('home'), process.env, app.getPath('documents'));
let profileError = false;
try {
  for (const dir of Object.values(dirs)) ensurePrivateDir(dir);
  ensurePrivateDir(path.join(dirs.config, 'electron'));
  app.setPath('userData', path.join(dirs.config, 'electron'));
} catch { profileError = true; }
let quitting = false, win: BrowserWindow, tray: Tray | null = null, bridge: Bridge;
let blocker: number | null = null;
let closePrompt = false;
const iconPath = path.join(app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '../../build'), process.platform === 'win32' ? 'icon.ico' : 'icon.png');
if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.on('before-quit', e => { if (!quitting && bridge) { e.preventDefault(); void askQuit(); } });
  app.on('window-all-closed', () => { if (!tray && !quitting) void askQuit(); });
  void app.whenReady().then(async () => {
    if (profileError) { await dialog.showMessageBox({ type: 'error', message: 'Practice Institute needs private, writable profile folders. Use a local user profile with per-user permissions. No server has been started.' }); quitting = true; app.quit(); return; }
    let store: ConfigStore;
    try { store = new ConfigStore(path.join(dirs.config, 'config.json'), dirs.tunnel); }
    catch { await dialog.showMessageBox({ type: 'error', message: 'Practice Institute configuration is invalid. Your data has been preserved. Repair config.json in your profile config folder before restarting.' }); quitting = true; app.quit(); return; }
    const resources = runtimePaths(process.resourcesPath, process.platform);
    // Development uses the exact built payload. No system runtime fallback.
    if (!app.isPackaged) {
      const root = path.resolve(__dirname, `../../../packaging/output/runtime-${process.platform === 'win32' ? 'win' : 'linux'}`);
      Object.assign(resources, { root, python: path.join(root, 'python', ...(process.platform === 'win32' ? ['python.exe'] : ['bin', 'python3'])), admin: path.join(root, 'admin'), cloudflared: path.join(root, 'cloudflared', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared') });
    }
    const runtime = new Runtime(resources, dirs, () => store.value, new Logs(path.join(dirs.logs, 'backend.log')));
    const tunnel = new Tunnel(resources.cloudflared, dirs, () => store.value, new Logs(path.join(dirs.logs, 'tunnel.log')));
    win = new BrowserWindow({ width: 880, height: 640, minWidth: 760, minHeight: 560, show: false, icon: iconPath,
      webPreferences: { preload: path.join(__dirname, '../preload/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, devTools: !app.isPackaged } });
    Menu.setApplicationMenu(null);
    const renderer = path.join(__dirname, '../renderer/index.html'), rendererUrl = pathToFileURL(renderer).href;
    win.webContents.on('will-navigate', e => e.preventDefault()); win.webContents.on('will-redirect', e => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    const changed = () => {
      const shouldBlock = runtime.status.kind === 'running' && store.value.keepAwakeWhileServing;
      if (shouldBlock && blocker === null) blocker = powerSaveBlocker.start('prevent-app-suspension');
      if (!shouldBlock && blocker !== null) { powerSaveBlocker.stop(blocker); blocker = null; }
      if (bridge) bridge.keepAwakeActive = blocker !== null;
      if (win && !win.isDestroyed() && bridge) win.webContents.send(IPC.subscribe, bridge.state());
    };
    bridge = new Bridge(store, dirs, runtime, tunnel, () => win, app.getVersion(), changed, chooseQuit);
    bridge.busy = true; // No mutation may race the initial owner-status migrations.
    bridge.initializing = true;
    runtime.on('state', changed); tunnel.on('state', changed);
    registerIpc(bridge, win, rendererUrl);
    win.on('close', e => { if (!quitting) { e.preventDefault(); void askQuit(); } });
    win.once('ready-to-show', () => win.show());
    await win.loadFile(renderer);
    try { await bridge.refresh(); } catch { runtime.status = { kind: 'failed', reason: 'runtime-missing', logTail: [] }; }
    finally { bridge.initializing = false; bridge.busy = false; changed(); }
    setInterval(() => bridge.pollActivity(), 10_000).unref();
  }).catch(async () => { await dialog.showMessageBox({ type: 'error', message: 'Practice Institute could not initialize. Your profile data has been preserved.' }); quitting = true; app.quit(); });
}
async function chooseQuit(choice: string): Promise<void> {
  if (choice === 'cancel') return;
  if (choice === 'keep-running') {
    if (!tray) {
      const image = nativeImage.createFromPath(iconPath).resize({ width: 24, height: 24 });
      tray = new Tray(image); tray.setToolTip('Practice Institute');
      tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Practice Institute', click: () => { win.show(); win.focus(); } }, { label: 'Quit', click: () => { void askQuit(); } }]));
      tray.on('click', () => { win.show(); win.focus(); });
    }
    win.hide(); return;
  }
  await bridge.tunnel.stop(); await bridge.runtime.stop();
  if (blocker !== null) powerSaveBlocker.stop(blocker);
  quitting = true; tray?.destroy(); tray = null; app.quit();
}
async function askQuit(): Promise<void> {
  if (closePrompt || !bridge || bridge.busy) return;
  closePrompt = true;
  try {
    if (!bridge.runtime.child && !bridge.tunnel.child) { await chooseQuit('stop-and-quit'); return; }
    const response = await dialog.showMessageBox(win, { type: 'warning', message: 'Students may be taking an exam.', detail: 'Keep this laptop awake, plugged in and online. Closing the lid, losing Wi-Fi or restarting stops access to the exam.', buttons: ['Stop the server and quit', 'Keep running in background', 'Cancel'], defaultId: 2, cancelId: 2 });
    await chooseQuit(['stop-and-quit', 'keep-running', 'cancel'][response.response]);
  } finally { closePrompt = false; }
}
