import { CornersInIcon } from '@phosphor-icons/react';
import { useEffect } from 'react';
import { PanelIcon } from '../panels/PanelIcon';
import { panelKindLabel } from '../panels/panelMeta';
import { ClaudeHeaderExtras, PanelContent } from '../panels/PanelNode';
import { StatusBadge } from '../panels/StatusBadge';
import { terminalRegistry } from '../panels/terminal/terminalRegistry';
import { useUiStore } from '../stores/uiStore';
import { useWorkspaceStore } from '../stores/workspaceStore';

/**
 * Focus mode: one panel full screen above the canvas at 100% scale. Esc leaves it, except
 * while typing in a terminal (vim, Claude and friends need Esc themselves).
 */
export function FocusOverlay() {
  const focusId = useUiStore((s) => s.focusId);
  const setFocus = useUiStore((s) => s.setFocus);
  const panel = useWorkspaceStore((s) => s.snapshot?.board.panels.find((p) => p.id === focusId));

  useEffect(() => {
    if (focusId && !panel) setFocus(null);
  }, [focusId, panel, setFocus]);

  useEffect(() => {
    terminalRegistry.setFocusMode(focusId);
    if (!focusId) return;
    if (panel?.type === 'terminal') requestAnimationFrame(() => terminalRegistry.focus(focusId));
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (e.target instanceof Element && e.target.closest('.xterm')) return;
      setFocus(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // panel.type is stable for a given id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, setFocus]);

  if (!panel) return null;

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-canvas/80 p-4 pt-[64px] backdrop-blur-[2px]">
      <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-line-strong bg-panel shadow-[0_24px_60px_rgba(0,0,0,.55)]">
        <header
          onDoubleClick={() => setFocus(null)}
          className="flex h-9 shrink-0 items-center gap-2 rounded-t-[11px] border-b border-line-soft bg-panel-head pr-2 pl-3"
        >
          <PanelIcon
            type={panel.type}
            mode={panel.type === 'terminal' ? panel.mode : undefined}
            className="text-ink-3"
          />
          <span className="min-w-0 truncate font-mono text-[12.5px] font-medium text-ink">
            {panel.title}
          </span>
          <span className="shrink-0 text-[11px] text-ink-4">{panelKindLabel(panel)}</span>
          <div className="min-w-2 flex-1" />
          <ClaudeHeaderExtras panel={panel} />
          <StatusBadge panel={panel} />
          <button
            type="button"
            onClick={() => setFocus(null)}
            className="flex h-6 items-center gap-1.5 rounded-md px-2 text-xs text-ink-3 hover:bg-line-soft hover:text-ink"
          >
            <CornersInIcon size={13} />
            Esci
            <kbd className="rounded border border-line-kbd px-1 font-mono text-[10.5px] text-ink-4">
              Esc
            </kbd>
          </button>
        </header>
        <div className="nokey min-h-0 flex-1 overflow-hidden rounded-b-[11px]">
          <PanelContent panel={panel} variant="focus" />
        </div>
      </div>
    </div>
  );
}
