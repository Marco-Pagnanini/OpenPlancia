import type { BoardIntent, WorkspaceSnapshot } from './types';

/**
 * IPC channel names and the typed API exposed to the renderer as `window.plancia`.
 * Shared by main, preload and renderer.
 */
export const IpcChannels = {
  ping: 'plancia:ping',
  workspaceGet: 'plancia:workspace:get',
  workspaceOpenDialog: 'plancia:workspace:open-dialog',
  /** main → renderer: the whole workspace snapshot after any change (or null when closed). */
  workspaceState: 'plancia:workspace:state',
  boardDispatch: 'plancia:board:dispatch',
  appInfo: 'plancia:app:info',
  openExternal: 'plancia:app:open-external',
  terminalStart: 'plancia:terminal:start',
  terminalStop: 'plancia:terminal:stop',
  terminalSnapshot: 'plancia:terminal:snapshot',
  /** renderer → main, fire and forget. */
  terminalWrite: 'plancia:terminal:write',
  terminalResize: 'plancia:terminal:resize',
  /** main → renderer events. */
  terminalData: 'plancia:terminal:data',
  terminalExit: 'plancia:terminal:exit',
  terminalError: 'plancia:terminal:error',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

export interface PingResponse {
  message: 'pong';
  /** ISO timestamp produced by the main process. */
  at: string;
}

export type OpenWorkspaceResult =
  | { status: 'opened'; snapshot: WorkspaceSnapshot }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export type DispatchResult = { ok: true } | { ok: false; error: string };

export interface AppInfo {
  platform: string;
  /** Output of `claude --version`, or null when Claude Code was not found. */
  claudeVersion: string | null;
  claudeInstallUrl: string;
}

export type TerminalErrorCode = 'claude-not-found' | 'no-session' | 'spawn-failed' | 'invalid';

export type TerminalStartResult =
  { ok: true } | { ok: false; code: TerminalErrorCode; message: string };

export interface TerminalSnapshot {
  data: string;
  /** Absolute offset (in UTF-16 units) of the end of `data` in the terminal's output stream. */
  end: number;
}

export interface TerminalDataEvent {
  id: string;
  data: string;
  /** Absolute offset of the first character of `data`. */
  start: number;
}

export interface TerminalExitEvent {
  id: string;
  exitCode: number;
  signal?: number | undefined;
}

export interface TerminalErrorEvent {
  id: string;
  code: TerminalErrorCode;
  message: string;
}

export interface PlanciaApi {
  ping(): Promise<PingResponse>;
  workspace: {
    get(): Promise<WorkspaceSnapshot | null>;
    openDialog(): Promise<OpenWorkspaceResult>;
    onState(listener: (snapshot: WorkspaceSnapshot | null) => void): () => void;
  };
  board: {
    dispatch(intent: BoardIntent): Promise<DispatchResult>;
  };
  app: {
    info(): Promise<AppInfo>;
    openExternal(url: string): Promise<void>;
  };
  terminal: {
    start(request: {
      id: string;
      resume: boolean;
      cols: number;
      rows: number;
    }): Promise<TerminalStartResult>;
    stop(id: string): Promise<void>;
    snapshot(id: string): Promise<TerminalSnapshot | null>;
    write(id: string, data: string): void;
    resize(id: string, cols: number, rows: number): void;
    onData(listener: (event: TerminalDataEvent) => void): () => void;
    onExit(listener: (event: TerminalExitEvent) => void): () => void;
    onError(listener: (event: TerminalErrorEvent) => void): () => void;
  };
}
