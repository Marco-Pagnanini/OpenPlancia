import { create } from 'zustand';
import type { AppInfo, TerminalErrorCode } from '@shared/ipc';

interface TerminalError {
  code: TerminalErrorCode;
  message: string;
}

interface TerminalState {
  appInfo: AppInfo | null;
  errors: Record<string, TerminalError>;
  exitCodes: Record<string, number>;
  init(): () => void;
  start(id: string, resume: boolean, size: { cols: number; rows: number }): Promise<void>;
  clearError(id: string): void;
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

export const useTerminalStore = create<TerminalState>()((set) => ({
  appInfo: null,
  errors: {},
  exitCodes: {},

  init() {
    void window.plancia.app.info().then((appInfo) => set({ appInfo }));
    const offError = window.plancia.terminal.onError(({ id, code, message }) =>
      set((s) => ({ errors: { ...s.errors, [id]: { code, message } } })),
    );
    const offExit = window.plancia.terminal.onExit(({ id, exitCode }) =>
      set((s) => ({ exitCodes: { ...s.exitCodes, [id]: exitCode } })),
    );
    return () => {
      offError();
      offExit();
    };
  },

  async start(id, resume, size) {
    set((s) => ({ errors: without(s.errors, id) }));
    const result = await window.plancia.terminal.start({ id, resume, ...size });
    if (!result.ok) {
      set((s) => ({
        errors: { ...s.errors, [id]: { code: result.code, message: result.message } },
      }));
    }
  },

  clearError(id) {
    set((s) => ({ errors: without(s.errors, id) }));
  },
}));
