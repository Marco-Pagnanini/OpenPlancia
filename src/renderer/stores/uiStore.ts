import { create } from 'zustand';

export type Tool = 'select' | 'hand';

interface UiState {
  tool: Tool;
  /** Panel shown full screen at 100% scale, if any. */
  focusId: string | null;
  setTool(tool: Tool): void;
  setFocus(id: string | null): void;
}

/** Purely visual state that never reaches the main process. */
export const useUiStore = create<UiState>()((set) => ({
  tool: 'select',
  focusId: null,
  setTool: (tool) => set({ tool }),
  setFocus: (focusId) => set({ focusId }),
}));
