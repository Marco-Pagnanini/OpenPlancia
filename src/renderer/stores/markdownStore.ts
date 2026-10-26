import { create } from 'zustand';
import type { MarkdownDoc, MarkdownUndoResult, MarkdownWriteResult } from '@shared/ipc';

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
  /** Last change made by Claude, per panel: the panel flashes and offers "Annulla". */
  claudeEdits: Record<string, { author: string; at: number }>;
  init(): () => void;
  load(id: string): Promise<void>;
  edit(id: string, content: string): void;
  /** Saves now instead of waiting for the autosave delay (Cmd/Ctrl+S). */
  flush(id: string): void;
  /** Conflict resolution: drop local edits and take the file as it is on disk. */
  discardDraft(id: string): void;
  /** Conflict resolution: write local edits over the file. */
  keepDraft(id: string): Promise<void>;
  /** Restores the content before Claude's last write. */
  undo(id: string): Promise<void>;
  dismissClaudeEdit(id: string): void;
}

/** Key of a file of a folder panel in this store; markdown panels use their own id. */
export function folderFileKey(folderId: string, path: string): string {
  return `${folderId}::${path}`;
}

interface DocBackend {
  read(): Promise<MarkdownDoc>;
  write(content: string, baseVersion: number): Promise<MarkdownWriteResult>;
  undo(): Promise<MarkdownUndoResult>;
}

/** Where a document lives: a markdown panel's file, or a file of a folder panel. */
function backend(key: string): DocBackend {
  const split = key.indexOf('::');
  if (split < 0) {
    return {
      read: () => window.plancia.markdown.read(key),
      write: (content, version) => window.plancia.markdown.write(key, content, version),
      undo: () => window.plancia.markdown.undo(key),
    };
  }
  const id = key.slice(0, split);
  const path = key.slice(split + 2);
  return {
    read: () => window.plancia.folder.read(id, path),
    write: (content, version) => window.plancia.folder.write(id, path, content, version),
    undo: () => window.plancia.folder.undo(id, path),
  };
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
    const result = await backend(id).write(content, doc.version);
    set((s) => {
      if (result.ok) {
        // Keep typing that happened during the write as a draft.
        const stillDirty = s.drafts[id] !== undefined && s.drafts[id] !== content;
        return {
          docs: {
            ...s.docs,
            [id]: {
              content,
              version: result.version,
              exists: true,
              canUndo: s.docs[id]?.canUndo ?? false,
            },
          },
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
    claudeEdits: {},

    init() {
      const changed = (id: string, doc: MarkdownDoc, author?: string, undone?: boolean) =>
        set((s) => {
          const draft = s.drafts[id];
          const conflict = draft !== undefined && draft !== doc.content;
          const claudeEdits = author
            ? { ...s.claudeEdits, [id]: { author, at: Date.now() } }
            : undone
              ? omit(s.claudeEdits, id)
              : s.claudeEdits;
          return {
            claudeEdits,
            docs: { ...s.docs, [id]: doc },
            // No local edits: the panel simply shows the new content.
            drafts: conflict ? s.drafts : omit(s.drafts, id),
            conflicts: conflict ? { ...s.conflicts, [id]: true } : s.conflicts,
          };
        });
      const offMarkdown = window.plancia.markdown.onChanged(({ id, author, undone, ...doc }) =>
        changed(id, doc, author, undone),
      );
      const offFolder = window.plancia.folder.onFileChanged(
        ({ id, path, author, undone, ...doc }) =>
          changed(folderFileKey(id, path), doc, author, undone),
      );
      return () => {
        offMarkdown();
        offFolder();
      };
    },

    async load(id) {
      try {
        const doc = await backend(id).read();
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

    async undo(id) {
      const result = await backend(id).undo();
      if (!result.ok) set((s) => ({ errors: { ...s.errors, [id]: result.message } }));
    },

    dismissClaudeEdit(id) {
      set((s) => ({ claudeEdits: omit(s.claudeEdits, id) }));
    },

    async keepDraft(id) {
      set((s) => ({ conflicts: omit(s.conflicts, id) }));
      await save(id);
    },
  };
});
