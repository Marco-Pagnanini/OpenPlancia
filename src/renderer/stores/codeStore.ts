import { create } from 'zustand';
import type { CodeFeedEntry, CodeFile } from '@shared/ipc';

interface FileState {
  file?: CodeFile | undefined;
  error?: string | undefined;
}

interface CodeState {
  /** Files Claude changed, most recent first (shared by every Code panel). */
  feed: CodeFeedEntry[];
  /** Files read for the Code panels, by project-relative path. */
  files: Record<string, FileState>;
  /** File chosen by hand in each Code panel; without it the panel shows the latest change. */
  selected: Record<string, string>;
  init(): () => void;
  load(path: string): Promise<void>;
  select(panelId: string, path: string | null): void;
}

/** Code panels (M7): the feed of changed files and the files on screen, kept current. */
export const useCodeStore = create<CodeState>()((set, get) => ({
  feed: [],
  files: {},
  selected: {},

  init() {
    void window.plancia.code.feed().then((feed) => set({ feed }));
    const offFeed = window.plancia.code.onFeed((feed) => {
      const before = new Map(get().feed.map((e) => [e.path, e.at]));
      set({ feed });
      // A file already on screen that Claude changed again: read it anew.
      for (const entry of feed) {
        if (before.get(entry.path) !== entry.at && get().files[entry.path]) {
          void get().load(entry.path);
        }
      }
    });
    const offFile = window.plancia.code.onFileChanged(({ path }) => void get().load(path));
    return () => {
      offFeed();
      offFile();
    };
  },

  async load(path) {
    try {
      const file = await window.plancia.code.read(path);
      set((s) => ({ files: { ...s.files, [path]: { file } } }));
    } catch (err) {
      set((s) => ({
        files: {
          ...s.files,
          [path]: { error: err instanceof Error ? err.message : String(err) },
        },
      }));
    }
  },

  select(panelId, path) {
    set((s) => ({
      selected: path
        ? { ...s.selected, [panelId]: path }
        : Object.fromEntries(Object.entries(s.selected).filter(([id]) => id !== panelId)),
    }));
  },
}));
