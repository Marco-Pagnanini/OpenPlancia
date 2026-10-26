import type { AgentStatus, Panel } from '@shared/types';

/** Short lowercase kind shown next to the panel title. */
export function panelKindLabel(panel: Panel): string {
  switch (panel.type) {
    case 'terminal':
      return panel.mode === 'claude' ? 'claude' : 'terminale';
    case 'markdown':
      return 'markdown';
    case 'architecture':
      return 'architettura';
    case 'code':
      return 'codice';
  }
}

export const STATUS_LABEL: Record<AgentStatus, string> = {
  'not-started': 'non avviato',
  idle: 'in attesa',
  working: 'al lavoro',
  'needs-input': 'richiede input',
  exited: 'terminato',
};
