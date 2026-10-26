import {
  CircleDashedIcon,
  CubeIcon,
  DatabaseIcon,
  DesktopIcon,
  GlobeIcon,
  HardDrivesIcon,
  PlugIcon,
  QueueIcon,
  type Icon,
} from '@phosphor-icons/react';
import type { ArchNodeKind } from '@shared/architecture';

/** Icon and colour for each kind of node (spec §8.3). */
export const ARCH_KIND_STYLE: Record<ArchNodeKind, { icon: Icon; color: string }> = {
  service: { icon: CubeIcon, color: '#8fa9c9' },
  api: { icon: PlugIcon, color: '#d98b6a' },
  database: { icon: DatabaseIcon, color: '#7fb59b' },
  queue: { icon: QueueIcon, color: '#d9b46a' },
  storage: { icon: HardDrivesIcon, color: '#b8a07a' },
  client: { icon: DesktopIcon, color: '#b294d6' },
  external: { icon: GlobeIcon, color: '#9aa7b0' },
  other: { icon: CircleDashedIcon, color: '#8a8982' },
};

/** Order of the kinds in the "Aggiungi nodo" menu. */
export const ARCH_KINDS = Object.keys(ARCH_KIND_STYLE) as ArchNodeKind[];
