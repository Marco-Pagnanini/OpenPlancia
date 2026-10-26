import {
  CodeIcon,
  FileTextIcon,
  RobotIcon,
  TerminalWindowIcon,
  TreeStructureIcon,
  type Icon,
} from '@phosphor-icons/react';
import type { PanelType, TerminalMode } from '@shared/types';

export function panelIcon(type: PanelType, mode?: TerminalMode): Icon {
  switch (type) {
    case 'terminal':
      return mode === 'claude' ? RobotIcon : TerminalWindowIcon;
    case 'markdown':
      return FileTextIcon;
    case 'architecture':
      return TreeStructureIcon;
    case 'code':
      return CodeIcon;
  }
}
