import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MiniMap,
  ReactFlow,
  type Connection,
  type EdgeTypes,
  type NodeTypes,
  type OnConnectEnd,
  type OnNodeDrag,
} from '@xyflow/react';
import { useCallback, useState } from 'react';
import { checkConnection } from '@shared/access';
import { InfoToast } from '../components/InfoToast';
import { ActivityPanel } from '../inspectors/ActivityPanel';
import { ArchJsonModal } from '../inspectors/ArchJsonModal';
import { ManifestModal } from '../inspectors/ManifestModal';
import { WireInspector } from '../inspectors/WireInspector';
import { PanelNodeComponent } from '../panels/PanelNode';
import { confirmDelete } from '../panels/panelMeta';
import { useUiStore } from '../stores/uiStore';
import { useWorkspaceStore, type PanelNode, type WireEdge } from '../stores/workspaceStore';
import { FocusOverlay } from './FocusOverlay';
import { TOOL_HINTS } from './tools';
import { ToolRail } from './ToolRail';
import { TopBar } from './TopBar';
import { useShortcuts } from './useShortcuts';
import { WireEdgeComponent } from './WireEdge';
import { ZoomControls } from './ZoomControls';

const nodeTypes: NodeTypes = { panel: PanelNodeComponent };
const edgeTypes: EdgeTypes = { wire: WireEdgeComponent };

/** Arrow rules checked against the main-process board (the main checks them again). */
function check(source: string | null, target: string | null) {
  const board = useWorkspaceStore.getState().snapshot?.board;
  const panels = board?.panels ?? [];
  return checkConnection(
    panels.find((p) => p.id === source),
    panels.find((p) => p.id === target),
    board?.connections ?? [],
  );
}
const DELETE_KEYS = ['Backspace', 'Delete'];

function Hint() {
  const hint = useUiStore((s) => TOOL_HINTS[s.tool]);
  if (!hint) return null;
  return (
    <div className="pointer-events-none absolute bottom-[18px] left-1/2 z-10 -translate-x-1/2 rounded-full border border-line bg-chrome px-3.5 py-2 text-[12.5px] whitespace-nowrap text-ink-2">
      {hint}
    </div>
  );
}

export function Canvas() {
  // Only the viewport saved at open time matters: afterwards React Flow owns it.
  const [initialViewport] = useState(() => useWorkspaceStore.getState().snapshot?.board.viewport);
  const nodes = useWorkspaceStore((s) => s.nodes);
  const applyChanges = useWorkspaceStore((s) => s.applyNodeChanges);
  const dispatch = useWorkspaceStore((s) => s.dispatch);
  const hand = useUiStore((s) => s.tool === 'hand');
  useShortcuts();

  const onNodeDragStop: OnNodeDrag<PanelNode> = useCallback(
    (_event, _node, dragged) => {
      void dispatch({
        type: 'movePanels',
        moves: dragged.map((n) => ({
          id: n.id,
          position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        })),
      });
    },
    [dispatch],
  );

  const onNodesDelete = useCallback(
    (deleted: PanelNode[]) =>
      void dispatch({ type: 'deletePanels', ids: deleted.map((n) => n.id) }),
    [dispatch],
  );

  const edges = useWorkspaceStore((s) => s.edges);
  const applyEdgeChanges = useWorkspaceStore((s) => s.applyEdgeChanges);
  const showToast = useUiStore((s) => s.showToast);
  const setWire = useUiStore((s) => s.setWire);

  const onConnect = useCallback(
    async ({ source, target }: Connection) => {
      if (await dispatch({ type: 'connect', source, target })) {
        showToast('Claude vedrà questo collegamento al prossimo messaggio');
      }
    },
    [dispatch, showToast],
  );

  // Dropped on a panel that refuses the arrow: say why (e.g. "Multi-agente: in arrivo").
  const onConnectEnd: OnConnectEnd = useCallback(
    (_event, state) => {
      if (!state.fromNode || !state.toNode || state.fromNode.id === state.toNode.id) return;
      const result = check(state.fromNode.id, state.toNode.id);
      if (!result.ok) showToast(result.message);
    },
    [showToast],
  );

  const onEdgesDelete = useCallback(
    (deleted: WireEdge[]) => {
      const ids = deleted.flatMap((e) => e.data?.pair.connectionIds ?? []);
      if (ids.length > 0) void dispatch({ type: 'disconnect', ids });
    },
    [dispatch],
  );

  return (
    <div className={`relative h-full w-full ${hand ? '[&_.react-flow__pane]:cursor-grab' : ''}`}>
      <ReactFlow<PanelNode, WireEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onEdgesChange={applyEdgeChanges}
        onEdgesDelete={onEdgesDelete}
        onEdgeClick={(_event, edge) => setWire(edge.id)}
        onConnect={(connection) => void onConnect(connection)}
        onConnectEnd={onConnectEnd}
        isValidConnection={(c) => check(c.source, c.target).ok}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={36}
        onNodesChange={applyChanges}
        onNodeDragStop={onNodeDragStop}
        onNodesDelete={onNodesDelete}
        onBeforeDelete={({ nodes: doomed }) =>
          Promise.resolve(confirmDelete(doomed.map((n) => n.data.panel)))
        }
        onMoveEnd={(_event, viewport) => void dispatch({ type: 'setViewport', viewport })}
        {...(initialViewport ? { defaultViewport: initialViewport } : { fitView: true })}
        fitViewOptions={{ maxZoom: 1 }}
        minZoom={0.1}
        maxZoom={2}
        // Wheel and two-finger scroll pan; pinch or Ctrl + wheel zooms (as in the design).
        panOnScroll
        zoomOnPinch
        nodesDraggable={!hand}
        elementsSelectable={!hand}
        deleteKeyCode={DELETE_KEYS}
        nodesConnectable={!hand}
        colorMode="dark"
        attributionPosition="bottom-left"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1.2}
          color="var(--color-line-strong)"
        />
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          nodeBorderRadius={4}
          className="!mr-4 !mb-[64px] overflow-hidden rounded-[10px] border border-line"
          style={{ width: 180, height: 120 }}
        />
      </ReactFlow>
      <TopBar />
      <ToolRail />
      <ZoomControls />
      <Hint />
      <ActivityPanel />
      <WireInspector />
      <InfoToast />
      <FocusOverlay />
      <ManifestModal />
      <ArchJsonModal />
    </div>
  );
}
