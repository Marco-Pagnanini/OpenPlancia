import {
  ArrowLineUpIcon,
  CornersInIcon,
  EyeIcon,
  FileCodeIcon,
  FolderOpenIcon,
  GitDiffIcon,
  PushPinIcon,
  XIcon,
} from '@phosphor-icons/react';
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CodeFeedEntry } from '@shared/ipc';
import type { CodePanel } from '@shared/types';
import { useCodeStore } from '../../stores/codeStore';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { BAR_BUTTON, Notice } from '../markdown/MarkdownBody';

const CodeViewer = lazy(() => import('./CodeViewer'));

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const dirName = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

function Row({
  path,
  selected,
  onSelect,
  meta,
  icon,
  action,
}: {
  path: string;
  selected: boolean;
  onSelect: () => void;
  meta?: ReactNode;
  icon: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className={`group flex items-center rounded-md ${
        selected ? 'bg-accent/14 text-ink' : 'text-ink-2 hover:bg-hover'
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        title={path}
        className="flex min-w-0 flex-1 items-center gap-2 py-[5px] pr-1 pl-2 text-left"
      >
        {icon}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-mono text-[12px]">{fileName(path)}</span>
          {(dirName(path) || meta) && (
            <span className="flex min-w-0 gap-1.5 text-[10.5px] text-ink-5">
              {dirName(path) && <span className="truncate font-mono">{dirName(path)}</span>}
              {meta}
            </span>
          )}
        </span>
      </button>
      {action}
    </div>
  );
}

function Viewer({ path }: { path: string }) {
  const state = useCodeStore((s) => s.files[path]);
  const [mode, setMode] = useState<'file' | 'diff' | null>(null);
  const file = state?.file;
  const changed = file !== undefined && file.head !== null && file.head !== file.content;
  const isNew = file !== undefined && file.repo && file.head === null && file.exists;
  // Diff by default when there is one, until the user picks a view.
  const shown = mode ?? (changed ? 'diff' : 'file');
  const toggle = (value: 'file' | 'diff', label: string, icon: ReactNode, disabled: boolean) => (
    <button
      type="button"
      aria-pressed={shown === value}
      disabled={disabled}
      onClick={() => setMode(value)}
      className={`flex h-6 items-center gap-1.5 rounded-[6px] px-2 text-[11.5px] disabled:opacity-40 ${
        shown === value ? 'bg-hover-strong text-ink' : 'text-ink-4 hover:text-ink-2'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line-soft px-2.5">
        <div className="flex shrink-0 rounded-lg border border-line bg-canvas p-0.5">
          {toggle('diff', 'Diff con HEAD', <GitDiffIcon size={13} />, !changed)}
          {toggle('file', 'File', <EyeIcon size={13} />, false)}
        </div>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-5" title={path}>
          {path}
        </span>
        {file && (
          <span className="shrink-0 text-[11px] text-ink-6">
            {!file.exists
              ? 'eliminato'
              : isNew
                ? 'nuovo file'
                : !file.repo
                  ? 'senza git'
                  : changed
                    ? 'modificato'
                    : 'come HEAD'}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {state?.error ? (
          <Notice tone="error">{state.error}</Notice>
        ) : !file ? (
          <div className="p-4 text-xs text-ink-4">Caricamento…</div>
        ) : file.binary || file.tooLarge ? (
          <div className="flex h-full items-center justify-center p-6 text-xs text-ink-4">
            {file.binary ? 'File binario: niente da mostrare.' : 'File troppo grande da mostrare.'}
          </div>
        ) : (
          <Suspense fallback={<div className="p-4 text-xs text-ink-4">Caricamento editor…</div>}>
            <CodeViewer
              key={`${path}:${shown}`}
              path={path}
              content={file.content}
              head={file.head}
              mode={shown}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}

function CodeView({ panel, variant }: { panel: CodePanel; variant: 'panel' | 'focus' }) {
  const { id, follow, pinnedFile } = panel;
  const feed = useCodeStore((s) => s.feed);
  const manual = useCodeStore((s) => s.selected[id]);
  const known = useCodeStore((s) => s.files);
  const { select, load } = useCodeStore.getState();
  const dispatch = useWorkspaceStore((s) => s.dispatch);
  const panels = useWorkspaceStore((s) => s.snapshot?.board.panels);
  const terminals = useMemo(
    () =>
      (panels ?? [])
        .filter((p) => p.type === 'terminal' && p.mode === 'claude')
        .map((p) => ({ id: p.id, title: p.title })),
    [panels],
  );
  const titleOf = (terminalId: string) =>
    terminals.find((t) => t.id === terminalId)?.title ?? 'Claude';

  const followed = follow === 'all-agents' ? null : follow.terminalId;
  const visible: CodeFeedEntry[] = followed ? feed.filter((e) => e.terminalId === followed) : feed;
  // Without a choice by hand the panel follows the latest change, live.
  const current = manual ?? pinnedFile ?? visible[0]?.path;

  useEffect(() => {
    window.plancia.code.watch(id, current ?? null);
    if (current && !useCodeStore.getState().files[current]) void load(current);
    return () => window.plancia.code.watch(id, null);
  }, [id, current, load]);

  const pick = async () => {
    const result = await window.plancia.code.pick(id);
    if (result.status === 'error') useWorkspaceStore.setState({ error: result.message });
    else if (result.status === 'created') select(id, null);
  };
  const focus = variant === 'focus';

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line-soft px-2.5">
        <select
          aria-label="File da seguire"
          value={followed ?? 'all-agents'}
          onChange={(e) =>
            void dispatch({
              type: 'setCodeFollow',
              id,
              follow:
                e.target.value === 'all-agents' ? 'all-agents' : { terminalId: e.target.value },
            })
          }
          className="h-7 min-w-0 shrink rounded-md border border-line bg-canvas px-1.5 text-[11.5px] text-ink-2 outline-none focus:border-accent"
        >
          <option value="all-agents">Tutti gli agenti</option>
          {terminals.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        {manual && (
          <button
            type="button"
            className={BAR_BUTTON}
            onClick={() => select(id, null)}
            title="Torna a mostrare l'ultimo file modificato"
          >
            <ArrowLineUpIcon size={13} />
            Segui l'ultimo
          </button>
        )}
        <button type="button" className={BAR_BUTTON} onClick={() => void pick()}>
          <FolderOpenIcon size={13} />
          Apri file…
        </button>
      </div>

      {!current ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <span className="max-w-[38ch] text-xs text-pretty text-ink-4">
            Qui compaiono i file che {followed ? titleOf(followed) : 'Claude'} modifica, con il diff
            rispetto all'ultimo commit. Puoi anche aprire un file a mano.
          </span>
        </div>
      ) : (
        <div className={`flex min-h-0 flex-1 ${focus ? 'flex-row' : 'flex-col'}`}>
          <nav
            aria-label="File modificati"
            className={`shrink-0 overflow-y-auto p-1.5 ${
              focus
                ? 'w-[300px] border-r border-line-soft'
                : 'max-h-[38%] border-b border-line-soft'
            }`}
          >
            {pinnedFile && (
              <Row
                path={pinnedFile}
                selected={current === pinnedFile}
                onSelect={() => select(id, pinnedFile)}
                icon={<PushPinIcon size={14} className="shrink-0 text-accent" />}
                meta={<span>aperto a mano</span>}
                action={
                  <button
                    type="button"
                    aria-label="Chiudi il file aperto a mano"
                    onClick={() => {
                      void dispatch({ type: 'setCodePinned', id, pinnedFile: null });
                      if (manual === pinnedFile) select(id, null);
                    }}
                    className="mr-1 grid size-6 shrink-0 place-items-center rounded-md text-ink-5 hover:bg-line-soft hover:text-ink"
                  >
                    <XIcon size={12} />
                  </button>
                }
              />
            )}
            {visible.map((entry) => (
              <Row
                key={entry.path}
                path={entry.path}
                selected={current === entry.path}
                onSelect={() => select(id, entry.path)}
                icon={<FileCodeIcon size={14} className="shrink-0 text-ink-5" />}
                meta={
                  <span className="shrink-0">
                    {followed ? '' : `${titleOf(entry.terminalId)} · `}
                    {time(entry.at)}
                    {entry.edits > 1 ? ` · ${entry.edits} modifiche` : ''}
                  </span>
                }
              />
            ))}
            {visible.length === 0 && (
              <p className="px-2 py-1.5 text-[11.5px] text-ink-5">
                Nessun file modificato{followed ? ` da ${titleOf(followed)}` : ''} finora.
              </p>
            )}
          </nav>
          <div className="min-h-0 min-w-0 flex-1">
            {known[current]?.error ? (
              <Notice tone="error">{known[current]?.error}</Notice>
            ) : (
              <Viewer key={current} path={current} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Body of a Code panel (spec §8.4): the files agents change, read-only, with diff to HEAD. */
export function CodeBody({ panel, variant }: { panel: CodePanel; variant: 'panel' | 'focus' }) {
  const inFocusMode = useUiStore((s) => s.focusId === panel.id);
  const setFocus = useUiStore((s) => s.setFocus);
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
  return <CodeView panel={panel} variant={variant} />;
}
