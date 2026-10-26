import { InfoIcon, XIcon } from '@phosphor-icons/react';
import { useUiStore } from '../stores/uiStore';

export function InfoToast() {
  const toast = useUiStore((s) => s.toast);
  const hide = useUiStore((s) => s.hideToast);
  if (!toast) return null;
  return (
    <div
      role="status"
      className="absolute bottom-[68px] left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line-strong bg-chrome py-1.5 pr-1.5 pl-3.5 text-[12.5px] whitespace-nowrap text-ink-2 shadow-[0_12px_36px_rgba(0,0,0,.45)]"
    >
      <InfoIcon size={14} className="text-accent" />
      {toast.message}
      <button
        type="button"
        aria-label="Chiudi"
        onClick={() => hide(toast.id)}
        className="grid size-6 place-items-center rounded-full text-ink-4 hover:bg-line-soft hover:text-ink"
      >
        <XIcon size={12} />
      </button>
    </div>
  );
}
