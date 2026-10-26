import { create } from 'zustand';

export type Tool = 'select' | 'hand';

export interface Toast {
  id: number;
  message: string;
}

interface UiState {
  tool: Tool;
  /** Panel shown full screen at 100% scale, if any. */
  focusId: string | null;
  /** Terminal whose activity timeline is open in the side panel. */
  activityId: string | null;
  /** Wire (terminal|panel key) open in the arrow inspector. */
  wireKey: string | null;
  /** Terminal whose manifest is shown in "Cosa vede Claude". */
  manifestFor: string | null;
  /** Architecture panel whose JSON is shown ("Vedi JSON"). */
  archJsonFor: string | null;
  /** The "Markdown" tool menu (new / open file) is open. */
  markdownMenu: boolean;
  toast: Toast | null;
  setTool(tool: Tool): void;
  setMarkdownMenu(open: boolean): void;
  setFocus(id: string | null): void;
  /** The activity timeline and the arrow inspector share the right side: one at a time. */
  setActivity(id: string | null): void;
  setWire(key: string | null): void;
  setManifestFor(id: string | null): void;
  setArchJsonFor(id: string | null): void;
  showToast(message: string): void;
  hideToast(id: number): void;
}

const TOAST_MS = 3500;
let toastSeq = 0;

/** Purely visual state that never reaches the main process. */
export const useUiStore = create<UiState>()((set) => ({
  tool: 'select',
  focusId: null,
  activityId: null,
  wireKey: null,
  manifestFor: null,
  archJsonFor: null,
  markdownMenu: false,
  toast: null,
  setTool: (tool) => set({ tool }),
  setMarkdownMenu: (markdownMenu) => set({ markdownMenu }),
  setFocus: (focusId) => set({ focusId }),
  setActivity: (activityId) => set(activityId ? { activityId, wireKey: null } : { activityId }),
  setWire: (wireKey) => set(wireKey ? { wireKey, activityId: null } : { wireKey }),
  setManifestFor: (manifestFor) => set({ manifestFor }),
  setArchJsonFor: (archJsonFor) => set({ archJsonFor }),
  showToast: (message) => {
    const id = ++toastSeq;
    set({ toast: { id, message } });
    setTimeout(() => set((s) => (s.toast?.id === id ? { toast: null } : s)), TOAST_MS);
  },
  hideToast: (id) => set((s) => (s.toast?.id === id ? { toast: null } : s)),
}));
