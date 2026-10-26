import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels, type PlanciaApi } from '@shared/ipc';

// Keep this surface minimal: only typed, intent-level calls, never raw ipcRenderer.
const api: PlanciaApi = {
  ping: () => ipcRenderer.invoke(IpcChannels.ping),
};

contextBridge.exposeInMainWorld('plancia', api);
