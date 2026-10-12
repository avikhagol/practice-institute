import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type PiApi } from '../shared/ipc';
const api: PiApi = {
  getState: () => ipcRenderer.invoke(IPC.getState),
  onState: listener => { const handler = (_event: unknown, state: Parameters<typeof listener>[0]) => listener(state); ipcRenderer.on(IPC.subscribe, handler); return () => ipcRenderer.removeListener(IPC.subscribe, handler); },
  startServer: () => ipcRenderer.invoke(IPC.startServer), stopServer: () => ipcRenderer.invoke(IPC.stopServer),
  openAdmin: () => ipcRenderer.invoke(IPC.openAdmin), openFolder: kind => ipcRenderer.invoke(IPC.openFolder, kind),
  createOwner: input => ipcRenderer.invoke(IPC.createOwner, input), saveSettings: input => ipcRenderer.invoke(IPC.saveSettings, input),
  importTunnelCredentials: () => ipcRenderer.invoke(IPC.importTunnelCredentials), startTunnel: () => ipcRenderer.invoke(IPC.startTunnel),
  stopTunnel: () => ipcRenderer.invoke(IPC.stopTunnel), verifyTunnel: () => ipcRenderer.invoke(IPC.verifyTunnel),
  backup: () => ipcRenderer.invoke(IPC.backup), restore: text => ipcRenderer.invoke(IPC.restore, text),
  openGuide: topic => ipcRenderer.invoke(IPC.openGuide, topic), confirmQuit: choice => ipcRenderer.invoke(IPC.confirmQuit, choice),
};
contextBridge.exposeInMainWorld('pi', Object.freeze(api));
