import { useReactFlow } from '@xyflow/react';
import { useCallback } from 'react';
import { DEFAULT_PANEL_SIZES } from '@shared/panels';
import type { PanelType, TerminalMode } from '@shared/types';
import { useWorkspaceStore } from '../stores/workspaceStore';

/** Spread consecutive new panels so they do not stack exactly on top of each other. */
const CASCADE = 32;

/** Creates a panel centred in the visible part of the canvas. */
export function useCreatePanel() {
  const { screenToFlowPosition } = useReactFlow();
  const dispatch = useWorkspaceStore((s) => s.dispatch);

  return useCallback(
    (type: PanelType, mode?: TerminalMode) => {
      const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      const size = DEFAULT_PANEL_SIZES[type];
      const count = useWorkspaceStore.getState().snapshot?.board.panels.length ?? 0;
      const offset = (count % 5) * CASCADE;
      void dispatch({
        type: 'createPanel',
        panelType: type,
        position: {
          x: Math.round(center.x - size.width / 2 + offset),
          y: Math.round(center.y - size.height / 2 + offset),
        },
        ...(mode ? { mode } : {}),
      });
    },
    [dispatch, screenToFlowPosition],
  );
}
