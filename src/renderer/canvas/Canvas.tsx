import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  type NodeTypes,
  type OnNodeDrag,
} from '@xyflow/react';
import { useCallback, useState } from 'react';
import { ActivityPanel } from '../inspectors/ActivityPanel';
import { PanelNodeComponent } from '../panels/PanelNode';
import { confirmDelete } from '../panels/panelMeta';
import { useUiStore } from '../stores/uiStore';
import { useWorkspaceStore, type PanelNode } from '../stores/workspaceStore';
import { FocusOverlay } from './FocusOverlay';
import { TOOL_HINTS } from './tools';
import { ToolRail } from './ToolRail';
import { TopBar } from './TopBar';
import { useShortcuts } from './useShortcuts';
import { ZoomControls } from './ZoomControls';

const nodeTypes: NodeTypes = { panel: PanelNodeComponent };
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

  return (
    <div className={`relative h-full w-full ${hand ? '[&_.react-flow__pane]:cursor-grab' : ''}`}>
      <ReactFlow<PanelNode>
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
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
        nodesConnectable={false}
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
      <FocusOverlay />
    </div>
  );
}
