import { ArrowClockwiseIcon, XIcon } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { estimateTokens } from '../stores/connectionStore';
import { useUiStore } from '../stores/uiStore';
import { useWorkspaceStore } from '../stores/workspaceStore';

/** "Cosa vede Claude" (spec §9): the manifest exactly as it would be injected now. */
export function ManifestModal() {
  const terminalId = useUiStore((s) => s.manifestFor);
  const close = useUiStore((s) => s.setManifestFor);
  const title = useWorkspaceStore(
    (s) => s.snapshot?.board.panels.find((p) => p.id === terminalId)?.title,
  );
  const board = useWorkspaceStore((s) => s.snapshot?.board);
  const [text, setText] = useState<string | null>(null);

  const load = useCallback(() => {
    if (terminalId) void window.plancia.connections.manifest(terminalId).then(setText);
  }, [terminalId]);

  // Refresh when arrows or panel versions change.
  useEffect(load, [load, board]);

  useEffect(() => {
    if (!terminalId) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [terminalId, close]);

  if (!terminalId) return null;
  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-canvas/70 p-8 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && close(null)}
    >
      <div
        role="dialog"
        aria-label="Cosa vede Claude"
        className="flex max-h-full w-[min(760px,100%)] flex-col overflow-hidden rounded-xl border border-line-strong bg-chrome shadow-[0_24px_60px_rgba(0,0,0,.55)]"
      >
        <header className="flex items-start gap-2.5 border-b border-line-soft py-3 pr-3 pl-4">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[13.5px] font-semibold">Cosa vede Claude</span>
            <span className="truncate font-mono text-[11.5px] text-ink-3">
              {title} · contesto iniettato da Plancia
              {text ? ` · ${text.length} caratteri · ~${estimateTokens(text.length)} token` : ''}
            </span>
          </div>
          <button
            type="button"
            aria-label="Aggiorna"
            onClick={load}
            className="grid size-[26px] place-items-center rounded-md text-ink-4 hover:bg-line-soft hover:text-ink"
          >
            <ArrowClockwiseIcon size={14} />
          </button>
          <button
            type="button"
            aria-label="Chiudi"
            onClick={() => close(null)}
            className="grid size-[26px] place-items-center rounded-md text-ink-4 hover:bg-line-soft hover:text-ink"
          >
            <XIcon size={14} />
          </button>
        </header>
        <pre className="min-h-0 flex-1 overflow-auto bg-canvas px-4 py-3 font-mono text-[12px] leading-[19px] whitespace-pre-wrap text-ink-2">
          {text === null
            ? 'Caricamento…'
            : text === ''
              ? 'Nessun panel collegato: Plancia non aggiunge contesto a questa sessione.'
              : text}
        </pre>
        <p className="border-t border-line-soft px-4 py-2.5 text-[11.5px] text-pretty text-ink-4">
          Viene aggiunto all'inizio della sessione e, se le frecce o i panel letti cambiano, insieme
          al messaggio successivo.
        </p>
      </div>
    </div>
  );
}
