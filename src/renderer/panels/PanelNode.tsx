import {
  CornersOutIcon,
  DotsThreeIcon,
  DownloadSimpleIcon,
  ListBulletsIcon,
  UploadSimpleIcon,
  XIcon,
} from '@phosphor-icons/react';
import { memo, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { NodeResizer, useStore, type NodeProps } from '@xyflow/react';
import { MIN_PANEL_SIZE } from '@shared/panels';
import type { Panel } from '@shared/types';
import { useUiStore } from '../stores/uiStore';
import { PANEL_DRAG_HANDLE, useWorkspaceStore, type PanelNode } from '../stores/workspaceStore';
import { PanelIcon } from './PanelIcon';
import { PanelPlaceholder } from './PanelPlaceholder';
import { Ports } from './Ports';
import { confirmDelete, panelKindLabel } from './panelMeta';
import { ArchitectureBody } from './architecture/ArchitectureBody';
import { MarkdownBody } from './markdown/MarkdownBody';
import { StatusBadge } from './StatusBadge';
import { TerminalBody } from './terminal/TerminalBody';
import { TerminalPreview } from './terminal/TerminalPreview';

/** Below this zoom terminals show a plain-text preview instead of xterm (spec §8.1). */
const LOW_ZOOM = 0.6;

const ICON_BUTTON =
  'nodrag grid size-6 place-items-center rounded-md text-ink-5 hover:bg-line-soft hover:text-ink';

function deletePanel(panel: Panel) {
  if (confirmDelete([panel])) {
    void useWorkspaceStore.getState().dispatch({ type: 'deletePanels', ids: [panel.id] });
  }
}

function PanelMenu({ panel, onRename }: { panel: Panel; onRename: () => void }) {
  const dispatch = useWorkspaceStore((s) => s.dispatch);
  const setFocus = useUiStore((s) => s.setFocus);
  const [open, setOpen] = useState(false);
  const { id } = panel;
  const running =
    panel.type === 'terminal' && panel.status !== 'not-started' && panel.status !== 'exited';

  const close = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
  };
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  const base = 'flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[12.5px]';
  const item = `${base} text-ink-2 hover:bg-hover hover:text-ink`;

  const convertToClaude = () => {
    if (running && !window.confirm('La shell verrà chiusa e al suo posto partirà Claude Code.'))
      return;
    void dispatch({ type: 'setTerminalMode', id, mode: 'claude' });
  };

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
          className="nodrag absolute top-7 right-0 z-10 w-44 rounded-[10px] border border-line-strong bg-chrome p-1 shadow-[0_24px_60px_rgba(0,0,0,.55)]"
        >
          <button type="button" role="menuitem" className={item} onClick={run(() => setFocus(id))}>
            Modalità focus
          </button>
          {panel.type === 'terminal' && panel.mode === 'claude' && (
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={run(() => useUiStore.getState().setManifestFor(id))}
            >
              Cosa vede Claude
            </button>
          )}
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
          {panel.type === 'terminal' && (
            <>
              <div className="mx-1 my-1 h-px bg-line-soft" />
              {panel.mode === 'shell' && (
                <button
                  type="button"
                  role="menuitem"
                  className={item}
                  onClick={run(convertToClaude)}
                >
                  Converti in Claude
                </button>
              )}
              {running && (
                <button
                  type="button"
                  role="menuitem"
                  className={item}
                  onClick={run(() => void window.plancia.terminal.stop(id))}
                >
                  Ferma processo
                </button>
              )}
            </>
          )}
          <div className="mx-1 my-1 h-px bg-line-soft" />
          <button
            type="button"
            role="menuitem"
            className={`${base} text-danger hover:bg-accent/12`}
            onClick={run(() => deletePanel(panel))}
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
      onDoubleClick={(e) => e.stopPropagation()}
      className="nodrag min-w-0 flex-1 rounded-md bg-canvas px-1.5 py-0.5 font-mono text-[12.5px] text-ink outline-none ring-1 ring-accent"
    />
  );
}

export function PanelContent({ panel, variant }: { panel: Panel; variant: 'panel' | 'focus' }) {
  const lowZoom = useStore((s) => s.transform[2] < LOW_ZOOM);
  if (panel.type === 'terminal') {
    return variant === 'panel' && lowZoom ? (
      <TerminalPreview panel={panel} />
    ) : (
      <TerminalBody panel={panel} variant={variant} />
    );
  }
  if (panel.type === 'markdown') return <MarkdownBody panel={panel} variant={variant} />;
  if (panel.type === 'architecture') return <ArchitectureBody panel={panel} variant={variant} />;
  return <PanelPlaceholder panel={panel} />;
}

/** Current tool and the "Attività" button, for Claude terminals. */
/** "📥 2 📤 1": panels this Claude reads and writes (spec §6). */
function ConnectionBadge({ id }: { id: string }) {
  const reads = useWorkspaceStore(
    (s) => s.snapshot?.board.connections.filter((c) => c.target === id).length ?? 0,
  );
  const writes = useWorkspaceStore(
    (s) => s.snapshot?.board.connections.filter((c) => c.source === id).length ?? 0,
  );
  if (reads + writes === 0) return null;
  return (
    <span
      title={`${reads} panel in lettura · ${writes} in scrittura`}
      className="flex shrink-0 items-center gap-1.5 rounded-full bg-hover px-2 py-[3px] font-mono text-[11px] text-ink-3"
    >
      <DownloadSimpleIcon size={12} className="text-[#8fa9c9]" />
      {reads}
      <UploadSimpleIcon size={12} className="text-[#e0b97e]" />
      {writes}
    </span>
  );
}

export function ClaudeHeaderExtras({ panel }: { panel: Panel }) {
  const setActivity = useUiStore((s) => s.setActivity);
  const open = useUiStore((s) => s.activityId === panel.id);
  if (panel.type !== 'terminal' || panel.mode !== 'claude') return null;
  return (
    <>
      <ConnectionBadge id={panel.id} />
      {panel.currentTool && panel.status === 'working' && (
        <span
          className="min-w-0 shrink truncate font-mono text-[11px] text-ink-3"
          title={panel.currentTool}
        >
          {panel.currentTool}
        </span>
      )}
      <button
        type="button"
        aria-label="Attività"
        aria-pressed={open}
        title="Attività"
        onClick={() => setActivity(open ? null : panel.id)}
        className={`${ICON_BUTTON} ${open ? 'bg-accent/16 text-accent' : ''}`}
      >
        <ListBulletsIcon size={14} />
      </button>
    </>
  );
}

function PanelNodeView({ id, data, selected }: NodeProps<PanelNode>) {
  const { panel } = data;
  const dispatch = useWorkspaceStore((s) => s.dispatch);
  const hand = useUiStore((s) => s.tool === 'hand');
  const setFocus = useUiStore((s) => s.setFocus);
  const linked = useWorkspaceStore(
    (s) => s.snapshot?.board.connections.some((c) => c.source === id || c.target === id) ?? false,
  );
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
      <Ports panel={panel} linked={linked} />
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
        onDoubleClick={() => setFocus(id)}
        title="Doppio clic per la modalità focus"
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
            <div className="min-w-2 flex-1" />
          </>
        )}
        <ClaudeHeaderExtras panel={panel} />
        <StatusBadge panel={panel} />
        <button
          type="button"
          aria-label="Modalità focus"
          title="Modalità focus"
          onClick={() => setFocus(id)}
          className={ICON_BUTTON}
        >
          <CornersOutIcon size={13} />
        </button>
        <PanelMenu panel={panel} onRename={() => setRenaming(true)} />
        <button
          type="button"
          aria-label="Chiudi panel"
          title="Chiudi panel"
          onClick={() => deletePanel(panel)}
          className={ICON_BUTTON}
        >
          <XIcon size={13} />
        </button>
      </header>
      {/* In hand mode the body must let the pan gesture through. */}
      <div
        // nokey: React Flow must not treat Backspace typed in an editor as "delete the panel".
        className={`${hand ? '' : 'nodrag nowheel nopan'} nokey min-h-0 flex-1 overflow-hidden rounded-b-[11px]`}
      >
        <PanelContent panel={panel} variant="panel" />
      </div>
    </div>
  );
}

export const PanelNodeComponent = memo(PanelNodeView);
