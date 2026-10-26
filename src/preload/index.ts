import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IpcChannels,
  type ConnectionUse,
  type MarkdownChangedEvent,
  type PlanciaApi,
  type TerminalDataEvent,
  type TerminalErrorEvent,
  type TerminalExitEvent,
} from '@shared/ipc';
import type { ActivityEvent } from '@shared/activity';
import type { WorkspaceSnapshot } from '@shared/types';

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

// Keep this surface minimal: only typed, intent-level calls, never raw ipcRenderer.
const api: PlanciaApi = {
  ping: () => ipcRenderer.invoke(IpcChannels.ping),
  workspace: {
    get: () => ipcRenderer.invoke(IpcChannels.workspaceGet),
    openDialog: () => ipcRenderer.invoke(IpcChannels.workspaceOpenDialog),
    onState: (listener) =>
      subscribe<WorkspaceSnapshot | null>(IpcChannels.workspaceState, listener),
    close: () => ipcRenderer.invoke(IpcChannels.workspaceClose),
    recent: () => ipcRenderer.invoke(IpcChannels.workspaceRecent),
    openRecent: (path) => ipcRenderer.invoke(IpcChannels.workspaceOpenRecent, { path }),
  },
  board: {
    dispatch: (intent) => ipcRenderer.invoke(IpcChannels.boardDispatch, intent),
  },
  app: {
    info: () => ipcRenderer.invoke(IpcChannels.appInfo),
    openExternal: (url) => ipcRenderer.invoke(IpcChannels.openExternal, url),
  },
  terminal: {
    start: (request) => ipcRenderer.invoke(IpcChannels.terminalStart, request),
    stop: (id) => ipcRenderer.invoke(IpcChannels.terminalStop, { id }),
    snapshot: (id) => ipcRenderer.invoke(IpcChannels.terminalSnapshot, { id }),
    write: (id, data) => ipcRenderer.send(IpcChannels.terminalWrite, { id, data }),
    resize: (id, cols, rows) => ipcRenderer.send(IpcChannels.terminalResize, { id, cols, rows }),
    onData: (listener) => subscribe<TerminalDataEvent>(IpcChannels.terminalData, listener),
    onExit: (listener) => subscribe<TerminalExitEvent>(IpcChannels.terminalExit, listener),
    onError: (listener) => subscribe<TerminalErrorEvent>(IpcChannels.terminalError, listener),
  },
  markdown: {
    create: (request) => ipcRenderer.invoke(IpcChannels.markdownCreate, request),
    read: (id) => ipcRenderer.invoke(IpcChannels.markdownRead, { id }),
    write: (id, content, baseVersion) =>
      ipcRenderer.invoke(IpcChannels.markdownWrite, { id, content, baseVersion }),
    onChanged: (listener) => subscribe<MarkdownChangedEvent>(IpcChannels.markdownChanged, listener),
    undo: (id) => ipcRenderer.invoke(IpcChannels.markdownUndo, { id }),
  },
  connections: {
    history: (terminalId, panelId) =>
      ipcRenderer.invoke(IpcChannels.connectionHistory, { terminalId, panelId }),
    onUsed: (listener) => subscribe<ConnectionUse>(IpcChannels.connectionUsed, listener),
    manifest: (terminalId) => ipcRenderer.invoke(IpcChannels.manifestPreview, { id: terminalId }),
  },
  activity: {
    list: (terminalId) => ipcRenderer.invoke(IpcChannels.activityList, { id: terminalId }),
    onEvent: (listener) => subscribe<ActivityEvent>(IpcChannels.activityEvent, listener),
  },
};

contextBridge.exposeInMainWorld('plancia', api);
