import { DotsThreeIcon, XIcon } from '@phosphor-icons/react';
import { memo, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { MIN_PANEL_SIZE } from '@shared/panels';
import type { Panel } from '@shared/types';
import { useUiStore } from '../stores/uiStore';
import { PANEL_DRAG_HANDLE, useWorkspaceStore, type PanelNode } from '../stores/workspaceStore';
import { PanelIcon } from './PanelIcon';
import { PanelPlaceholder } from './PanelPlaceholder';
import { STATUS_LABEL, panelKindLabel } from './panelMeta';

const ICON_BUTTON =
  'nodrag grid size-6 place-items-center rounded-md text-ink-5 hover:bg-line-soft hover:text-ink';

function PanelMenu({ id, onRename }: { id: string; onRename: () => void }) {
  const dispatch = useWorkspaceStore((s) => s.dispatch);
  const [open, setOpen] = useState(false);

  const close = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
  };
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  const base = 'flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[12.5px]';
  const item = `${base} text-ink-2 hover:bg-hover hover:text-ink`;

  return (
    <div className="relative" onBlur={close}>
      <button
        type="button"
        aria-label="Menu del panel"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={ICON_BUTTON}
      >
        <DotsThreeIcon size={15} weight="bold" />
      </button>
      {open && (
        <div
          role="menu"
          className="nodrag absolute top-7 right-0 z-10 w-40 rounded-[10px] border border-line-strong bg-chrome p-1 shadow-[0_24px_60px_rgba(0,0,0,.55)]"
        >
          <button type="button" role="menuitem" className={item} onClick={run(onRename)}>
            Rinomina
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={run(() => void dispatch({ type: 'duplicatePanel', id }))}
          >
            Duplica
          </button>
          <div className="mx-1 my-1 h-px bg-line-soft" />
          <button
            type="button"
            role="menuitem"
            className={`${base} text-danger hover:bg-accent/12`}
            onClick={run(() => void dispatch({ type: 'deletePanels', ids: [id] }))}
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
      className="nodrag min-w-0 flex-1 rounded-md bg-canvas px-1.5 py-0.5 font-mono text-[12.5px] text-ink outline-none ring-1 ring-accent"
    />
  );
}

function StatusBadge({ panel }: { panel: Panel }) {
  if (panel.type !== 'terminal') return null;
  const live = panel.status === 'working';
  return (
    <span
      className={`flex shrink-0 items-center gap-1.5 rounded-full px-[9px] py-[3px] text-[11px] whitespace-nowrap ${
        live ? 'bg-accent/13 text-accent-soft' : 'bg-hover text-ink-3'
      }`}
    >
      {live && <span className="size-1.5 animate-pulse-dot rounded-full bg-accent" />}
      {STATUS_LABEL[panel.status]}
    </span>
  );
}

function PanelNodeView({ id, data, selected }: NodeProps<PanelNode>) {
  const { panel } = data;
  const dispatch = useWorkspaceStore((s) => s.dispatch);
  const hand = useUiStore((s) => s.tool === 'hand');
  const [renaming, setRenaming] = useState(false);

  const finishRename = (next: string | null) => {
    setRenaming(false);
    const title = next?.trim();
    if (title && title !== panel.title) void dispatch({ type: 'renamePanel', id, title });
  };

  return (
    <div
      className={`flex h-full w-full flex-col rounded-xl border bg-panel ${
        selected
          ? 'border-accent shadow-[0_0_0_1px_var(--color-accent),0_20px_50px_rgba(0,0,0,.5)]'
          : 'border-line shadow-[0_14px_40px_rgba(0,0,0,.4)]'
      }`}
    >
      <NodeResizer
        isVisible={selected && !hand}
        minWidth={MIN_PANEL_SIZE.width}
        minHeight={MIN_PANEL_SIZE.height}
        lineStyle={{ borderColor: 'transparent' }}
        handleStyle={{
          width: 8,
          height: 8,
          borderRadius: 2,
          background: 'var(--color-ink)',
          border: '1.5px solid var(--color-accent)',
        }}
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
        className={`${PANEL_DRAG_HANDLE} flex h-9 shrink-0 items-center gap-2 rounded-t-[11px] border-b border-line-soft bg-panel-head pr-2 pl-3 ${
          hand ? '' : 'cursor-grab active:cursor-grabbing'
        }`}
      >
        <PanelIcon
          type={panel.type}
          mode={panel.type === 'terminal' ? panel.mode : undefined}
          className="text-ink-3"
        />
        {renaming ? (
          <TitleEditor title={panel.title} onDone={finishRename} />
        ) : (
          <>
            <span
              className="min-w-0 truncate font-mono text-[12.5px] font-medium text-ink"
              title={panel.title}
            >
              {panel.title}
            </span>
            <span className="shrink-0 text-[11px] text-ink-4">{panelKindLabel(panel)}</span>
            <div className="flex-1" />
          </>
        )}
        <StatusBadge panel={panel} />
        <PanelMenu id={id} onRename={() => setRenaming(true)} />
        <button
          type="button"
          aria-label="Chiudi panel"
          title="Chiudi panel"
          onClick={() => void dispatch({ type: 'deletePanels', ids: [id] })}
          className={ICON_BUTTON}
        >
          <XIcon size={13} />
        </button>
      </header>
      {/* In hand mode the body must let the pan gesture through. */}
      <div
        className={`${hand ? '' : 'nodrag nowheel nopan'} min-h-0 flex-1 overflow-auto rounded-b-[11px]`}
      >
        <PanelPlaceholder panel={panel} />
      </div>
    </div>
  );
}

export const PanelNodeComponent = memo(PanelNodeView);
