import { create } from 'zustand';
import type { MarkdownDoc } from '@shared/ipc';

/** Autosave delay after the last keystroke (spec §8.2). */
export const AUTOSAVE_MS = 500;

export type SaveState = 'saved' | 'pending' | 'saving' | 'error';

interface MarkdownState {
  /** Last saved content and version of each panel, as the main process knows them. */
  docs: Record<string, MarkdownDoc>;
  /** Unsaved local edits. */
  drafts: Record<string, string>;
  saveState: Record<string, SaveState>;
  errors: Record<string, string>;
  /** The file changed on disk while the panel had unsaved edits. */
  conflicts: Record<string, true>;
  init(): () => void;
  load(id: string): Promise<void>;
  edit(id: string, content: string): void;
  /** Saves now instead of waiting for the autosave delay (Cmd/Ctrl+S). */
  flush(id: string): void;
  /** Conflict resolution: drop local edits and take the file as it is on disk. */
  discardDraft(id: string): void;
  /** Conflict resolution: write local edits over the file. */
  keepDraft(id: string): Promise<void>;
}

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const useMarkdownStore = create<MarkdownState>()((set, get) => {
  async function save(id: string): Promise<void> {
    timers.delete(id);
    const { drafts, docs, conflicts } = get();
    const content = drafts[id];
    const doc = docs[id];
    if (content === undefined || !doc || conflicts[id]) return;
    set((s) => ({ saveState: { ...s.saveState, [id]: 'saving' } }));
    const result = await window.plancia.markdown.write(id, content, doc.version);
    set((s) => {
      if (result.ok) {
        // Keep typing that happened during the write as a draft.
        const stillDirty = s.drafts[id] !== undefined && s.drafts[id] !== content;
        return {
          docs: { ...s.docs, [id]: { content, version: result.version, exists: true } },
          drafts: stillDirty ? s.drafts : omit(s.drafts, id),
          saveState: { ...s.saveState, [id]: stillDirty ? 'pending' : 'saved' },
          errors: omit(s.errors, id),
        };
      }
      if (result.code === 'conflict') {
        return {
          docs: { ...s.docs, [id]: result.doc },
          conflicts: { ...s.conflicts, [id]: true },
          saveState: { ...s.saveState, [id]: 'pending' },
        };
      }
      return {
        saveState: { ...s.saveState, [id]: 'error' },
        errors: { ...s.errors, [id]: result.message },
      };
    });
    if (result.ok && get().drafts[id] !== undefined) schedule(id);
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
    drafts: {},
    saveState: {},
    errors: {},
    conflicts: {},

    init() {
      return window.plancia.markdown.onChanged(({ id, ...doc }) =>
        set((s) => {
          const draft = s.drafts[id];
          const conflict = draft !== undefined && draft !== doc.content;
          return {
            docs: { ...s.docs, [id]: doc },
            // No local edits: the panel simply shows the new content.
            drafts: conflict ? s.drafts : omit(s.drafts, id),
            conflicts: conflict ? { ...s.conflicts, [id]: true } : s.conflicts,
          };
        }),
      );
    },

    async load(id) {
      try {
        const doc = await window.plancia.markdown.read(id);
        set((s) => ({ docs: { ...s.docs, [id]: doc }, errors: omit(s.errors, id) }));
      } catch (err) {
        set((s) => ({
          errors: { ...s.errors, [id]: err instanceof Error ? err.message : String(err) },
        }));
      }
    },

    edit(id, content) {
      set((s) => ({
        drafts: { ...s.drafts, [id]: content },
        saveState: { ...s.saveState, [id]: 'pending' },
      }));
      schedule(id);
    },

    flush(id) {
      const timer = timers.get(id);
      if (timer) clearTimeout(timer);
      void save(id);
    },

    discardDraft(id) {
      const timer = timers.get(id);
      if (timer) clearTimeout(timer);
      timers.delete(id);
      set((s) => ({
        drafts: omit(s.drafts, id),
        conflicts: omit(s.conflicts, id),
        saveState: { ...s.saveState, [id]: 'saved' },
      }));
    },

    async keepDraft(id) {
      set((s) => ({ conflicts: omit(s.conflicts, id) }));
      await save(id);
    },
  };
});
