import {
  applyEdgeChanges,
  applyNodeChanges,
  MarkerType,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import { create } from 'zustand';
import { wirePairs, type WirePair } from '@shared/access';
import type { BoardIntent, Panel, WorkspaceSnapshot } from '@shared/types';
import { WIRE_COLORS, wireKind } from '../canvas/wireStyle';
import { terminalRegistry } from '../panels/terminal/terminalRegistry';

export type PanelNode = Node<{ panel: Panel }, 'panel'>;
export type WireEdge = Edge<{ pair: WirePair }, 'wire'>;

interface WorkspaceState {
  /** Mirror of the main process state; never edited locally. */
  snapshot: WorkspaceSnapshot | null;
  loaded: boolean;
  error: string | null;
  /** React Flow nodes: derived from the snapshot plus transient UI state (selection, drag). */
  nodes: PanelNode[];
  /** One wire per terminal ↔ panel pair (read + write share a purple double-headed wire). */
  edges: WireEdge[];
  init(): () => void;
  openFolder(): Promise<void>;
  dispatch(intent: BoardIntent): Promise<boolean>;
  applyNodeChanges(changes: NodeChange<PanelNode>[]): void;
  applyEdgeChanges(changes: EdgeChange<WireEdge>[]): void;
  clearError(): void;
}

export const PANEL_DRAG_HANDLE = 'panel-drag-handle';

/** Wires leave from the side facing the other panel. */
function toEdges(snapshot: WorkspaceSnapshot, previous: WireEdge[]): WireEdge[] {
  const { panels, connections } = snapshot.board;
  const byId = new Map(panels.map((p) => [p.id, p]));
  const selected = new Set(previous.filter((e) => e.selected).map((e) => e.id));
  const center = (p: Panel) => p.position.x + p.size.width / 2;
  return wirePairs(panels, connections).flatMap((pair) => {
    const terminal = byId.get(pair.terminalId);
    const panel = byId.get(pair.panelId);
    if (!terminal || !panel) return [];
    // The arrow points where the data goes: read = panel → Claude, write = Claude → panel.
    const [source, target] = pair.write && !pair.read ? [terminal, panel] : [panel, terminal];
    const leftToRight = center(source) <= center(target);
    return [
      {
        id: pair.key,
        type: 'wire',
        source: source.id,
        target: target.id,
        sourceHandle: leftToRight ? 'r' : 'l',
        targetHandle: leftToRight ? 'l' : 'r',
        data: { pair },
        selected: selected.has(pair.key),
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: WIRE_COLORS[wireKind(pair)],
          width: 16,
          height: 16,
        },
        ...(pair.read && pair.write
          ? {
              markerStart: {
                type: MarkerType.ArrowClosed,
                color: WIRE_COLORS.both,
                width: 16,
                height: 16,
              },
            }
          : {}),
      },
    ];
  });
}

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
  const receive = (snapshot: WorkspaceSnapshot | null) => {
    terminalRegistry.retain(
      new Set(snapshot?.board.panels.filter((p) => p.type === 'terminal').map((p) => p.id)),
    );
    set((state) => ({
      snapshot,
      loaded: true,
      nodes: snapshot ? toNodes(snapshot.board.panels, state.nodes) : [],
      edges: snapshot ? toEdges(snapshot, state.edges) : [],
    }));
  };

  return {
    snapshot: null,
    loaded: false,
    error: null,
    nodes: [],
    edges: [],

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

    applyEdgeChanges(changes) {
      // Only selection is local; removal goes through onEdgesDelete → disconnect.
      const local = changes.filter((c) => c.type === 'select');
      if (local.length === 0) return;
      set((state) => ({ edges: applyEdgeChanges(local, state.edges) }));
    },

    clearError() {
      set({ error: null });
    },
  };
});
