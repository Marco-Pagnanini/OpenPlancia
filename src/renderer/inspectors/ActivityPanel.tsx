import {
  BellRingingIcon,
  ChatTextIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  MinusCircleIcon,
  PlayIcon,
  SparkleIcon,
  WarningCircleIcon,
  WrenchIcon,
  XCircleIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';
import type { ActivityEvent } from '@shared/activity';
import { useActivityStore } from '../stores/activityStore';
import { useUiStore } from '../stores/uiStore';
import { useWorkspaceStore } from '../stores/workspaceStore';

const EMPTY: ActivityEvent[] = [];
const ICON = 'mt-px shrink-0';

function EventIcon({ event }: { event: ActivityEvent }) {
  switch (event.kind) {
    case 'session':
      return <PlayIcon size={14} className={`${ICON} text-ink-4`} />;
    case 'prompt':
      return <ChatTextIcon size={14} className={`${ICON} text-ink-2`} />;
    case 'attention':
      return <BellRingingIcon size={14} className={`${ICON} text-accent`} />;
    case 'response':
      return <SparkleIcon size={14} className={`${ICON} text-accent-soft`} />;
    case 'error':
      return <WarningCircleIcon size={14} className={`${ICON} text-danger`} />;
    case 'tool':
      switch (event.tool?.state) {
        case 'running':
          return <CircleNotchIcon size={14} className={`${ICON} animate-spin text-accent`} />;
        case 'failed':
          return <XCircleIcon size={14} className={`${ICON} text-danger`} />;
        case 'ok':
          return <CheckCircleIcon size={14} className={`${ICON} text-ink-4`} />;
        case 'cancelled':
          return <MinusCircleIcon size={14} className={`${ICON} text-ink-6`} />;
        default:
          return <WrenchIcon size={14} className={`${ICON} text-ink-4`} />;
      }
  }
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Side panel with the chronological activity of one Claude terminal (spec §9). */
export function ActivityPanel() {
  const terminalId = useUiStore((s) => s.activityId);
  const setActivity = useUiStore((s) => s.setActivity);
  const panel = useWorkspaceStore((s) => s.snapshot?.board.panels.find((p) => p.id === terminalId));
  const events = useActivityStore(
    (s) => (terminalId ? s.byTerminal[terminalId] : undefined) ?? EMPTY,
  );
  const load = useActivityStore((s) => s.load);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (terminalId) void load(terminalId);
  }, [terminalId, load]);

  useEffect(() => {
    if (terminalId && !panel) setActivity(null);
  }, [terminalId, panel, setActivity]);

  // Follow the newest entry.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [events.length]);

  if (!terminalId || !panel) return null;

  return (
    <aside
      aria-label="Attività"
      className="absolute top-16 right-4 bottom-[72px] z-30 flex w-[360px] flex-col overflow-hidden rounded-xl border border-line-strong bg-chrome shadow-[0_24px_60px_rgba(0,0,0,.55)]"
    >
      <header className="flex items-start gap-2.5 border-b border-line-soft py-3 pr-3 pl-3.5">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[13.5px] font-semibold">Attività</span>
          <span className="truncate font-mono text-[11.5px] text-ink-3">{panel.title}</span>
        </div>
        <button
          type="button"
          aria-label="Chiudi"
          onClick={() => setActivity(null)}
          className="grid size-[26px] place-items-center rounded-md text-ink-4 hover:bg-line-soft hover:text-ink"
        >
          <XIcon size={14} />
        </button>
      </header>
      {events.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-pretty text-ink-4">
          Nessuna attività. Qui compaiono prompt, tool usati, richieste di permesso e risposte,
          mentre Claude lavora.
        </div>
      ) : (
        <ol ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1.5">
          {events.map((event) => (
            <li key={event.id} className="flex gap-2.5 px-3.5 py-1.5 hover:bg-hover/50">
              <EventIcon event={event} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-baseline gap-2">
                  <span
                    className={`min-w-0 flex-1 truncate text-[12.5px] ${
                      event.kind === 'tool' ? 'font-mono text-ink-2' : 'text-ink'
                    }`}
                    title={event.title}
                  >
                    {event.title}
                  </span>
                  <span className="shrink-0 font-mono text-[10.5px] text-ink-6">
                    {time(event.at)}
                  </span>
                </div>
                {event.detail && (
                  <p className="line-clamp-3 text-[11.5px] break-words whitespace-pre-wrap text-ink-4">
                    {event.detail}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
