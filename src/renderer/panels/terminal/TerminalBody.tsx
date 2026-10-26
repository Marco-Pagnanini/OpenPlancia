import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowSquareOutIcon,
  CornersInIcon,
  PlayIcon,
  WarningIcon,
} from '@phosphor-icons/react';
import { useEffect, useRef, type ReactNode } from 'react';
import type { TerminalPanel } from '@shared/types';
import { useTerminalStore } from '../../stores/terminalStore';
import { useUiStore } from '../../stores/uiStore';
import { terminalRegistry } from './terminalRegistry';

const PRIMARY =
  'flex h-[30px] items-center gap-1.5 rounded-lg bg-ink px-3 text-xs font-medium text-on-light hover:bg-white active:translate-y-px';
const SECONDARY =
  'flex h-[30px] items-center gap-1.5 rounded-lg border border-line-strong bg-raised px-3 text-xs font-medium text-ink hover:bg-line-soft';

function start(id: string, resume: boolean) {
  void useTerminalStore.getState().start(id, resume, terminalRegistry.size(id));
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      {children}
    </div>
  );
}

function StartScreen({ panel }: { panel: TerminalPanel }) {
  const claudeVersion = useTerminalStore((s) => s.appInfo?.claudeVersion);
  const isClaude = panel.mode === 'claude';
  return (
    <Centered>
      <div className="flex flex-col items-center gap-1.5">
        <span className="text-[13px] text-ink-2">
          {isClaude ? 'Sessione Claude non avviata' : 'Terminale non avviato'}
        </span>
        <span className="max-w-[36ch] text-xs text-pretty text-ink-4">
          {isClaude
            ? panel.claudeSessionId
              ? 'Riprendi la conversazione precedente o aprine una nuova.'
              : 'Avvia Claude Code nella cartella del progetto.'
            : 'I terminali non ripartono da soli alla riapertura della lavagna.'}
        </span>
      </div>
      <div className="flex gap-2">
        {isClaude && panel.claudeSessionId ? (
          <>
            <button type="button" className={PRIMARY} onClick={() => start(panel.id, true)}>
              <ArrowCounterClockwiseIcon size={13} />
              Riprendi sessione
            </button>
            <button type="button" className={SECONDARY} onClick={() => start(panel.id, false)}>
              Nuova sessione
            </button>
          </>
        ) : (
          <button type="button" className={PRIMARY} onClick={() => start(panel.id, false)}>
            <PlayIcon size={13} weight="fill" />
            {isClaude ? 'Avvia Claude' : 'Avvia terminale'}
          </button>
        )}
      </div>
      <span className="font-mono text-[11px] text-ink-6">
        cwd {panel.cwd}
        {isClaude && claudeVersion ? ` · ${claudeVersion}` : ''}
      </span>
    </Centered>
  );
}

function ErrorScreen({
  panel,
  code,
  message,
}: {
  panel: TerminalPanel;
  code: string;
  message: string;
}) {
  const installUrl = useTerminalStore((s) => s.appInfo?.claudeInstallUrl);
  return (
    <Centered>
      <WarningIcon size={22} className="text-danger" />
      <span className="max-w-[44ch] text-xs text-pretty text-ink-2">{message}</span>
      <div className="flex gap-2">
        {code === 'claude-not-found' && installUrl && (
          <button
            type="button"
            className={PRIMARY}
            onClick={() => void window.plancia.app.openExternal(installUrl)}
          >
            <ArrowSquareOutIcon size={13} />
            Come installare Claude Code
          </button>
        )}
        <button type="button" className={SECONDARY} onClick={() => start(panel.id, false)}>
          <ArrowClockwiseIcon size={13} />
          Riprova
        </button>
      </div>
    </Centered>
  );
}

function ExitBar({ panel }: { panel: TerminalPanel }) {
  const exitCode = useTerminalStore((s) => s.exitCodes[panel.id]);
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-t border-line-soft px-3 text-xs text-ink-3">
      <span className="min-w-0 flex-1 truncate">
        Processo terminato{exitCode !== undefined ? ` (codice ${exitCode})` : ''}
      </span>
      {panel.mode === 'claude' && panel.claudeSessionId ? (
        <>
          <button type="button" className={SECONDARY} onClick={() => start(panel.id, true)}>
            <ArrowCounterClockwiseIcon size={13} />
            Riprendi sessione
          </button>
          <button type="button" className={SECONDARY} onClick={() => start(panel.id, false)}>
            Nuova sessione
          </button>
        </>
      ) : (
        <button type="button" className={SECONDARY} onClick={() => start(panel.id, false)}>
          <ArrowClockwiseIcon size={13} />
          Riavvia
        </button>
      )}
    </div>
  );
}

function TerminalView({ panel }: { panel: TerminalPanel }) {
  const ref = useRef<HTMLDivElement>(null);
  const { id } = panel;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    void terminalRegistry.attach(id, el);
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => terminalRegistry.fit(id));
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      terminalRegistry.detach(id, el);
    };
  }, [id]);

  return (
    <div className="flex h-full flex-col">
      <div ref={ref} className="min-h-0 flex-1 overflow-hidden py-2 pr-1 pl-3" />
      {panel.status === 'exited' && <ExitBar panel={panel} />}
    </div>
  );
}

/** Body of a terminal panel, both on the canvas and in focus mode. */
export function TerminalBody({
  panel,
  variant,
}: {
  panel: TerminalPanel;
  variant: 'panel' | 'focus';
}) {
  const error = useTerminalStore((s) => s.errors[panel.id]);
  const inFocusMode = useUiStore((s) => s.focusId === panel.id);
  const setFocus = useUiStore((s) => s.setFocus);

  if (variant === 'panel' && inFocusMode) {
    return (
      <Centered>
        <span className="text-xs text-ink-4">Aperto in modalità focus</span>
        <button type="button" className={SECONDARY} onClick={() => setFocus(null)}>
          <CornersInIcon size={13} />
          Torna alla lavagna
        </button>
      </Centered>
    );
  }
  if (error) return <ErrorScreen panel={panel} code={error.code} message={error.message} />;
  if (panel.status === 'not-started') return <StartScreen panel={panel} />;
  return <TerminalView panel={panel} />;
}
