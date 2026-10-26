import type { AgentStatus, Panel } from '@shared/types';
import { useArchitectureStore } from '../stores/architectureStore';

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
    case 'folder':
      return 'cartella';
  }
}

const CLAUDE_STATUS: Record<AgentStatus, string> = {
  'not-started': 'non avviato',
  idle: 'in attesa',
  working: 'al lavoro',
  'needs-input': 'richiede input',
  exited: 'terminato',
};

const SHELL_STATUS: Record<AgentStatus, string> = {
  ...CLAUDE_STATUS,
  idle: 'attivo',
  working: 'attivo',
};

export function statusLabel(mode: 'shell' | 'claude', status: AgentStatus): string {
  return (mode === 'claude' ? CLAUDE_STATUS : SHELL_STATUS)[status];
}

/**
 * Asks before deleting panels that would kill a running process. The spec asks for this when
 * Claude is working; any live terminal gets it, since Backspace on a selected panel deletes it.
 */
export function confirmDelete(panels: Panel[]): boolean {
  // An architecture lives only in .plancia/: deleting the panel deletes the drawing.
  const docs = useArchitectureStore.getState().docs;
  const drawings = panels.filter(
    (p) => p.type === 'architecture' && (docs[p.id]?.nodes.length ?? 0) > 0,
  );
  if (drawings.length > 0) {
    const names = drawings.map((p) => `«${p.title}»`).join(', ');
    if (!window.confirm(`Eliminare ${names}? Il diagramma verrà cancellato.`)) return false;
  }
  const live = panels.filter(
    (p) => p.type === 'terminal' && p.status !== 'not-started' && p.status !== 'exited',
  );
  if (live.length === 0) return true;
  const names = live.map((p) => `«${p.title}»`).join(', ');
  const busy = live.some(
    (p) => p.type === 'terminal' && (p.status === 'working' || p.status === 'needs-input'),
  );
  return window.confirm(
    busy
      ? `Claude sta lavorando in ${names}. Eliminare e chiudere il processo?`
      : `${names} ha un processo in esecuzione. Eliminare il panel e chiudere il processo?`,
  );
}
