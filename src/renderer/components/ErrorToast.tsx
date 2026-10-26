import { WarningIcon, XIcon } from '@phosphor-icons/react';
import { useWorkspaceStore } from '../stores/workspaceStore';

export function ErrorToast() {
  const error = useWorkspaceStore((s) => s.error);
  const clear = useWorkspaceStore((s) => s.clearError);
  if (!error) return null;
  return (
    <div
      role="alert"
      className="fixed top-16 right-4 z-50 flex max-w-md items-start gap-2.5 rounded-xl border border-accent/60 bg-chrome p-3 text-[12.5px] text-ink-2 shadow-[0_24px_60px_rgba(0,0,0,.55)]"
    >
      <WarningIcon size={16} className="mt-px shrink-0 text-danger" />
      <pre className="min-w-0 flex-1 font-sans whitespace-pre-wrap">{error}</pre>
      <button
        type="button"
        onClick={clear}
        aria-label="Chiudi"
        className="grid size-6 shrink-0 place-items-center rounded-md text-ink-4 hover:bg-line-soft hover:text-ink"
      >
        <XIcon size={13} />
      </button>
    </div>
  );
}
