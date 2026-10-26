import { memo, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { MIN_PANEL_SIZE } from '@shared/panels';
import { PANEL_DRAG_HANDLE, useWorkspaceStore, type PanelNode } from '../stores/workspaceStore';
import { PanelIcon } from './PanelIcon';
import { PanelPlaceholder } from './PanelPlaceholder';

function PanelMenu({ onRename, id }: { onRename: () => void; id: string }) {
  const dispatch = useWorkspaceStore((s) => s.dispatch);
  const [open, setOpen] = useState(false);

  const close = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
  };
  const item = 'block w-full px-3 py-1.5 text-left text-xs hover:bg-zinc-700';

  return (
    <div className="nodrag relative" onBlur={close}>
      <button
        type="button"
        aria-label="Menu del panel"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="rounded px-1.5 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100"
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-6 right-0 z-10 w-36 overflow-hidden rounded-md border border-zinc-700 bg-zinc-800 py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              onRename();
            }}
          >
            Rinomina
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              void dispatch({ type: 'duplicatePanel', id });
            }}
          >
            Duplica
          </button>
          <button
            type="button"
            role="menuitem"
            className={`${item} text-red-400`}
            onClick={() => {
              setOpen(false);
              void dispatch({ type: 'deletePanels', ids: [id] });
            }}
          >
            Elimina
          </button>
        </div>
      )}
    </div>
  );
}

function TitleEditor({ title, onDone }: { title: string; onDone: (next: string | null) => void }) {
  const [value, setValue] = useState(title);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') onDone(value);
    if (e.key === 'Escape') onDone(null);
  };
  return (
    <input
      autoFocus
      aria-label="Titolo del panel"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => onDone(value)}
      className="nodrag min-w-0 flex-1 rounded bg-zinc-800 px-1 text-sm text-zinc-100 outline-none ring-1 ring-blue-500"
    />
  );
}

function PanelNodeView({ id, data, selected }: NodeProps<PanelNode>) {
  const { panel } = data;
  const dispatch = useWorkspaceStore((s) => s.dispatch);
  const [renaming, setRenaming] = useState(false);

  const finishRename = (next: string | null) => {
    setRenaming(false);
    const title = next?.trim();
    if (title && title !== panel.title) void dispatch({ type: 'renamePanel', id, title });
  };

  return (
    <div
      className={`flex h-full w-full flex-col overflow-hidden rounded-lg border bg-zinc-900 shadow-xl shadow-black/40 ${
        selected ? 'border-blue-500' : 'border-zinc-700'
      }`}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={MIN_PANEL_SIZE.width}
        minHeight={MIN_PANEL_SIZE.height}
        color="#3b82f6"
        onResizeEnd={(_event, p) =>
          void dispatch({
            type: 'resizePanel',
            id,
            position: { x: p.x, y: p.y },
            size: { width: p.width, height: p.height },
          })
        }
      />
      <header
        className={`${PANEL_DRAG_HANDLE} flex h-9 shrink-0 cursor-grab items-center gap-2 border-b border-zinc-800 bg-zinc-900/80 px-2 active:cursor-grabbing`}
      >
        <PanelIcon type={panel.type} mode={panel.type === 'terminal' ? panel.mode : undefined} />
        {renaming ? (
          <TitleEditor title={panel.title} onDone={finishRename} />
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm text-zinc-200" title={panel.title}>
            {panel.title}
          </span>
        )}
        <PanelMenu id={id} onRename={() => setRenaming(true)} />
      </header>
      <div className="nodrag nowheel nopan min-h-0 flex-1 overflow-auto p-3">
        <PanelPlaceholder panel={panel} />
      </div>
    </div>
  );
}

export const PanelNodeComponent = memo(PanelNodeView);
