import { agentLinks, agentPairKey, isClaudeTerminal } from '@shared/access';
import type { AgentMessage } from '@shared/ipc';
import type { Connection, Panel, TerminalPanel } from '@shared/types';

/** Messages kept per pair of agents, and characters kept per message. */
export const AGENT_LIMITS = { history: 50, text: 4000 } as const;

export interface AgentServiceOptions {
  panels(): Panel[];
  connections(): Connection[];
  onMessage: (message: AgentMessage) => void;
  now?: () => Date;
}

/** How other agents address a terminal: the name its Claude session was created with. */
export function agentName(panel: TerminalPanel): string {
  return panel.claudeName ?? panel.title;
}

/** "Claude 2", "@Claude-2" and "claude_2" are the same agent: Claude Code shows names with hyphens. */
function normalize(name: string): string {
  return name
    .trim()
    .replace(/^@/, '')
    .replace(/^"(.*)"$/, '$1')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-');
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** Recipient of a SendMessage call (`to`, or `recipient` in newer versions). */
export function sendTarget(input: Record<string, unknown> | undefined): string | undefined {
  return str(input?.['to']) ?? str(input?.['recipient']);
}

/**
 * Messages between agents (M8). Claude Code already lets sessions message each other
 * (SendMessage); the arrows decide which ones may. A terminal may message its own subagents
 * freely, the agents on the board it has an arrow to, and nobody else.
 */
export class AgentService {
  /** Terminal → names and ids of the subagents its Claude started (normalized). */
  private readonly subagents = new Map<string, Set<string>>();
  private readonly history = new Map<string, AgentMessage[]>();
  /** Terminal → its session's inbox socket: replies are addressed `uds:<socket>`. */
  private readonly addresses = new Map<string, string>();
  private readonly now: () => Date;

  constructor(private readonly options: AgentServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  /** From SessionStart (plancia-hook.cjs): where this terminal's session receives messages. */
  setAddress(terminalId: string, socket: string): void {
    this.addresses.set(terminalId, socket);
  }

  /** The Claude terminal on the board a name, a panel id, a session id or an inbox points to. */
  private resolve(terminalId: string, target: string): TerminalPanel | undefined {
    const socket = target.replace(/^uds:/, '');
    const owner = [...this.addresses].find(([, address]) => address === socket)?.[0];
    const wanted = normalize(target);
    return this.options
      .panels()
      .filter(isClaudeTerminal)
      .find(
        (p) =>
          p.id !== terminalId &&
          (p.id === owner ||
            normalize(agentName(p)) === wanted ||
            p.id === target ||
            p.claudeSessionId === target),
      );
  }

  private ownSubagent(terminalId: string, target: string): boolean {
    return this.subagents.get(terminalId)?.has(normalize(target)) ?? false;
  }

  /** PreToolUse of SendMessage: null to let it through, or why it is denied. */
  checkSend(terminalId: string, input: Record<string, unknown> | undefined): string | null {
    const target = sendTarget(input);
    // Nothing to check: Claude Code itself rejects a message without a recipient.
    if (!target || this.ownSubagent(terminalId, target)) return null;
    const { to } = agentLinks(terminalId, this.options.panels(), this.options.connections());
    const agent = this.resolve(terminalId, target);
    if (agent) {
      if (to.some((p) => p.id === agent.id)) return null;
      return `Messaggio negato: l'agente '${agentName(agent)}' non è collegato a questo terminale. L'utente deve aggiungere una freccia da questo terminale a '${agent.title}' sulla lavagna di OpenPlancia.`;
    }
    const reachable =
      to.length > 0
        ? `Puoi scrivere a: ${to.map((p) => `"${agentName(p)}"`).join(', ')}, oltre ai tuoi subagent.`
        : 'Nessun agente è collegato a questo terminale: puoi scrivere solo ai tuoi subagent.';
    return `Messaggio negato: '${target}' non è un agente collegato sulla lavagna di OpenPlancia. ${reachable}`;
  }

  /** PostToolUse: remember the subagents Claude starts; log messages sent to board agents. */
  toolDone(
    terminalId: string,
    toolName: string,
    input: Record<string, unknown> | undefined,
    response: unknown,
  ): void {
    if (toolName === 'Agent' || toolName === 'Task') {
      const id =
        typeof response === 'object' && response !== null && 'agentId' in response
          ? str(response.agentId)
          : undefined;
      const known = this.subagents.get(terminalId) ?? new Set<string>();
      for (const name of [str(input?.['name']), id]) if (name) known.add(normalize(name));
      this.subagents.set(terminalId, known);
      return;
    }
    if (toolName !== 'SendMessage') return;
    const target = sendTarget(input);
    const agent = target ? this.resolve(terminalId, target) : undefined;
    if (!agent) return;
    const text = str(input?.['message']) ?? str(input?.['content']) ?? '';
    const message: AgentMessage = {
      from: terminalId,
      to: agent.id,
      at: this.now().toISOString(),
      summary: str(input?.['summary']),
      text: text.slice(0, AGENT_LIMITS.text),
      chars: text.length,
    };
    const key = agentPairKey(terminalId, agent.id);
    const list = [...(this.history.get(key) ?? []), message].slice(-AGENT_LIMITS.history);
    this.history.set(key, list);
    this.options.onMessage(message);
  }

  /** Messages between two terminals, oldest first. */
  between(a: string, b: string): AgentMessage[] {
    return this.history.get(agentPairKey(a, b)) ?? [];
  }

  /** The panel is gone: forget its subagents and its conversations. */
  forget(terminalId: string): void {
    this.subagents.delete(terminalId);
    this.addresses.delete(terminalId);
    for (const key of [...this.history.keys()]) {
      if (key.split(/[:|]/).includes(terminalId)) this.history.delete(key);
    }
  }

  reset(): void {
    this.subagents.clear();
    this.addresses.clear();
    this.history.clear();
  }
}
