import {
  CopyIcon,
  EyeIcon,
  LinkBreakIcon,
  PencilSimpleIcon,
  PlusIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { accessLabel } from '@shared/access';
import type { ConnectionUse } from '@shared/ipc';
import { WIRE_COLORS, wireKind } from '../canvas/wireStyle';
import { estimateTokens, useConnectionStore } from '../stores/connectionStore';
import { useUiStore } from '../stores/uiStore';
import { useWorkspaceStore } from '../stores/workspaceStore';

const VIA: Record<ConnectionUse['via'], string> = {
  manifest: 'nel contesto del messaggio',
  read_panel: 'read_panel',
  write_panel: 'write_panel',
  tool: 'Edit/Write di Claude',
};

const BUTTON =
  'flex h-[30px] items-center gap-1.5 rounded-lg border border-line-strong bg-raised px-2.5 text-xs font-medium text-ink hover:bg-line-soft';

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Arrow inspector (spec §9): direction, access, reads and writes, last payload. */
export function WireInspector() {
  const key = useUiStore((s) => s.wireKey);
  const setWire = useUiStore((s) => s.setWire);
  const edge = useWorkspaceStore((s) => s.edges.find((e) => e.id === key));
  const panels = useWorkspaceStore((s) => s.snapshot?.board.panels);
  const dispatch = useWorkspaceStore((s) => s.dispatch);
  const lastUse = useConnectionStore((s) => (key ? s.lastUse[key] : undefined));
  const [history, setHistory] = useState<ConnectionUse[]>([]);
  const [copied, setCopied] = useState(false);
  const pair = edge?.data?.pair;

  useEffect(() => {
    if (key && !edge) setWire(null);
  }, [key, edge, setWire]);

  useEffect(() => {
    if (!pair) return;
    void window.plancia.connections
      .history(pair.terminalId, pair.panelId)
      .then((list) => setHistory([...list].reverse()));
  }, [pair, lastUse]);

  if (!pair) return null;
  const terminal = panels?.find((p) => p.id === pair.terminalId);
  const panel = panels?.find((p) => p.id === pair.panelId);
  const kind = wireKind(pair);
  const arrow = kind === 'both' ? '⇄' : kind === 'read' ? '→' : '←';
  const reads = history.filter((u) => u.kind === 'read').length;
  const writes = history.length - reads;
  const latest = history[0];

  const add = (direction: 'read' | 'write') =>
    void dispatch(
      direction === 'read'
        ? { type: 'connect', source: pair.panelId, target: pair.terminalId }
        : { type: 'connect', source: pair.terminalId, target: pair.panelId },
    );

  return (
    <aside
      aria-label="Collegamento"
      className="absolute top-16 right-4 bottom-[72px] z-30 flex w-[360px] flex-col overflow-hidden rounded-xl border border-line-strong bg-chrome shadow-[0_24px_60px_rgba(0,0,0,.55)]"
    >
      <header className="flex items-start gap-2.5 border-b border-line-soft py-3 pr-3 pl-3.5">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[13.5px] font-semibold">
            {panel?.title} <span style={{ color: WIRE_COLORS[kind] }}>{arrow}</span>{' '}
            {terminal?.title}
          </span>
          <span className="font-mono text-[11.5px] text-ink-3">
            accesso: {accessLabel(pair)} ·{' '}
            {kind === 'both'
              ? 'Claude legge e scrive'
              : kind === 'read'
                ? 'Claude legge'
                : 'Claude scrive'}
          </span>
        </div>
        <button
          type="button"
          aria-label="Chiudi"
          onClick={() => setWire(null)}
          className="grid size-[26px] place-items-center rounded-md text-ink-4 hover:bg-line-soft hover:text-ink"
        >
          <XIcon size={14} />
        </button>
      </header>

      <div className="flex gap-4 border-b border-line-soft px-3.5 py-2 text-[11.5px] text-ink-3">
        <span>
          letture <span className="font-mono text-ink">{reads}</span>
        </span>
        <span>
          scritture <span className="font-mono text-ink">{writes}</span>
        </span>
        {latest && (
          <span>
            ultimo <span className="font-mono text-ink">~{estimateTokens(latest.chars)}</span> token
          </span>
        )}
      </div>

      <ol className="max-h-[38%] shrink-0 overflow-y-auto border-b border-line-soft py-1">
        {history.length === 0 && (
          <li className="px-3.5 py-3 text-xs text-ink-4">
            Ancora nessuna lettura o scrittura. Claude vedrà il collegamento al prossimo messaggio.
          </li>
        )}
        {history.map((use, i) => (
          <li key={`${use.at}-${i}`} className="flex items-center gap-2 px-3.5 py-1 text-[11.5px]">
            {use.kind === 'read' ? (
              <EyeIcon size={13} style={{ color: WIRE_COLORS.read }} />
            ) : (
              <PencilSimpleIcon size={13} style={{ color: WIRE_COLORS.write }} />
            )}
            <span className="min-w-0 flex-1 truncate text-ink-2">
              {use.kind === 'read' ? 'letto' : 'scritto'} · {VIA[use.via]}
            </span>
            <span className="shrink-0 font-mono text-ink-4">
              v{use.version} · {use.chars} car · ~{estimateTokens(use.chars)} tok
            </span>
            <span className="shrink-0 font-mono text-[10.5px] text-ink-6">{time(use.at)}</span>
          </li>
        ))}
      </ol>

      <div className="flex min-h-0 flex-1 flex-col">
        <span className="px-3.5 pt-2.5 pb-1 font-mono text-[10.5px] tracking-[.06em] text-ink-5 uppercase">
          Ultimo contenuto passato
        </span>
        <pre className="min-h-0 flex-1 overflow-auto bg-canvas px-3.5 py-2.5 font-mono text-[11.5px] leading-[18px] whitespace-pre-wrap text-ink-2">
          {latest ? latest.preview : '—'}
        </pre>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-line-soft px-3 py-2.5">
        {latest && (
          <button
            type="button"
            className={BUTTON}
            onClick={() =>
              void navigator.clipboard.writeText(latest.preview).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
            }
          >
            <CopyIcon size={13} />
            {copied ? 'Copiato' : 'Copia'}
          </button>
        )}
        {!pair.read && (
          <button type="button" className={BUTTON} onClick={() => add('read')}>
            <PlusIcon size={13} />
            Lettura
          </button>
        )}
        {!pair.write && (
          <button type="button" className={BUTTON} onClick={() => add('write')}>
            <PlusIcon size={13} />
            Scrittura
          </button>
        )}
        <button
          type="button"
          onClick={() => void dispatch({ type: 'disconnect', ids: pair.connectionIds })}
          className="ml-auto flex h-[30px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-danger hover:bg-accent/12"
        >
          <LinkBreakIcon size={13} />
          Scollega
        </button>
      </div>
    </aside>
  );
}
