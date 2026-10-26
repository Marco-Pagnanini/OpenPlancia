import { ClockCounterClockwiseIcon, FolderOpenIcon, FolderSimpleIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import type { RecentWorkspace } from '@shared/ipc';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { Logo } from './Logo';

/** Home screen: open a project folder, or pick up a recent one. */
export function EmptyState() {
  const openFolder = useWorkspaceStore((s) => s.openFolder);
  const openRecent = useWorkspaceStore((s) => s.openRecent);
  const [recent, setRecent] = useState<RecentWorkspace[]>([]);

  useEffect(() => {
    void window.plancia.workspace.recent().then(setRecent);
  }, []);

  return (
    <main className="dot-grid flex h-full flex-col items-center justify-center gap-6 overflow-y-auto px-6 py-10 text-center">
      <Logo className="size-32" />
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-[30px] font-semibold tracking-[-0.02em]">OpenPlancia</h1>
        <p className="max-w-[48ch] text-[13.5px] text-pretty text-ink-3">
          Una lavagna per lavorare con Claude Code: terminali, file e schemi sulla stessa tela, e
          frecce che decidono cosa Claude legge e scrive.
        </p>
      </div>
      <button
        type="button"
        onClick={() => void openFolder()}
        className="flex h-[34px] items-center gap-[7px] rounded-[10px] bg-ink px-3.5 text-[12.5px] font-medium text-on-light hover:bg-white active:translate-y-px"
      >
        <FolderOpenIcon size={14} />
        Apri cartella progetto
      </button>

      {recent.length > 0 && (
        <section className="mt-2 w-full max-w-[460px] text-left">
          <h2 className="mb-2 flex items-center gap-1.5 px-1 font-mono text-[10.5px] tracking-[.06em] text-ink-5 uppercase">
            <ClockCounterClockwiseIcon size={12} />
            Recenti
          </h2>
          <ul className="overflow-hidden rounded-xl border border-line bg-chrome">
            {recent.map((item) => (
              <li key={item.path} className="border-b border-line-soft last:border-b-0">
                <button
                  type="button"
                  disabled={!item.exists}
                  onClick={() => void openRecent(item.path)}
                  title={item.exists ? item.path : 'Cartella non trovata'}
                  className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-hover disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
                >
                  <FolderSimpleIcon size={16} className="shrink-0 text-accent" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13px] text-ink">{item.name}</span>
                    <span className="truncate font-mono text-[11px] text-ink-5">{item.path}</span>
                  </span>
                  {!item.exists && (
                    <span className="shrink-0 text-[11px] text-ink-5">non trovata</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="max-w-[52ch] text-[11.5px] text-pretty text-ink-6">
        La lavagna di ogni progetto viene salvata in{' '}
        <code className="font-mono text-ink-4">.plancia/board.json</code>, dentro la cartella.
      </p>
    </main>
  );
}
