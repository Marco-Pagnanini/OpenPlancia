import {
  ArrowCounterClockwiseIcon,
  BracketsCurlyIcon,
  CornersInIcon,
  PencilSimpleIcon,
  RobotIcon,
  XIcon,
} from '@phosphor-icons/react';
import { lazy, Suspense, useEffect, useState } from 'react';
import type { ArchitecturePanel } from '@shared/types';
import { useArchitectureStore } from '../../stores/architectureStore';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { BAR_BUTTON, Notice } from '../markdown/MarkdownBody';
import { ArchitecturePreview } from './ArchitecturePreview';

const ArchitectureEditor = lazy(() => import('./ArchitectureEditor'));

/** Removed nodes fade out in the preview for this long, then the picture settles. */
const GHOST_MS = 1500;

/** Body of an Architecture panel (spec §8.3): SVG preview on the board, editor in focus mode. */
export function ArchitectureBody({
  panel,
  variant,
}: {
  panel: ArchitecturePanel;
  variant: 'panel' | 'focus';
}) {
  const { id } = panel;
  const doc = useArchitectureStore((s) => s.docs[id]);
  const canUndo = useArchitectureStore((s) => s.canUndo[id] ?? false);
  const error = useArchitectureStore((s) => s.errors[id]);
  const claudeEdit = useArchitectureStore((s) => s.claudeEdits[id]);
  const authorTitle = useWorkspaceStore(
    (s) => s.snapshot?.board.panels.find((p) => p.id === claudeEdit?.author)?.title,
  );
  const { load, undo, dismissClaudeEdit, clearError } = useArchitectureStore.getState();
  const inFocusMode = useUiStore((s) => s.focusId === id);
  const setFocus = useUiStore((s) => s.setFocus);
  const showJson = useUiStore((s) => s.setArchJsonFor);
  const [settledAt, setSettledAt] = useState<number | null>(null);

  useEffect(() => {
    if (!useArchitectureStore.getState().docs[id]) void load(id);
  }, [id, load]);

  useEffect(() => {
    if (!claudeEdit) return;
    const at = claudeEdit.at;
    const timer = setTimeout(() => setSettledAt(at), GHOST_MS);
    return () => clearTimeout(timer);
  }, [claudeEdit]);

  if (variant === 'panel' && inFocusMode) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <span className="text-xs text-ink-4">Aperto in modalità focus</span>
        <button type="button" className={BAR_BUTTON} onClick={() => setFocus(null)}>
          <CornersInIcon size={13} />
          Torna alla lavagna
        </button>
      </div>
    );
  }

  const diff =
    claudeEdit && settledAt === claudeEdit.at
      ? { ...claudeEdit.diff, removedNodes: [], removedEdges: [] }
      : claudeEdit?.diff;

  return (
    // Re-keyed on every Claude write so the flash plays again.
    <div
      key={claudeEdit?.at ?? 'idle'}
      className={`flex h-full flex-col ${claudeEdit ? 'claude-flash' : ''}`}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line-soft px-2.5">
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-4">
          {doc ? `${doc.nodes.length} nodi · ${doc.edges.length} relazioni` : ''}
        </span>
        <button
          type="button"
          className={BAR_BUTTON}
          onClick={() => showJson(id)}
          title="Il documento esattamente come lo riceve Claude"
        >
          <BracketsCurlyIcon size={13} />
          Vedi JSON
        </button>
        {variant === 'panel' && (
          <button type="button" className={BAR_BUTTON} onClick={() => setFocus(id)}>
            <PencilSimpleIcon size={13} />
            Modifica
          </button>
        )}
      </div>

      {claudeEdit && (
        <div className="flex shrink-0 items-center gap-2 border-b border-accent/30 bg-accent/10 px-3 py-1.5 text-xs text-accent-soft">
          <RobotIcon size={14} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            Modificato da <span className="font-mono">{authorTitle ?? 'Claude'}</span>
          </span>
          {canUndo && (
            <button type="button" className={BAR_BUTTON} onClick={() => void undo(id)}>
              <ArrowCounterClockwiseIcon size={13} />
              Annulla
            </button>
          )}
          <button
            type="button"
            aria-label="Chiudi avviso"
            onClick={() => dismissClaudeEdit(id)}
            className="grid size-6 place-items-center rounded-md text-accent-soft/70 hover:bg-accent/15 hover:text-accent-soft"
          >
            <XIcon size={12} />
          </button>
        </div>
      )}
      {error && (
        <Notice tone="error">
          <span className="min-w-0 flex-1 whitespace-pre-wrap">{error}</span>
          {doc && (
            <button
              type="button"
              aria-label="Chiudi avviso"
              onClick={() => clearError(id)}
              className="grid size-6 place-items-center rounded-md hover:bg-danger/15"
            >
              <XIcon size={12} />
            </button>
          )}
        </Notice>
      )}

      <div className="min-h-0 flex-1">
        {!doc ? (
          <div className="p-4 text-xs text-ink-4">{error ? '' : 'Caricamento…'}</div>
        ) : variant === 'focus' ? (
          <Suspense fallback={<div className="p-4 text-xs text-ink-4">Caricamento editor…</div>}>
            <ArchitectureEditor panelId={id} />
          </Suspense>
        ) : doc.nodes.length === 0 && !diff?.removedNodes.length ? (
          <button
            type="button"
            onClick={() => setFocus(id)}
            className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-[radial-gradient(circle,#262624_1px,transparent_1.4px)] bg-size-[16px_16px] p-6 text-center"
          >
            <span className="text-[13px] text-ink-2">Nessun nodo</span>
            <span className="max-w-[34ch] text-xs text-pretty text-ink-4">
              Clic per disegnare servizi e relazioni: Claude li riceve come JSON.
            </span>
          </button>
        ) : (
          <div
            className="h-full bg-[radial-gradient(circle,#232321_1px,transparent_1.4px)] bg-size-[16px_16px] p-2"
            onDoubleClick={() => setFocus(id)}
            title="Doppio clic per modificare"
          >
            <ArchitecturePreview doc={doc} diff={diff} />
          </div>
        )}
      </div>
    </div>
  );
}
