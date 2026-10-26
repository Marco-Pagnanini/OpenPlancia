import type { PanelType, Size, TerminalMode } from './types';

export const DEFAULT_PANEL_SIZES: Record<PanelType, Size> = {
  terminal: { width: 640, height: 400 },
  markdown: { width: 480, height: 560 },
  architecture: { width: 640, height: 480 },
  code: { width: 640, height: 480 },
};

export const MIN_PANEL_SIZE: Size = { width: 240, height: 160 };

export function defaultPanelTitle(type: PanelType, mode?: TerminalMode): string {
  switch (type) {
    case 'terminal':
      return mode === 'claude' ? 'Claude' : 'Terminale';
    case 'markdown':
      return 'AGENTS.md';
    case 'architecture':
      return 'Architettura';
    case 'code':
      return 'Codice';
  }
}
