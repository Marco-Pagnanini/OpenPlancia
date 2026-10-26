import type { Panel } from '@shared/types';
import { panelKindLabel } from './panelMeta';

function details(panel: Panel): [string, string][] {
  switch (panel.type) {
    case 'terminal':
      return [
        ['Modalità', panel.mode],
        ['Cartella', panel.cwd],
      ];
    case 'markdown':
      return [['File', panel.filePath]];
    case 'architecture':
      return [['File', `.plancia/panels/${panel.id}.arch.json`]];
    case 'code':
      return [
        ['Segue', panel.follow === 'all-agents' ? 'tutti gli agenti' : panel.follow.terminalId],
      ];
  }
}

/** Placeholder body until each panel type gets its real content (M2–M7). */
export function PanelPlaceholder({ panel }: { panel: Panel }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm font-medium text-zinc-300">{panelKindLabel(panel)}</p>
      <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1 text-xs text-zinc-500">
        {details(panel).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-right">{k}</dt>
            <dd className="text-left font-mono text-zinc-400">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-zinc-600">Contenuto in arrivo</p>
    </div>
  );
}
