import { create } from 'zustand';
import type { ArchDiff, ArchitectureDoc } from '@shared/architecture';

/** Editor changes are saved this long after the last one. */
const AUTOSAVE_MS = 400;
/** How long Claude's additions stay highlighted (spec §8.3). */
export const HIGHLIGHT_MS = 4000;

export interface ClaudeArchEdit {
  author: string;
  at: number;
  diff: ArchDiff;
}

interface ArchitectureStoreState {
  /** The document as shown: the saved one plus any edit waiting for autosave. */
  docs: Record<string, ArchitectureDoc>;
  /** Version the shown document is based on. */
  versions: Record<string, number>;
  canUndo: Record<string, boolean>;
  pending: Record<string, true>;
  errors: Record<string, string>;
  claudeEdits: Record<string, ClaudeArchEdit>;
  init(): () => void;
  load(id: string): Promise<void>;
  /** Applies an editor change locally and schedules the save. */
  change(id: string, update: (doc: ArchitectureDoc) => ArchitectureDoc): void;
  undo(id: string): Promise<void>;
  dismissClaudeEdit(id: string): void;
  clearError(id: string): void;
}

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const useArchitectureStore = create<ArchitectureStoreState>()((set, get) => {
  async function save(id: string): Promise<void> {
    timers.delete(id);
    const doc = get().docs[id];
    const version = get().versions[id];
    if (!doc || version === undefined || !get().pending[id]) return;
    set((s) => ({ pending: omit(s.pending, id) }));
    const result = await window.plancia.architecture.write(id, doc, version);
    set((s) => {
      if (result.ok) {
        // Keep edits made while saving; otherwise take the saved document as is.
        const unchanged = s.docs[id] === doc;
        return {
          docs: unchanged ? { ...s.docs, [id]: result.doc } : s.docs,
          versions: { ...s.versions, [id]: result.version },
          errors: omit(s.errors, id),
        };
      }
      if (result.code === 'conflict') {
        return {
          docs: { ...s.docs, [id]: result.state.doc },
          versions: { ...s.versions, [id]: result.state.version },
          canUndo: { ...s.canUndo, [id]: result.state.canUndo },
          pending: omit(s.pending, id),
          errors: {
            ...s.errors,
            [id]: "Il diagramma è cambiato nel frattempo: l'ultima modifica non è stata salvata.",
          },
        };
      }
      return { errors: { ...s.errors, [id]: result.message } };
    });
    if (result.ok && get().pending[id]) schedule(id);
  }

  function schedule(id: string): void {
    const previous = timers.get(id);
    if (previous) clearTimeout(previous);
    timers.set(
      id,
      setTimeout(() => void save(id), AUTOSAVE_MS),
    );
  }

  return {
    docs: {},
    versions: {},
    canUndo: {},
    pending: {},
    errors: {},
    claudeEdits: {},

    init() {
      return window.plancia.architecture.onChanged(
        ({ id, doc, version, canUndo, author, diff }) => {
          const timer = timers.get(id);
          if (timer) clearTimeout(timer);
          timers.delete(id);
          set((s) => ({
            docs: { ...s.docs, [id]: doc },
            versions: { ...s.versions, [id]: version },
            canUndo: { ...s.canUndo, [id]: canUndo },
            pending: omit(s.pending, id),
            errors: s.pending[id]
              ? {
                  ...s.errors,
                  [id]: 'Claude ha modificato il diagramma: le tue ultime modifiche sono state sostituite.',
                }
              : s.errors,
            claudeEdits:
              author && diff
                ? { ...s.claudeEdits, [id]: { author, at: Date.now(), diff } }
                : omit(s.claudeEdits, id),
          }));
        },
      );
    },

    async load(id) {
      try {
        const state = await window.plancia.architecture.read(id);
        set((s) => ({
          docs: { ...s.docs, [id]: state.doc },
          versions: { ...s.versions, [id]: state.version },
          canUndo: { ...s.canUndo, [id]: state.canUndo },
          errors: omit(s.errors, id),
        }));
      } catch (err) {
        set((s) => ({
          errors: { ...s.errors, [id]: err instanceof Error ? err.message : String(err) },
        }));
      }
    },

    change(id, update) {
      const doc = get().docs[id];
      if (!doc) return;
      set((s) => ({
        docs: { ...s.docs, [id]: update(doc) },
        pending: { ...s.pending, [id]: true },
      }));
      schedule(id);
    },

    async undo(id) {
      const result = await window.plancia.architecture.undo(id);
      if (!result.ok) set((s) => ({ errors: { ...s.errors, [id]: result.message } }));
    },

    dismissClaudeEdit(id) {
      set((s) => ({ claudeEdits: omit(s.claudeEdits, id) }));
    },

    clearError(id) {
      set((s) => ({ errors: omit(s.errors, id) }));
    },
  };
});
