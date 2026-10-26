import type { PanelType, TerminalMode } from '@shared/types';

const STYLES: Record<string, { label: string; className: string }> = {
  shell: { label: '>_', className: 'bg-zinc-700 text-zinc-100' },
  claude: { label: '✳', className: 'bg-orange-600 text-white' },
  markdown: { label: 'M↓', className: 'bg-sky-700 text-white' },
  architecture: { label: '◇', className: 'bg-violet-700 text-white' },
  code: { label: '{}', className: 'bg-emerald-700 text-white' },
};

export function PanelIcon({ type, mode }: { type: PanelType; mode?: TerminalMode | undefined }) {
  const style = STYLES[type === 'terminal' ? (mode ?? 'shell') : type] ?? {
    label: '?',
    className: 'bg-zinc-700',
  };
  return (
    <span
      className={`inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded px-1 font-mono text-[10px] leading-none font-semibold ${style.className}`}
      aria-hidden
    >
      {style.label}
    </span>
  );
}
