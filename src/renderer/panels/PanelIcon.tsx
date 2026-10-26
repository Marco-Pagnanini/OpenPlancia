import {
  CodeIcon,
  FileTextIcon,
  RobotIcon,
  TerminalWindowIcon,
  TreeStructureIcon,
} from '@phosphor-icons/react';
import type { PanelType, TerminalMode } from '@shared/types';

export function PanelIcon({
  type,
  mode,
  size = 15,
  className = '',
}: {
  type: PanelType;
  mode?: TerminalMode | undefined;
  size?: number;
  className?: string;
}) {
  const props = { size, className: `shrink-0 ${className}`, 'aria-hidden': true } as const;
  switch (type) {
    case 'terminal':
      return mode === 'claude' ? <RobotIcon {...props} /> : <TerminalWindowIcon {...props} />;
    case 'markdown':
      return <FileTextIcon {...props} />;
    case 'architecture':
      return <TreeStructureIcon {...props} />;
    case 'code':
      return <CodeIcon {...props} />;
  }
}
