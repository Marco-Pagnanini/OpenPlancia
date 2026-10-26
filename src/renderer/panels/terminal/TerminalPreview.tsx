import { useEffect, useState } from 'react';
import type { TerminalPanel } from '@shared/types';
import { statusLabel } from '../panelMeta';
import { terminalRegistry } from './terminalRegistry';

const LINES = 14;

/** Plain-text stand-in shown below 60% zoom, where xterm would be blurry and costly. */
export function TerminalPreview({ panel }: { panel: TerminalPanel }) {
  const [lines, setLines] = useState(() => terminalRegistry.lastLines(panel.id, LINES));

  useEffect(() => {
    const timer = setInterval(() => setLines(terminalRegistry.lastLines(panel.id, LINES)), 1000);
    return () => clearInterval(timer);
  }, [panel.id]);

  return (
    <div className="flex h-full flex-col justify-end gap-3 overflow-hidden p-4">
      {lines.length > 0 && (
        <pre className="min-h-0 overflow-hidden font-mono text-[13px] leading-snug text-ink-3">
          {lines.join('\n')}
        </pre>
      )}
      <span className="text-2xl text-ink-4">{statusLabel(panel.mode, panel.status)}</span>
    </div>
  );
}
