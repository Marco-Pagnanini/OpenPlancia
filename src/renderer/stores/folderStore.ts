import { create } from 'zustand';
import type { FolderIndex } from '@shared/ipc';

interface FolderStoreState {
  /** File list of each folder panel, kept current by the main process. */
  indexes: Record<string, FolderIndex>;
  /** File shown by each folder panel (relative to the folder). */
  selected: Record<string, string>;
  errors: Record<string, string>;
  init(): () => void;
  load(id: string): Promise<void>;
  select(id: string, path: string): void;
}

/** Folder panels (M6.5). The files' contents live in markdownStore, keyed by folderFileKey. */
export const useFolderStore = create<FolderStoreState>()((set) => ({
  indexes: {},
  selected: {},
  errors: {},

  init() {
    return window.plancia.folder.onIndex(({ id, index }) =>
      set((s) => ({ indexes: { ...s.indexes, [id]: index } })),
    );
  },

  async load(id) {
    try {
      const index = await window.plancia.folder.index(id);
      set((s) => ({ indexes: { ...s.indexes, [id]: index } }));
    } catch (err) {
      set((s) => ({
        errors: { ...s.errors, [id]: err instanceof Error ? err.message : String(err) },
      }));
    }
  },

  select(id, path) {
    set((s) => ({ selected: { ...s.selected, [id]: path } }));
  },
}));
