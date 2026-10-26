import { CheckIcon, CopyIcon, XIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { formatArchitectureForClaude } from '@shared/architecture';
import { useArchitectureStore } from '../stores/architectureStore';
import { estimateTokens } from '../stores/connectionStore';
import { useUiStore } from '../stores/uiStore';
import { useWorkspaceStore } from '../stores/workspaceStore';

/** "Vedi JSON" (spec §8.3): the ArchitectureDoc exactly as Claude receives it, read-only. */
export function ArchJsonModal() {
  const panelId = useUiStore((s) => s.archJsonFor);
  const close = useUiStore((s) => s.setArchJsonFor);
  const doc = useArchitectureStore((s) => (panelId ? s.docs[panelId] : undefined));
  const title = useWorkspaceStore(
    (s) => s.snapshot?.board.panels.find((p) => p.id === panelId)?.title,
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!panelId) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelId, close]);

  if (!panelId || !doc) return null;
  const text = formatArchitectureForClaude(doc);
  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-canvas/70 p-8 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && close(null)}
    >
      <div
        role="dialog"
        aria-label="JSON dell'architettura"
        className="flex max-h-full w-[min(760px,100%)] flex-col overflow-hidden rounded-xl border border-line-strong bg-chrome shadow-[0_24px_60px_rgba(0,0,0,.55)]"
      >
        <header className="flex items-start gap-2.5 border-b border-line-soft py-3 pr-3 pl-4">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[13.5px] font-semibold">JSON per Claude</span>
            <span className="truncate font-mono text-[11.5px] text-ink-3">
              {title} · {text.length} caratteri · ~{estimateTokens(text.length)} token
            </span>
          </div>
          <button
            type="button"
            onClick={copy}
            className="flex h-[26px] items-center gap-1.5 rounded-md px-2 text-[12px] text-ink-3 hover:bg-line-soft hover:text-ink"
          >
            {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
            {copied ? 'Copiato' : 'Copia'}
          </button>
          <button
            type="button"
            aria-label="Chiudi"
            onClick={() => close(null)}
            className="grid size-[26px] place-items-center rounded-md text-ink-4 hover:bg-line-soft hover:text-ink"
          >
            <XIcon size={14} />
          </button>
        </header>
        <pre className="min-h-0 flex-1 overflow-auto bg-canvas px-4 py-3 font-mono text-[12px] leading-[19px] whitespace-pre-wrap text-ink-2">
          {text}
        </pre>
        <p className="border-t border-line-soft px-4 py-2.5 text-[11.5px] text-pretty text-ink-4">
          Le posizioni dei nodi non vengono inviate: servono solo a disegnare. Claude lo riceve così
          nel contesto o con mcp__plancia__read_panel, e lo riscrive intero con write_panel.
        </p>
      </div>
    </div>
  );
}
