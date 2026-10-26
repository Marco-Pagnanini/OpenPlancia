import { TerminalWindowIcon } from '@phosphor-icons/react';
import { Logo } from '../components/Logo';
import { useTerminalStore } from '../stores/terminalStore';
import { useWorkspaceStore } from '../stores/workspaceStore';

function AgentsPill() {
  const panels = useWorkspaceStore((s) => s.snapshot?.board.panels);
  const agents = panels?.filter((p) => p.type === 'terminal' && p.mode === 'claude') ?? [];
  const appInfo = useTerminalStore((s) => s.appInfo);
  const busy = agents.some(
    (p) => p.type === 'terminal' && (p.status === 'working' || p.status === 'needs-input'),
  );
  return (
    <span
      title={appInfo ? (appInfo.claudeVersion ?? 'Claude Code non trovato nel PATH') : undefined}
      className="flex items-center gap-2 rounded-[10px] border border-line bg-chrome px-3 py-[7px] text-[12.5px] text-ink-2"
    >
      {busy && <span className="size-[7px] animate-pulse-dot rounded-full bg-accent" />}
      <TerminalWindowIcon size={14} className="text-ink-3" />
      {agents.length} {agents.length === 1 ? 'agente' : 'agenti'}
    </span>
  );
}

export function TopBar() {
  const name = useWorkspaceStore((s) => s.snapshot?.name);
  const openFolder = useWorkspaceStore((s) => s.openFolder);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex h-14 items-center justify-between px-4">
      <button
        type="button"
        onClick={() => void openFolder()}
        title="Cambia cartella progetto"
        className="pointer-events-auto flex items-center gap-2.5 rounded-[10px] border border-line bg-chrome py-[5px] pr-3 pl-2 hover:bg-raised"
      >
        <Logo className="size-[22px]" />
        <span className="text-sm font-semibold tracking-[-0.01em]">plancia</span>
        <span className="text-ink-7">/</span>
        <span className="max-w-64 truncate font-mono text-[12.5px] text-ink-3">{name}</span>
      </button>
      <div className="pointer-events-auto flex items-center gap-2">
        <AgentsPill />
      </div>
    </div>
  );
}
