import { create } from 'zustand';
import { agentPairKey, wireKey } from '@shared/access';
import type { AgentMessage, ConnectionUse } from '@shared/ipc';

/** A wire animates for this long after each read or write (spec §6). */
export const RECENT_USE_MS = 3000;

interface ConnectionState {
  /** Latest use per wire key. */
  lastUse: Record<string, ConnectionUse>;
  /** Uses from the last RECENT_USE_MS, per wire key: those wires animate. */
  active: Record<string, ConnectionUse>;
  /** Latest message per pair of agents, and the ones from the last RECENT_USE_MS (M8). */
  lastMessage: Record<string, AgentMessage>;
  activeMessages: Record<string, AgentMessage>;
  init(): () => void;
}

export const useConnectionStore = create<ConnectionState>()((set) => ({
  lastUse: {},
  active: {},
  lastMessage: {},
  activeMessages: {},
  init() {
    const offMessages = window.plancia.agents.onMessage((message) => {
      const key = agentPairKey(message.from, message.to);
      set((s) => ({
        lastMessage: { ...s.lastMessage, [key]: message },
        activeMessages: { ...s.activeMessages, [key]: message },
      }));
      setTimeout(
        () =>
          set((s) =>
            s.activeMessages[key] !== message
              ? s
              : {
                  activeMessages: Object.fromEntries(
                    Object.entries(s.activeMessages).filter(([k]) => k !== key),
                  ),
                },
          ),
        RECENT_USE_MS,
      );
    });
    const offUses = window.plancia.connections.onUsed((use) => {
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
    return () => {
      offMessages();
      offUses();
    };
  },
}));

/** ~4 characters per token, as in the spec's estimate. */
export function estimateTokens(chars: number): number {
  return Math.max(1, Math.round(chars / 4));
}
