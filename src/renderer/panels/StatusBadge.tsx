import type { Panel } from '@shared/types';
import { statusLabel } from './panelMeta';

export function StatusBadge({ panel }: { panel: Panel }) {
  if (panel.type !== 'terminal') return null;
  const { status } = panel;
  const live = status === 'working';
  const tone =
    status === 'working'
      ? 'bg-accent/13 text-accent-soft'
      : status === 'needs-input'
        ? 'bg-accent text-on-light font-medium'
        : status === 'exited'
          ? 'bg-danger/12 text-danger'
          : 'bg-hover text-ink-3';
  return (
    <span
      className={`flex shrink-0 items-center gap-1.5 rounded-full px-[9px] py-[3px] text-[11px] whitespace-nowrap ${tone}`}
    >
      {live && <span className="size-1.5 animate-pulse-dot rounded-full bg-accent" />}
      {statusLabel(panel.mode, status)}
    </span>
  );
}
