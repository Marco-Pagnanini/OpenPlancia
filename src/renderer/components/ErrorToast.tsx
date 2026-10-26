import { useWorkspaceStore } from '../stores/workspaceStore';

export function ErrorToast() {
  const error = useWorkspaceStore((s) => s.error);
  const clear = useWorkspaceStore((s) => s.clearError);
  if (!error) return null;
  return (
    <div
      role="alert"
      className="fixed right-4 bottom-4 z-50 flex max-w-md items-start gap-3 rounded-lg border border-red-900 bg-red-950/95 p-3 text-sm text-red-200 shadow-xl"
    >
      <pre className="min-w-0 flex-1 font-sans whitespace-pre-wrap">{error}</pre>
      <button
        type="button"
        onClick={clear}
        aria-label="Chiudi"
        className="text-red-300 hover:text-white"
      >
        ✕
      </button>
    </div>
  );
}
