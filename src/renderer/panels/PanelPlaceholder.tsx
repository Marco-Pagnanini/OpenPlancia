import type { Panel } from '@shared/types';

interface PlaceholderCopy {
  title: string;
  text: string;
  meta?: string;
}

function copy(panel: Panel): PlaceholderCopy {
  switch (panel.type) {
    case 'terminal':
      return panel.mode === 'claude'
        ? {
            title: 'Claude Code',
            text: 'Qui girerà Claude Code. Collega i panel con le frecce per dargli contesto.',
            meta: `cwd ${panel.cwd}`,
          }
        : {
            title: 'Terminale',
            text: 'Qui girerà una shell nella cartella del progetto.',
            meta: `cwd ${panel.cwd}`,
          };
    case 'markdown':
      return {
        title: panel.filePath,
        text: 'Qui leggi e modifichi il file. Claude lo vede quando lo colleghi.',
      };
    case 'architecture':
      return {
        title: 'Nessun nodo',
        text: 'Disegna servizi e relazioni: Claude li riceve come JSON.',
        meta: `.plancia/panels/${panel.id}.arch.json`,
      };
    case 'code':
      return {
        title: 'Nessun file aperto',
        text: 'Qui vedi il codice che Claude scrive, riga per riga.',
      };
    case 'folder':
      return {
        title: `${panel.dirPath}/`,
        text: 'I file markdown della cartella, in un solo panel.',
      };
  }
}

/** Empty body until each panel type gets its real content (M2–M7). */
export function PanelPlaceholder({ panel }: { panel: Panel }) {
  const { title, text, meta } = copy(panel);
  return (
    <div
      className={`flex h-full flex-col items-center justify-center gap-1.5 p-6 text-center ${
        panel.type === 'architecture'
          ? 'bg-[radial-gradient(circle,#262624_1px,transparent_1.4px)] bg-size-[16px_16px]'
          : ''
      }`}
    >
      <span className="text-[13px] text-ink-2">{title}</span>
      <span className="max-w-[34ch] text-xs text-pretty text-ink-4">{text}</span>
      {meta && <span className="mt-2 font-mono text-[11px] text-ink-6">{meta}</span>}
    </div>
  );
}
