import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  CaretRightIcon,
  CornersInIcon,
  FileTextIcon,
  FolderSimpleIcon,
} from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import type { FolderFile } from '@shared/ipc';
import type { FolderPanel } from '@shared/types';
import { useFolderStore } from '../../stores/folderStore';
import { folderFileKey, useMarkdownStore } from '../../stores/markdownStore';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { BAR_BUTTON, MarkdownDocView, Notice } from '../markdown/MarkdownBody';

interface TreeDir {
  name: string;
  path: string;
  dirs: TreeDir[];
  files: FolderFile[];
}

/** Nested folders from the flat, sorted list of paths. */
function buildTree(files: FolderFile[]): TreeDir {
  const root: TreeDir = { name: '', path: '', dirs: [], files: [] };
  for (const file of files) {
    const parts = file.path.split('/');
    let dir = root;
    parts.slice(0, -1).forEach((name, i) => {
      const path = parts.slice(0, i + 1).join('/');
      let next = dir.dirs.find((d) => d.path === path);
      if (!next) {
        next = { name, path, dirs: [], files: [] };
        dir.dirs.push(next);
      }
      dir = next;
    });
    dir.files.push(file);
  }
  return root;
}

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

function FileRow({
  panelId,
  file,
  depth,
  selected,
  onSelect,
}: {
  panelId: string;
  file: FolderFile;
  depth: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const touched = useMarkdownStore(
    (s) => s.claudeEdits[folderFileKey(panelId, file.path)] !== undefined,
  );
  const extract = async () => {
    const result = await window.plancia.folder.extract(panelId, file.path);
    if (result.status === 'error') useWorkspaceStore.setState({ error: result.message });
  };
  const name = fileName(file.path);
  return (
    <div
      className={`group flex items-center rounded-md ${
        selected ? 'bg-accent/14 text-ink' : 'text-ink-2 hover:bg-hover'
      }`}
      style={{ paddingLeft: 6 + depth * 14 }}
    >
      <button
        type="button"
        onClick={onSelect}
        title={file.title !== name ? `${file.path} — ${file.title}` : file.path}
        className="flex min-w-0 flex-1 items-center gap-2 py-[5px] pr-1 text-left"
      >
        <FileTextIcon size={14} className={selected ? 'text-accent' : 'text-ink-5'} />
        <span className="min-w-0 truncate font-mono text-[12px]">{name}</span>
        {touched && (
          <span className="size-1.5 shrink-0 rounded-full bg-accent" title="Modificato da Claude" />
        )}
      </button>
      <button
        type="button"
        aria-label={`Apri ${name} come panel`}
        title="Apri come panel"
        onClick={() => void extract()}
        className="mr-1 grid size-6 shrink-0 place-items-center rounded-md text-ink-5 opacity-0 group-hover:opacity-100 hover:bg-line-soft hover:text-ink focus-visible:opacity-100"
      >
        <ArrowSquareOutIcon size={13} />
      </button>
    </div>
  );
}

function DirRows({
  panelId,
  dir,
  depth,
  current,
  onSelect,
}: {
  panelId: string;
  dir: TreeDir;
  depth: number;
  current: string | undefined;
  onSelect: (path: string) => void;
}) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const toggle = (path: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  return (
    <>
      {dir.dirs.map((sub) => {
        const open = !closed.has(sub.path);
        return (
          <div key={sub.path}>
            <button
              type="button"
              onClick={() => toggle(sub.path)}
              aria-expanded={open}
              className="flex w-full items-center gap-1.5 rounded-md py-[5px] pr-2 text-left text-[12px] text-ink-3 hover:bg-hover"
              style={{ paddingLeft: 6 + depth * 14 }}
            >
              {open ? <CaretDownIcon size={11} /> : <CaretRightIcon size={11} />}
              <FolderSimpleIcon size={14} className="text-ink-5" />
              <span className="truncate font-mono">{sub.name}</span>
            </button>
            {open && (
              <DirRows
                panelId={panelId}
                dir={sub}
                depth={depth + 1}
                current={current}
                onSelect={onSelect}
              />
            )}
          </div>
        );
      })}
      {dir.files.map((file) => (
        <FileRow
          key={file.path}
          panelId={panelId}
          file={file}
          depth={depth}
          selected={file.path === current}
          onSelect={() => onSelect(file.path)}
        />
      ))}
    </>
  );
}

/**
 * Body of a folder panel (M6.5): the markdown files of a project folder as a tree, with the
 * selected file below (on the board) or beside it (focus mode), editable like a markdown panel.
 */
export function FolderBody({ panel, variant }: { panel: FolderPanel; variant: 'panel' | 'focus' }) {
  const { id } = panel;
  const index = useFolderStore((s) => s.indexes[id]);
  const error = useFolderStore((s) => s.errors[id]);
  const selected = useFolderStore((s) => s.selected[id]);
  const select = useFolderStore((s) => s.select);
  const inFocusMode = useUiStore((s) => s.focusId === id);
  const setFocus = useUiStore((s) => s.setFocus);
  const tree = useMemo(() => buildTree(index?.files ?? []), [index]);

  useEffect(() => {
    if (!useFolderStore.getState().indexes[id]) void useFolderStore.getState().load(id);
  }, [id]);

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

  const files = index?.files ?? [];
  const current = files.some((f) => f.path === selected) ? selected : files[0]?.path;
  const folderLabel = panel.dirPath === '.' ? 'cartella del progetto' : `${panel.dirPath}/`;
  const fullPath = (path: string) => (panel.dirPath === '.' ? path : `${panel.dirPath}/${path}`);
  const focus = variant === 'focus';

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line-soft px-3">
        <FolderSimpleIcon size={14} className="shrink-0 text-ink-4" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-3">
          {folderLabel}
        </span>
        {index && (
          <span className="shrink-0 text-[11px] text-ink-5">
            {files.length}
            {index.truncated ? '+' : ''} file .md
          </span>
        )}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {index && !index.exists && (
        <Notice tone="warning">La cartella {folderLabel} non esiste più.</Notice>
      )}

      {!index ? (
        <div className="p-4 text-xs text-ink-4">{error ? '' : 'Caricamento…'}</div>
      ) : files.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <span className="max-w-[36ch] text-xs text-pretty text-ink-4">
            Nessun file .md in questa cartella. Con una freccia di scrittura Claude può crearne.
          </span>
        </div>
      ) : (
        <div className={`flex min-h-0 flex-1 ${focus ? 'flex-row' : 'flex-col'}`}>
          <nav
            aria-label="File della cartella"
            className={`shrink-0 overflow-y-auto p-1.5 ${
              focus
                ? 'w-[280px] border-r border-line-soft'
                : 'max-h-[42%] border-b border-line-soft'
            }`}
          >
            <DirRows
              panelId={id}
              dir={tree}
              depth={0}
              current={current}
              onSelect={(path) => select(id, path)}
            />
          </nav>
          <div className="min-h-0 min-w-0 flex-1">
            {current && (
              <MarkdownDocView
                key={current}
                docKey={folderFileKey(id, current)}
                filePath={fullPath(current)}
                title={fileName(current)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
