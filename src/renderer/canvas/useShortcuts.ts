import { useReactFlow } from '@xyflow/react';
import { useEffect } from 'react';
import { useUiStore } from '../stores/uiStore';
import { TOOL_ITEMS } from './tools';
import { useCreatePanel } from './useCreatePanel';

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/** Single-key shortcuts from the tool rail, plus Esc and 0 (fit). */
export function useShortcuts() {
  const setTool = useUiStore((s) => s.setTool);
  const createPanel = useCreatePanel();
  const { fitView } = useReactFlow();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTyping(e.target)) return;
      if (e.key === 'Escape') return setTool('select');
      if (e.key === '0') return void fitView({ duration: 200, maxZoom: 1 });
      const item = TOOL_ITEMS.find((t) => t.kind !== 'separator' && t.key === e.key.toUpperCase());
      if (!item || item.kind === 'separator') return;
      e.preventDefault();
      if (item.kind === 'mode') setTool(item.tool);
      else createPanel(item.type, item.mode);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [createPanel, fitView, setTool]);
}
