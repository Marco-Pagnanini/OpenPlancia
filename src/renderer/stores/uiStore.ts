import { create } from 'zustand';

export type Tool = 'select' | 'hand';

interface UiState {
  tool: Tool;
  /** Panel shown full screen at 100% scale, if any. */
  focusId: string | null;
  /** Terminal whose activity timeline is open in the side panel. */
  activityId: string | null;
  /** The "Markdown" tool menu (new / open file) is open. */
  markdownMenu: boolean;
  setTool(tool: Tool): void;
  setMarkdownMenu(open: boolean): void;
  setFocus(id: string | null): void;
  setActivity(id: string | null): void;
}

/** Purely visual state that never reaches the main process. */
export const useUiStore = create<UiState>()((set) => ({
  tool: 'select',
  focusId: null,
  activityId: null,
  markdownMenu: false,
  setTool: (tool) => set({ tool }),
  setMarkdownMenu: (markdownMenu) => set({ markdownMenu }),
  setFocus: (focusId) => set({ focusId }),
  setActivity: (activityId) => set({ activityId }),
}));
