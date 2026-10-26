import { FolderOpenIcon } from '@phosphor-icons/react';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { Logo } from './Logo';

export function EmptyState() {
  const openFolder = useWorkspaceStore((s) => s.openFolder);
  return (
    <main className="dot-grid flex h-full flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo className="size-36" />
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em]">plancia</h1>
        <p className="max-w-[46ch] text-[13.5px] text-pretty text-ink-3">
          Apri la cartella di un progetto per iniziare. La lavagna viene salvata in{' '}
          <code className="font-mono text-[12.5px] text-ink-2">.plancia/board.json</code>.
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
    </main>
  );
}
