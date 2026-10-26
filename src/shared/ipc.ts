/**
 * IPC channel names and the typed API exposed to the renderer as `window.plancia`.
 * Shared by main, preload and renderer.
 */
export const IpcChannels = {
  ping: 'plancia:ping',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

export interface PingResponse {
  message: 'pong';
  /** ISO timestamp produced by the main process. */
  at: string;
}

export interface PlanciaApi {
  ping(): Promise<PingResponse>;
}
