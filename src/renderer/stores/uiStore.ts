import { create } from 'zustand';

export type Tool = 'select' | 'hand';

interface UiState {
  tool: Tool;
  setTool(tool: Tool): void;
}

/** Purely visual state that never reaches the main process. */
export const useUiStore = create<UiState>()((set) => ({
  tool: 'select',
  setTool: (tool) => set({ tool }),
}));
