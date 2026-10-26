import { createElement } from 'react';
import type { PanelType, TerminalMode } from '@shared/types';
import { panelIcon } from './panelIcons';

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
  // One mapping for every place that shows a panel's icon (panelIcons.ts).
  return createElement(panelIcon(type, mode), {
    size,
    className: `shrink-0 ${className}`,
    'aria-hidden': true,
  });
}
