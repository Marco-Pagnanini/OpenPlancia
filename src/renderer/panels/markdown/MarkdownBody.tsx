import {
  ArrowCounterClockwiseIcon,
  CornersInIcon,
  EyeIcon,
  PencilSimpleIcon,
  RobotIcon,
  WarningIcon,
  XIcon,
} from '@phosphor-icons/react';
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import type { MarkdownPanel } from '@shared/types';
import { useMarkdownStore, type SaveState } from '../../stores/markdownStore';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { MarkdownPreview } from './MarkdownPreview';

const MarkdownEditor = lazy(() => import('./MarkdownEditor'));

const SAVE_LABEL: Record<SaveState, string> = {
  saved: 'Salvato',
  pending: 'Modifiche non salvate',
  saving: 'Salvataggio…',
  error: 'Salvataggio non riuscito',
};

const BAR_BUTTON =
  'flex h-6 items-center gap-1.5 rounded-md border border-line-strong bg-raised px-2 text-[11.5px] font-medium text-ink hover:bg-line-soft';

function Notice({ tone, children }: { tone: 'warning' | 'error'; children: ReactNode }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 text-xs ${
        tone === 'error'
          ? 'border-danger/30 bg-danger/10 text-danger'
          : 'border-accent/30 bg-accent/10 text-accent-soft'
      }`}
    >
      <WarningIcon size={14} className="shrink-0" />
      {children}
    </div>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: 'preview' | 'edit';
  onChange: (view: 'preview' | 'edit') => void;
}) {
  const item = (value: 'preview' | 'edit', label: string, icon: ReactNode) => (
    <button
      type="button"
      aria-pressed={view === value}
      onClick={() => onChange(value)}
      className={`flex h-6 items-center gap-1.5 rounded-[6px] px-2 text-[11.5px] ${
        view === value ? 'bg-hover-strong text-ink' : 'text-ink-4 hover:text-ink-2'
      }`}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div className="flex shrink-0 rounded-lg border border-line bg-canvas p-0.5">
      {item('preview', 'Anteprima', <EyeIcon size={13} />)}
      {item('edit', 'Modifica', <PencilSimpleIcon size={13} />)}
    </div>
  );
}

/** Body of a markdown panel: a live view of a real file in the project (spec §8.2). */
export function MarkdownBody({
  panel,
  variant,
}: {
  panel: MarkdownPanel;
  variant: 'panel' | 'focus';
}) {
  const { id } = panel;
  const doc = useMarkdownStore((s) => s.docs[id]);
  const draft = useMarkdownStore((s) => s.drafts[id]);
  const saveState = useMarkdownStore((s) => s.saveState[id] ?? 'saved');
  const error = useMarkdownStore((s) => s.errors[id]);
  const conflict = useMarkdownStore((s) => s.conflicts[id] === true);
  const claudeEdit = useMarkdownStore((s) => s.claudeEdits[id]);
  const authorTitle = useWorkspaceStore(
    (s) => s.snapshot?.board.panels.find((p) => p.id === claudeEdit?.author)?.title,
  );
  const { load, edit, flush, discardDraft, keepDraft, undo, dismissClaudeEdit } =
    useMarkdownStore.getState();
  const inFocusMode = useUiStore((s) => s.focusId === id);
  const setFocus = useUiStore((s) => s.setFocus);
  const [view, setView] = useState<'preview' | 'edit'>('preview');

  useEffect(() => {
    if (!useMarkdownStore.getState().docs[id]) void load(id);
  }, [id, load]);

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

  const content = draft ?? doc?.content ?? '';

  return (
    // Re-keyed on every Claude write so the flash plays again.
    <div
      key={claudeEdit?.at ?? 'idle'}
      className={`flex h-full flex-col ${claudeEdit ? 'claude-flash' : ''}`}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line-soft px-2.5">
        <ViewToggle view={view} onChange={setView} />
        <span
          className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-5"
          title={panel.filePath}
        >
          {panel.filePath}
        </span>
        {doc && (
          <span
            className={`shrink-0 text-[11px] ${
              saveState === 'error'
                ? 'text-danger'
                : saveState === 'saved'
                  ? 'text-ink-6'
                  : 'text-ink-3'
            }`}
          >
            {SAVE_LABEL[saveState]}
          </span>
        )}
      </div>

      {claudeEdit && (
        <div className="flex shrink-0 items-center gap-2 border-b border-accent/30 bg-accent/10 px-3 py-1.5 text-xs text-accent-soft">
          <RobotIcon size={14} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            Modificato da <span className="font-mono">{authorTitle ?? 'Claude'}</span>
          </span>
          {doc?.canUndo && (
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
      {conflict && (
        <Notice tone="warning">
          <span className="min-w-0 basis-[calc(100%-24px)]">
            Il file è cambiato fuori da Plancia mentre avevi modifiche non salvate.
          </span>
          <button type="button" className={BAR_BUTTON} onClick={() => discardDraft(id)}>
            Usa la versione su disco
          </button>
          <button type="button" className={BAR_BUTTON} onClick={() => void keepDraft(id)}>
            Mantieni le mie modifiche
          </button>
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {doc && !doc.exists && draft === undefined && (
        <Notice tone="warning">
          <span className="min-w-0 flex-1">Il file non esiste.</span>
          <button
            type="button"
            className={BAR_BUTTON}
            onClick={() => edit(id, `# ${panel.title.replace(/\.(md|markdown|mdx)$/i, '')}\n`)}
          >
            Crea il file
          </button>
        </Notice>
      )}

      <div className="min-h-0 flex-1">
        {!doc ? (
          <div className="p-4 text-xs text-ink-4">{error ? '' : 'Caricamento…'}</div>
        ) : view === 'edit' ? (
          <Suspense fallback={<div className="p-4 text-xs text-ink-4">Caricamento editor…</div>}>
            <MarkdownEditor
              value={content}
              onChange={(next) => edit(id, next)}
              onSave={() => flush(id)}
            />
          </Suspense>
        ) : content.trim() === '' ? (
          <button
            type="button"
            onClick={() => setView('edit')}
            className="flex h-full w-full items-center justify-center text-xs text-ink-5 hover:text-ink-3"
          >
            File vuoto · clic per scrivere
          </button>
        ) : (
          <div className="h-full overflow-y-auto px-5 py-4">
            <MarkdownPreview content={content} />
          </div>
        )}
      </div>
    </div>
  );
}
