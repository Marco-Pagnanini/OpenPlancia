import { CheckCircleIcon, InfoIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react';
import { useUiStore, type ToastTone } from '../stores/uiStore';

/** Green for something that worked, accent only for a refusal: never an alarming dot for good news. */
const TONE: Record<ToastTone, { icon: typeof InfoIcon; className: string }> = {
  success: { icon: CheckCircleIcon, className: 'text-[#7fb59b]' },
  info: { icon: InfoIcon, className: 'text-ink-4' },
  warning: { icon: WarningCircleIcon, className: 'text-accent' },
};

export function InfoToast() {
  const toast = useUiStore((s) => s.toast);
  const hide = useUiStore((s) => s.hideToast);
  if (!toast) return null;
  const { icon: Icon, className } = TONE[toast.tone];
  return (
    <div
      role="status"
      className="absolute bottom-[68px] left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line-strong bg-chrome py-1.5 pr-1.5 pl-3.5 text-[12.5px] whitespace-nowrap text-ink-2 shadow-[0_12px_36px_rgba(0,0,0,.45)]"
    >
      <Icon size={14} weight="fill" className={className} />
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
