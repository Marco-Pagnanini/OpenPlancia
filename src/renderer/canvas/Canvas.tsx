import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type NodeTypes,
  type OnNodeDrag,
} from '@xyflow/react';
import { useCallback, useState } from 'react';
import { PanelNodeComponent } from '../panels/PanelNode';
import { useWorkspaceStore, type PanelNode } from '../stores/workspaceStore';
import { Toolbar } from './Toolbar';

const nodeTypes: NodeTypes = { panel: PanelNodeComponent };
const DELETE_KEYS = ['Backspace', 'Delete'];

export function Canvas() {
  // Only the viewport saved at open time matters: afterwards React Flow owns it.
  const [initialViewport] = useState(() => useWorkspaceStore.getState().snapshot?.board.viewport);
  const nodes = useWorkspaceStore((s) => s.nodes);
  const applyChanges = useWorkspaceStore((s) => s.applyNodeChanges);
  const dispatch = useWorkspaceStore((s) => s.dispatch);

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
    <ReactFlow<PanelNode>
      nodes={nodes}
      edges={[]}
      nodeTypes={nodeTypes}
      onNodesChange={applyChanges}
      onNodeDragStop={onNodeDragStop}
      onNodesDelete={onNodesDelete}
      onMoveEnd={(_event, viewport) => void dispatch({ type: 'setViewport', viewport })}
      {...(initialViewport ? { defaultViewport: initialViewport } : { fitView: true })}
      fitViewOptions={{ maxZoom: 1 }}
      minZoom={0.1}
      maxZoom={2}
      deleteKeyCode={DELETE_KEYS}
      nodesConnectable={false}
      colorMode="dark"
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#3f3f46" />
      <MiniMap pannable zoomable nodeColor="#3f3f46" maskColor="rgb(9 9 11 / 0.7)" />
      <Controls showInteractive={false} />
      <Toolbar />
    </ReactFlow>
  );
}
