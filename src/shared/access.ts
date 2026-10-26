import type { Connection, Panel, TerminalPanel } from './types';

/**
 * Connection rules (spec §6). Pure functions shared by main (enforcement) and renderer
 * (feedback while dragging). Access is always computed from the current connections, never cached.
 */

export interface Access {
  read: boolean;
  write: boolean;
}

/** Panel → Claude terminal = Claude reads it; Claude terminal → panel = Claude writes it. */
export function accessFor(terminalId: string, panelId: string, connections: Connection[]): Access {
  return {
    read: connections.some((c) => c.source === panelId && c.target === terminalId),
    write: connections.some((c) => c.source === terminalId && c.target === panelId),
  };
}

export function isClaudeTerminal(panel: Panel | undefined): panel is TerminalPanel {
  return panel?.type === 'terminal' && panel.mode === 'claude';
}

/** Panels whose content Claude can read or write through an arrow. */
export function isDataPanel(panel: Panel | undefined): boolean {
  return panel?.type === 'markdown' || panel?.type === 'architecture';
}

/** Whether a panel shows connection ports at all. */
export function isConnectable(panel: Panel | undefined): boolean {
  return isClaudeTerminal(panel) || isDataPanel(panel);
}

export type ConnectionRejection =
  | 'unknown-panel'
  | 'same-panel'
  | 'code-panel'
  | 'shell-terminal'
  | 'multi-agent'
  | 'data-to-data'
  | 'duplicate';

export type ConnectionCheck =
  { ok: true } | { ok: false; reason: ConnectionRejection; message: string };

const REJECTION_MESSAGES: Record<ConnectionRejection, string> = {
  'unknown-panel': 'Panel inesistente',
  'same-panel': 'Un panel non si collega a sé stesso',
  'code-panel': 'Il panel Codice non si collega: segue gli agenti da solo',
  'shell-terminal': 'Solo i terminali Claude si possono collegare',
  'multi-agent': 'Multi-agente: in arrivo',
  'data-to-data': 'Collega un panel a un terminale Claude',
  duplicate: 'Questo collegamento esiste già',
};

function reject(reason: ConnectionRejection): ConnectionCheck {
  return { ok: false, reason, message: REJECTION_MESSAGES[reason] };
}

/** Can an arrow go from `source` to `target`? (spec §6, "Connessioni ammesse") */
export function checkConnection(
  source: Panel | undefined,
  target: Panel | undefined,
  connections: Connection[],
): ConnectionCheck {
  if (!source || !target) return reject('unknown-panel');
  if (source.id === target.id) return reject('same-panel');
  if (source.type === 'code' || target.type === 'code') return reject('code-panel');
  for (const p of [source, target]) {
    if (p.type === 'terminal' && p.mode === 'shell') return reject('shell-terminal');
  }
  if (isClaudeTerminal(source) && isClaudeTerminal(target)) return reject('multi-agent');
  if (!isClaudeTerminal(source) && !isClaudeTerminal(target)) return reject('data-to-data');
  if (connections.some((c) => c.source === source.id && c.target === target.id)) {
    return reject('duplicate');
  }
  return { ok: true };
}

/** A terminal ↔ panel pair with one or two arrows, drawn as a single wire. */
export interface WirePair {
  /** Stable key: `<terminalId>|<panelId>`. */
  key: string;
  terminalId: string;
  panelId: string;
  read: boolean;
  write: boolean;
  connectionIds: string[];
}

export function wireKey(terminalId: string, panelId: string): string {
  return `${terminalId}|${panelId}`;
}

/** Groups connections by terminal ↔ panel pair (read + write = one purple, double-headed wire). */
export function wirePairs(panels: Panel[], connections: Connection[]): WirePair[] {
  const byId = new Map(panels.map((p) => [p.id, p]));
  const pairs = new Map<string, WirePair>();
  for (const c of connections) {
    const source = byId.get(c.source);
    const target = byId.get(c.target);
    const terminal = isClaudeTerminal(source) ? source : isClaudeTerminal(target) ? target : null;
    if (!terminal) continue;
    const panelId = terminal.id === c.source ? c.target : c.source;
    const key = wireKey(terminal.id, panelId);
    const pair = pairs.get(key) ?? {
      key,
      terminalId: terminal.id,
      panelId,
      read: false,
      write: false,
      connectionIds: [],
    };
    if (c.target === terminal.id) pair.read = true;
    else pair.write = true;
    pair.connectionIds.push(c.id);
    pairs.set(key, pair);
  }
  return [...pairs.values()];
}

export interface ConnectedPanel {
  panel: Panel;
  access: Access;
}

/** Data panels linked to a terminal, with their access, in board order. */
export function connectedPanels(
  terminalId: string,
  panels: Panel[],
  connections: Connection[],
): ConnectedPanel[] {
  return panels
    .filter(isDataPanel)
    .map((panel) => ({ panel, access: accessFor(terminalId, panel.id, connections) }))
    .filter(({ access }) => access.read || access.write);
}

export function accessLabel(access: Access): string {
  if (access.read && access.write) return 'lettura e scrittura';
  if (access.read) return 'lettura';
  if (access.write) return 'scrittura';
  return 'nessuno';
}
