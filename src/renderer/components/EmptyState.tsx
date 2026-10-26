import { useWorkspaceStore } from '../stores/workspaceStore';
import { Logo } from './Logo';

export function EmptyState() {
  const openFolder = useWorkspaceStore((s) => s.openFolder);
  return (
    <main className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
      <Logo className="h-40 w-40" />
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Plancia</h1>
        <p className="text-sm text-zinc-400">
          Apri la cartella di un progetto per iniziare. La lavagna viene salvata in{' '}
          <code className="font-mono text-zinc-300">.plancia/board.json</code>.
        </p>
      </div>
      <button
        type="button"
        onClick={() => void openFolder()}
        className="rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-500"
      >
        Apri cartella progetto
      </button>
    </main>
  );
}
