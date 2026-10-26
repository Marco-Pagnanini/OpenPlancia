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
import { agentPairs, wirePairs, type AgentPair, type WirePair } from '@shared/access';
import type { BoardIntent, Panel, WorkspaceSnapshot } from '@shared/types';
import { AGENT_COLOR, WIRE_COLORS, wireKind } from '../canvas/wireStyle';
import { terminalRegistry } from '../panels/terminal/terminalRegistry';

export type PanelNode = Node<{ panel: Panel }, 'panel'>;
export type WireEdge = Edge<{ pair: WirePair }, 'wire'>;
/** Arrows between two Claude terminals: who may message whom (M8). */
export type AgentEdge = Edge<{ agents: AgentPair }, 'agent'>;
export type BoardEdge = WireEdge | AgentEdge;

interface WorkspaceState {
  /** Mirror of the main process state; never edited locally. */
  snapshot: WorkspaceSnapshot | null;
  loaded: boolean;
  error: string | null;
  /** React Flow nodes: derived from the snapshot plus transient UI state (selection, drag). */
  nodes: PanelNode[];
  /**
   * One wire per terminal ↔ panel pair (read + write share a purple double-headed wire), and one
   * per pair of Claude terminals that may message each other.
   */
  edges: BoardEdge[];
  init(): () => void;
  openFolder(): Promise<void>;
  /** Back to the home screen; asks first if terminals would be closed. */
  goHome(): Promise<void>;
  openRecent(path: string): Promise<void>;
  dispatch(intent: BoardIntent): Promise<boolean>;
  applyNodeChanges(changes: NodeChange<PanelNode>[]): void;
  applyEdgeChanges(changes: EdgeChange<BoardEdge>[]): void;
  clearError(): void;
}

export const PANEL_DRAG_HANDLE = 'panel-drag-handle';

/** Wires leave from the side facing the other panel. */
function toAgentEdges(snapshot: WorkspaceSnapshot, selected: Set<string>): AgentEdge[] {
  const { panels, connections } = snapshot.board;
  const byId = new Map(panels.map((p) => [p.id, p]));
  const center = (p: Panel) => p.position.x + p.size.width / 2;
  const marker = { type: MarkerType.ArrowClosed, color: AGENT_COLOR, width: 16, height: 16 };
  return agentPairs(panels, connections).flatMap((agents) => {
    // The arrow points from the agent that writes to the one that receives.
    const [from, to] = agents.bToA && !agents.aToB ? [agents.b, agents.a] : [agents.a, agents.b];
    const source = byId.get(from);
    const target = byId.get(to);
    if (!source || !target) return [];
    const leftToRight = center(source) <= center(target);
    return [
      {
        id: agents.key,
        type: 'agent' as const,
        source: source.id,
        target: target.id,
        sourceHandle: leftToRight ? 'r' : 'l',
        targetHandle: leftToRight ? 'l' : 'r',
        data: { agents },
        selected: selected.has(agents.key),
        markerEnd: marker,
        ...(agents.aToB && agents.bToA ? { markerStart: marker } : {}),
      },
    ];
  });
}

function toEdges(snapshot: WorkspaceSnapshot, previous: BoardEdge[]): BoardEdge[] {
  const { panels, connections } = snapshot.board;
  const byId = new Map(panels.map((p) => [p.id, p]));
  const selected = new Set(previous.filter((e) => e.selected).map((e) => e.id));
  const center = (p: Panel) => p.position.x + p.size.width / 2;
  const wires: WireEdge[] = wirePairs(panels, connections).flatMap((pair): WireEdge[] => {
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
  return [...wires, ...toAgentEdges(snapshot, selected)];
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

    async goHome() {
      const live = (get().snapshot?.board.panels ?? []).filter(
        (p) => p.type === 'terminal' && p.status !== 'not-started' && p.status !== 'exited',
      );
      const what = live.length === 1 ? 'il terminale aperto' : `i ${live.length} terminali aperti`;
      if (
        live.length > 0 &&
        !window.confirm(
          `Tornare alla schermata iniziale chiude ${what} in questa lavagna. Continuare?`,
        )
      ) {
        return;
      }
      await window.plancia.workspace.close();
    },

    async openRecent(path) {
      const result = await window.plancia.workspace.openRecent(path);
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
