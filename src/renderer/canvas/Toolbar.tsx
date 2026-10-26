import { Panel as FlowPanel, useReactFlow } from '@xyflow/react';
import { DEFAULT_PANEL_SIZES } from '@shared/panels';
import type { PanelType, TerminalMode } from '@shared/types';
import { Logo } from '../components/Logo';
import { PanelIcon } from '../panels/PanelIcon';
import { useWorkspaceStore } from '../stores/workspaceStore';

const CREATE_BUTTONS: { label: string; type: PanelType; mode?: TerminalMode }[] = [
  { label: 'Terminale', type: 'terminal', mode: 'shell' },
  { label: 'Claude', type: 'terminal', mode: 'claude' },
  { label: 'Markdown', type: 'markdown' },
  { label: 'Architettura', type: 'architecture' },
  { label: 'Codice', type: 'code' },
];

/** Spread consecutive new panels so they do not stack exactly on top of each other. */
const CASCADE = 32;

export function Toolbar() {
  const { screenToFlowPosition } = useReactFlow();
  const name = useWorkspaceStore((s) => s.snapshot?.name);
  const panelCount = useWorkspaceStore((s) => s.snapshot?.board.panels.length ?? 0);
  const dispatch = useWorkspaceStore((s) => s.dispatch);
  const openFolder = useWorkspaceStore((s) => s.openFolder);

  const create = (type: PanelType, mode?: TerminalMode) => {
    const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const size = DEFAULT_PANEL_SIZES[type];
    const offset = (panelCount % 5) * CASCADE;
    void dispatch({
      type: 'createPanel',
      panelType: type,
      position: {
        x: Math.round(center.x - size.width / 2 + offset),
        y: Math.round(center.y - size.height / 2 + offset),
      },
      ...(mode ? { mode } : {}),
    });
  };

  return (
    <FlowPanel position="top-left">
      <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/90 p-1 shadow-lg backdrop-blur">
        <button
          type="button"
          onClick={() => void openFolder()}
          title="Cambia cartella progetto"
          className="flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
        >
          <Logo className="h-6 w-6" />
          <span className="max-w-48 truncate">{name}</span>
        </button>
        <div className="mx-1 h-5 w-px bg-zinc-800" />
        {CREATE_BUTTONS.map(({ label, type, mode }) => (
          <button
            key={label}
            type="button"
            onClick={() => create(type, mode)}
            title={`Nuovo panel: ${label}`}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <PanelIcon type={type} mode={mode} />
            {label}
          </button>
        ))}
      </div>
    </FlowPanel>
  );
}
