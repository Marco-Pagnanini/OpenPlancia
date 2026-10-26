import type { Panel } from '@shared/types';

export function panelKindLabel(panel: Panel): string {
  switch (panel.type) {
    case 'terminal':
      return panel.mode === 'claude' ? 'Terminale Claude' : 'Terminale shell';
    case 'markdown':
      return 'Markdown';
    case 'architecture':
      return 'Architettura';
    case 'code':
      return 'Codice';
  }
}
