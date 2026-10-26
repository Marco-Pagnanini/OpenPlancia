import { create } from 'zustand';
import { wireKey } from '@shared/access';
import type { ConnectionUse } from '@shared/ipc';

/** A wire animates for this long after each read or write (spec §6). */
export const RECENT_USE_MS = 3000;

interface ConnectionState {
  /** Latest use per wire key. */
  lastUse: Record<string, ConnectionUse>;
  /** Uses from the last RECENT_USE_MS, per wire key: those wires animate. */
  active: Record<string, ConnectionUse>;
  init(): () => void;
}

export const useConnectionStore = create<ConnectionState>()((set) => ({
  lastUse: {},
  active: {},
  init() {
    return window.plancia.connections.onUsed((use) => {
      const key = wireKey(use.terminalId, use.panelId);
      set((s) => ({
        lastUse: { ...s.lastUse, [key]: use },
        active: { ...s.active, [key]: use },
      }));
      setTimeout(
        () =>
          set((s) => {
            if (s.active[key] !== use) return s;
            return {
              active: Object.fromEntries(Object.entries(s.active).filter(([k]) => k !== key)),
            };
          }),
        RECENT_USE_MS,
      );
    });
  },
}));

/** ~4 characters per token, as in the spec's estimate. */
export function estimateTokens(chars: number): number {
  return Math.max(1, Math.round(chars / 4));
}
