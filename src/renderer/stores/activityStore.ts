import { create } from 'zustand';
import type { ActivityEvent } from '@shared/activity';

interface ActivityState {
  byTerminal: Record<string, ActivityEvent[]>;
  init(): () => void;
  load(terminalId: string): Promise<void>;
}

function upsert(list: ActivityEvent[], event: ActivityEvent): ActivityEvent[] {
  const index = list.findIndex((e) => e.id === event.id);
  if (index < 0) return [...list, event];
  const next = [...list];
  next[index] = event;
  return next;
}

/** Mirror of the main-process activity log, loaded per terminal on demand. */
export const useActivityStore = create<ActivityState>()((set) => ({
  byTerminal: {},

  init() {
    return window.plancia.activity.onEvent((event) =>
      set((s) => {
        const list = s.byTerminal[event.terminalId];
        // Not loaded yet: the next load() brings it in.
        if (!list) return s;
        return { byTerminal: { ...s.byTerminal, [event.terminalId]: upsert(list, event) } };
      }),
    );
  },

  async load(terminalId) {
    const events = await window.plancia.activity.list(terminalId);
    set((s) => ({ byTerminal: { ...s.byTerminal, [terminalId]: events } }));
  },
}));
