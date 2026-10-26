import { useUiStore } from '../stores/uiStore';
import { TOOL_ITEMS, type ToolItem } from './tools';
import { useCreatePanel } from './useCreatePanel';

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

  const render = (item: ToolItem, index: number) => {
    if (item.kind === 'separator') {
      return <div key={`sep-${index}`} className="my-1 h-px w-6 bg-line" />;
    }
    const active = item.kind === 'mode' && item.tool === tool;
    const onClick =
      item.kind === 'mode' ? () => setTool(item.tool) : () => createPanel(item.type, item.mode);
    const Glyph = item.icon;
    return (
      <button
        key={item.label}
        type="button"
        aria-label={item.kind === 'create' ? `Nuovo panel: ${item.label}` : item.label}
        aria-pressed={item.kind === 'mode' ? active : undefined}
        onClick={onClick}
        className={`group relative grid size-10 place-items-center rounded-[10px] transition-colors active:scale-[.96] ${
          active ? 'bg-accent/16 text-accent' : 'text-ink-tool hover:bg-hover hover:text-ink'
        }`}
      >
        <Glyph size={19} />
        <Tooltip label={item.label} shortcut={item.key} />
      </button>
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
