import { applyNodeChanges, type Node, type NodeChange } from '@xyflow/react';
import { create } from 'zustand';
import type { BoardIntent, Panel, WorkspaceSnapshot } from '@shared/types';

export type PanelNode = Node<{ panel: Panel }, 'panel'>;

interface WorkspaceState {
  /** Mirror of the main process state; never edited locally. */
  snapshot: WorkspaceSnapshot | null;
  loaded: boolean;
  error: string | null;
  /** React Flow nodes: derived from the snapshot plus transient UI state (selection, drag). */
  nodes: PanelNode[];
  init(): () => void;
  openFolder(): Promise<void>;
  dispatch(intent: BoardIntent): Promise<boolean>;
  applyNodeChanges(changes: NodeChange<PanelNode>[]): void;
  clearError(): void;
}

export const PANEL_DRAG_HANDLE = 'panel-drag-handle';

function toNodes(panels: Panel[], previous: PanelNode[]): PanelNode[] {
  const prev = new Map(previous.map((n) => [n.id, n]));
  return panels.map((panel) => {
    const old = prev.get(panel.id);
    const dragging = old?.dragging === true;
    return {
      id: panel.id,
      type: 'panel',
      // Keep the local position while the user is still dragging this node.
      position: dragging ? old.position : panel.position,
      width: panel.size.width,
      height: panel.size.height,
      data: { panel },
      dragHandle: `.${PANEL_DRAG_HANDLE}`,
      selected: old?.selected ?? false,
      dragging,
    };
  });
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => {
  const receive = (snapshot: WorkspaceSnapshot | null) =>
    set((state) => ({
      snapshot,
      loaded: true,
      nodes: snapshot ? toNodes(snapshot.board.panels, state.nodes) : [],
    }));

  return {
    snapshot: null,
    loaded: false,
    error: null,
    nodes: [],

    init() {
      const unsubscribe = window.plancia.workspace.onState(receive);
      void window.plancia.workspace.get().then(receive);
      return unsubscribe;
    },

    async openFolder() {
      const result = await window.plancia.workspace.openDialog();
      if (result.status === 'error') set({ error: result.message });
    },

    async dispatch(intent) {
      if (!get().snapshot) return false;
      const result = await window.plancia.board.dispatch(intent);
      if (!result.ok) set({ error: result.error });
      return result.ok;
    },

    applyNodeChanges(changes) {
      // Removals go through the main process (onNodesDelete); everything else is transient UI state.
      const local = changes.filter((c) => c.type !== 'remove' && c.type !== 'add');
      if (local.length === 0) return;
      set((state) => ({ nodes: applyNodeChanges(local, state.nodes) }));
    },

    clearError() {
      set({ error: null });
    },
  };
});
