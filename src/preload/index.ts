import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannels, type PlanciaApi } from '@shared/ipc';
import type { WorkspaceSnapshot } from '@shared/types';

// Keep this surface minimal: only typed, intent-level calls, never raw ipcRenderer.
const api: PlanciaApi = {
  ping: () => ipcRenderer.invoke(IpcChannels.ping),
  workspace: {
    get: () => ipcRenderer.invoke(IpcChannels.workspaceGet),
    openDialog: () => ipcRenderer.invoke(IpcChannels.workspaceOpenDialog),
    onState: (listener) => {
      const handler = (_event: IpcRendererEvent, snapshot: WorkspaceSnapshot | null) =>
        listener(snapshot);
      ipcRenderer.on(IpcChannels.workspaceState, handler);
      return () => ipcRenderer.removeListener(IpcChannels.workspaceState, handler);
    },
  },
  board: {
    dispatch: (intent) => ipcRenderer.invoke(IpcChannels.boardDispatch, intent),
  },
};

contextBridge.exposeInMainWorld('plancia', api);
