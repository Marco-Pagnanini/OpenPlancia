import { CursorIcon, HandIcon, type Icon } from '@phosphor-icons/react';
import type { PanelType, TerminalMode } from '@shared/types';
import { panelIcon } from '../panels/panelIcons';
import type { Tool } from '../stores/uiStore';

export type ToolItem =
  | { kind: 'mode'; tool: Tool; label: string; key: string; icon: Icon }
  | {
      kind: 'create';
      type: Exclude<PanelType, 'markdown' | 'folder'>;
      mode?: TerminalMode;
      label: string;
      key: string;
      icon: Icon;
    }
  /** Opens the "new / open file" menu. */
  | { kind: 'markdown'; label: string; key: string; icon: Icon }
  /** Asks for a folder of the project. */
  | { kind: 'folder'; label: string; key: string; icon: Icon }
  | { kind: 'separator' };

export const TOOL_ITEMS: ToolItem[] = [
  { kind: 'mode', tool: 'select', label: 'Puntatore', key: 'V', icon: CursorIcon },
  { kind: 'mode', tool: 'hand', label: 'Sposta lavagna', key: 'H', icon: HandIcon },
  { kind: 'separator' },
  {
    kind: 'create',
    type: 'terminal',
    mode: 'shell',
    label: 'Terminale',
    key: 'T',
    icon: panelIcon('terminal', 'shell'),
  },
  {
    kind: 'create',
    type: 'terminal',
    mode: 'claude',
    label: 'Claude',
    key: 'L',
    icon: panelIcon('terminal', 'claude'),
  },
  { kind: 'markdown', label: 'Markdown', key: 'M', icon: panelIcon('markdown') },
  { kind: 'folder', label: 'Cartella', key: 'F', icon: panelIcon('folder') },
  {
    kind: 'create',
    type: 'architecture',
    label: 'Architettura',
    key: 'A',
    icon: panelIcon('architecture'),
  },
  { kind: 'create', type: 'code', label: 'Codice', key: 'K', icon: panelIcon('code') },
];

export const TOOL_HINTS: Partial<Record<Tool, string>> = {
  hand: 'Trascina per spostarti. Ctrl + rotella per lo zoom.',
};
