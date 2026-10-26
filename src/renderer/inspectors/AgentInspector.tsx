import { ArrowRightIcon, LinkBreakIcon, PlusIcon, XIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import type { AgentMessage } from '@shared/ipc';
import type { TerminalPanel } from '@shared/types';
import { AGENT_COLOR } from '../canvas/wireStyle';
import { estimateTokens, useConnectionStore } from '../stores/connectionStore';
import { useUiStore } from '../stores/uiStore';
import { useWorkspaceStore } from '../stores/workspaceStore';

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Inspector of the wire between two agents (M8): who may write to whom, and their messages. */
export function AgentInspector({ wireKey }: { wireKey: string }) {
  const setWire = useUiStore((s) => s.setWire);
  const edge = useWorkspaceStore((s) => s.edges.find((e) => e.id === wireKey));
  const panels = useWorkspaceStore((s) => s.snapshot?.board.panels);
  const dispatch = useWorkspaceStore((s) => s.dispatch);
  const last = useConnectionStore((s) => s.lastMessage[wireKey]);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const agents = edge?.type === 'agent' ? edge.data?.agents : undefined;

  useEffect(() => {
    if (!edge) setWire(null);
  }, [edge, setWire]);

  useEffect(() => {
    if (!agents) return;
    void window.plancia.agents
      .history(agents.a, agents.b)
      .then((list) => setMessages([...list].reverse()));
  }, [agents, last]);

  if (!agents) return null;
  const terminal = (id: string) =>
    panels?.find((p): p is TerminalPanel => p.id === id && p.type === 'terminal');
  const title = (id: string) => terminal(id)?.title ?? 'Claude';
  const directions = [
    { from: agents.a, to: agents.b, on: agents.aToB },
    { from: agents.b, to: agents.a, on: agents.bToA },
  ];

  return (
    <aside
      aria-label="Messaggi tra agenti"
      className="absolute top-16 right-4 bottom-[72px] z-30 flex w-[360px] flex-col overflow-hidden rounded-xl border border-line-strong bg-chrome shadow-[0_24px_60px_rgba(0,0,0,.55)]"
    >
      <header className="flex items-start gap-2.5 border-b border-line-soft py-3 pr-3 pl-3.5">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[13.5px] font-semibold">
            {title(agents.a)}{' '}
            <span style={{ color: AGENT_COLOR }}>
              {agents.aToB && agents.bToA ? '⇄' : agents.aToB ? '→' : '←'}
            </span>{' '}
            {title(agents.b)}
          </span>
          <span className="font-mono text-[11.5px] text-ink-3">
            messaggi tra agenti · SendMessage di Claude Code
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

      <ul className="flex flex-col gap-1 border-b border-line-soft px-3.5 py-2.5 text-[12px]">
        {directions.map(({ from, to, on }) => (
          <li key={from} className="flex items-center gap-2">
            <span className="min-w-0 truncate text-ink-2">{title(from)}</span>
            <ArrowRightIcon size={12} style={{ color: on ? AGENT_COLOR : 'var(--color-ink-6)' }} />
            <span className="min-w-0 flex-1 truncate text-ink-2">{title(to)}</span>
            {on ? (
              <span className="shrink-0 text-[11px] text-ink-4">può scrivere</span>
            ) : (
              <button
                type="button"
                className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] text-ink-3 hover:bg-line-soft hover:text-ink"
                onClick={() => void dispatch({ type: 'connect', source: from, target: to })}
              >
                <PlusIcon size={11} />
                Consenti
              </button>
            )}
          </li>
        ))}
      </ul>

      <ol className="min-h-0 flex-1 overflow-y-auto py-1">
        {messages.length === 0 && (
          <li className="px-3.5 py-3 text-xs text-pretty text-ink-4">
            Ancora nessun messaggio. Ogni agente vede le frecce nel contesto del prossimo messaggio
            e può scrivere all'altro con SendMessage.
          </li>
        )}
        {messages.map((m, i) => (
          <li
            key={`${m.at}-${i}`}
            className="border-b border-line-soft px-3.5 py-2 last:border-b-0"
          >
            <div className="flex items-center gap-1.5 text-[11.5px]">
              <span className="truncate text-ink-2">{title(m.from)}</span>
              <ArrowRightIcon size={11} style={{ color: AGENT_COLOR }} />
              <span className="min-w-0 flex-1 truncate text-ink-2">{title(m.to)}</span>
              <span className="shrink-0 font-mono text-[10.5px] text-ink-6">{time(m.at)}</span>
            </div>
            {m.summary && <p className="mt-1 text-[12px] font-medium text-ink">{m.summary}</p>}
            <details className="mt-1">
              <summary className="cursor-pointer text-[11px] text-ink-4 hover:text-ink-2">
                {m.chars} car · ~{estimateTokens(m.chars)} token
              </summary>
              <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-canvas p-2 font-mono text-[11.5px] leading-[18px] whitespace-pre-wrap text-ink-2">
                {m.text}
                {m.chars > m.text.length ? '\n…' : ''}
              </pre>
            </details>
          </li>
        ))}
      </ol>

      <div className="flex border-t border-line-soft px-3 py-2.5">
        <button
          type="button"
          onClick={() => void dispatch({ type: 'disconnect', ids: agents.connectionIds })}
          className="ml-auto flex h-[30px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-danger hover:bg-accent/12"
        >
          <LinkBreakIcon size={13} />
          Scollega
        </button>
      </div>
    </aside>
  );
}
