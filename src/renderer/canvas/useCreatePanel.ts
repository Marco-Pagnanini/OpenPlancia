import { useReactFlow } from '@xyflow/react';
import { useCallback } from 'react';
import { DEFAULT_PANEL_SIZES } from '@shared/panels';
import type { PanelType, Position, TerminalMode } from '@shared/types';
import { useWorkspaceStore } from '../stores/workspaceStore';

/** Spread consecutive new panels so they do not stack exactly on top of each other. */
const CASCADE = 32;

/** Top-left position that centres a new panel of `type` in the visible canvas. */
function useNewPanelPosition() {
  const { screenToFlowPosition } = useReactFlow();
  return useCallback(
    (type: PanelType): Position => {
      const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      const size = DEFAULT_PANEL_SIZES[type];
      const count = useWorkspaceStore.getState().snapshot?.board.panels.length ?? 0;
      const offset = (count % 5) * CASCADE;
      return {
        x: Math.round(center.x - size.width / 2 + offset),
        y: Math.round(center.y - size.height / 2 + offset),
      };
    },
    [screenToFlowPosition],
  );
}

/** Creates a terminal, architecture or code panel centred in the visible canvas. */
export function useCreatePanel() {
  const position = useNewPanelPosition();
  const dispatch = useWorkspaceStore((s) => s.dispatch);

  return useCallback(
    (type: Exclude<PanelType, 'markdown' | 'folder'>, mode?: TerminalMode) => {
      void dispatch({
        type: 'createPanel',
        panelType: type,
        position: position(type),
        ...(mode ? { mode } : {}),
      });
    },
    [dispatch, position],
  );
}

/** Markdown panels need a file: the main process asks for it with a native dialog. */
export function useCreateMarkdownPanel() {
  const position = useNewPanelPosition();
  return useCallback(
    async (mode: 'new' | 'open') => {
      const result = await window.plancia.markdown.create({ mode, position: position('markdown') });
      if (result.status === 'error') useWorkspaceStore.setState({ error: result.message });
    },
    [position],
  );
}

/** Folder panels need a folder of the project: the main process asks with a native dialog. */
export function useCreateFolderPanel() {
  const position = useNewPanelPosition();
  return useCallback(async () => {
    const result = await window.plancia.folder.create({ position: position('folder') });
    if (result.status === 'error') useWorkspaceStore.setState({ error: result.message });
  }, [position]);
}
