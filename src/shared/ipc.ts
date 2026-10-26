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
}
