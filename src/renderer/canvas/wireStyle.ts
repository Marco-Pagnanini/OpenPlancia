import type { WirePair } from '@shared/access';

/** Spec §6: read = blue, write = amber, both = one purple double-headed wire. */
export const WIRE_COLORS = {
  read: '#8fa9c9',
  write: '#e0b97e',
  both: '#b294d6',
} as const;

export type WireKind = keyof typeof WIRE_COLORS;

/** Arrows between two Claude terminals (M8): messages, not data. */
export const AGENT_COLOR = '#6fbfae';

export function wireKind(pair: Pick<WirePair, 'read' | 'write'>): WireKind {
  return pair.read && pair.write ? 'both' : pair.read ? 'read' : 'write';
}

export const WIRE_LABEL: Record<WireKind, string> = {
  read: 'lettura',
  write: 'scrittura',
  both: 'lettura · scrittura',
};
