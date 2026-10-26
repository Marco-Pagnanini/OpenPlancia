import { FilePlusIcon, FolderOpenIcon } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';
import { useUiStore } from '../stores/uiStore';
import { TOOL_ITEMS, type ToolItem } from './tools';
import { useCreateFolderPanel, useCreateMarkdownPanel, useCreatePanel } from './useCreatePanel';

function MarkdownMenu() {
  const setOpen = useUiStore((s) => s.setMarkdownMenu);
  const createMarkdown = useCreateMarkdownPanel();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  const pick = (mode: 'new' | 'open') => {
    setOpen(false);
    void createMarkdown(mode);
  };
  const item =
    'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-ink-2 hover:bg-hover hover:text-ink focus:bg-hover focus:outline-none';

  return (
    <div
      ref={ref}
      role="menu"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
      className="absolute top-1/2 left-[calc(100%+12px)] z-10 w-56 -translate-y-1/2 rounded-[10px] border border-line-strong bg-chrome p-1 shadow-[0_24px_60px_rgba(0,0,0,.55)]"
    >
      <button type="button" role="menuitem" className={item} onClick={() => pick('new')}>
        <FilePlusIcon size={15} className="text-ink-3" />
        Nuovo file markdown…
      </button>
      <button type="button" role="menuitem" className={item} onClick={() => pick('open')}>
        <FolderOpenIcon size={15} className="text-ink-3" />
        Apri file markdown…
      </button>
    </div>
  );
}

function Tooltip({ label, shortcut }: { label: string; shortcut: string }) {
  return (
    <span className="pointer-events-none absolute top-1/2 left-[calc(100%+12px)] hidden -translate-y-1/2 items-center gap-2 rounded-[7px] border border-line-strong bg-hover-strong py-[5px] pr-1.5 pl-[9px] text-xs font-medium whitespace-nowrap text-ink group-hover:flex">
      {label}
      <kbd className="rounded border border-line-kbd px-[5px] py-px font-mono text-[11px] text-ink-3">
        {shortcut}
      </kbd>
    </span>
  );
}

/** Vertical tool rail docked on the left edge, as in the design. */
export function ToolRail() {
  const tool = useUiStore((s) => s.tool);
  const setTool = useUiStore((s) => s.setTool);
  const createPanel = useCreatePanel();
  const createFolder = useCreateFolderPanel();
  const markdownMenu = useUiStore((s) => s.markdownMenu);
  const setMarkdownMenu = useUiStore((s) => s.setMarkdownMenu);

  const render = (item: ToolItem, index: number) => {
    if (item.kind === 'separator') {
      return <div key={`sep-${index}`} className="my-1 h-px w-6 bg-line" />;
    }
    const active =
      (item.kind === 'mode' && item.tool === tool) || (item.kind === 'markdown' && markdownMenu);
    const onClick =
      item.kind === 'mode'
        ? () => setTool(item.tool)
        : item.kind === 'markdown'
          ? () => setMarkdownMenu(!markdownMenu)
          : item.kind === 'folder'
            ? () => void createFolder()
            : () => createPanel(item.type, item.mode);
    const Glyph = item.icon;
    return (
      <div key={item.label} className="relative">
        <button
          type="button"
          aria-label={item.kind === 'mode' ? item.label : `Nuovo panel: ${item.label}`}
          aria-pressed={item.kind === 'mode' ? active : undefined}
          aria-expanded={item.kind === 'markdown' ? markdownMenu : undefined}
          onClick={onClick}
          className={`group relative grid size-10 place-items-center rounded-[10px] transition-colors active:scale-[.96] ${
            active ? 'bg-accent/16 text-accent' : 'text-ink-tool hover:bg-hover hover:text-ink'
          }`}
        >
          <Glyph size={19} />
          {!(item.kind === 'markdown' && markdownMenu) && (
            <Tooltip label={item.label} shortcut={item.key} />
          )}
        </button>
        {item.kind === 'markdown' && markdownMenu && <MarkdownMenu />}
      </div>
    );
  };

  return (
    <nav
      aria-label="Strumenti"
      className="absolute top-1/2 left-4 z-30 flex -translate-y-1/2 flex-col items-center gap-1 rounded-[14px] border border-line bg-chrome p-1.5 shadow-[0_12px_36px_rgba(0,0,0,.45)]"
    >
      {TOOL_ITEMS.map(render)}
    </nav>
  );
}
