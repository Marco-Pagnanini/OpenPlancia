import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '@shared/ipc';
import type { Connection, Panel, TerminalPanel } from '@shared/types';
import { AgentService, agentName, sendTarget } from '../src/main/agents/AgentService';
import { describeAgentChanges, ManifestTracker, renderManifest } from '../src/main/claude/manifest';
import { handleHook, type HookDeps } from '../src/main/server/hooks';
import { toolLabel } from '../src/main/server/toolLabel';

const base = {
  position: { x: 0, y: 0 },
  size: { width: 1, height: 1 },
  version: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const claude = (id: string, title: string, extra: Partial<TerminalPanel> = {}): TerminalPanel => ({
  ...base,
  id,
  title,
  type: 'terminal',
  mode: 'claude',
  cwd: '.',
  status: 'idle',
  ...extra,
});
const conn = (source: string, target: string): Connection => ({
  id: `${source}>${target}`,
  source,
  target,
  createdAt: base.updatedAt,
});

function setup(connections: Connection[]) {
  const panels: Panel[] = [
    claude('t1', 'backend'),
    claude('t2', 'frontend', {
      claudeName: 'Claude 2',
      claudeSessionId: '11111111-2222-4333-8444-555555555555',
    }),
    claude('t3', 'tester'),
  ];
  const messages: AgentMessage[] = [];
  const agents = new AgentService({
    panels: () => panels,
    connections: () => connections,
    onMessage: (m) => messages.push(m),
    now: () => new Date('2026-10-26T18:00:00.000Z'),
  });
  return { agents, messages };
}

describe('AgentService.checkSend', () => {
  it('needs an arrow from the sender to the board agent it writes to', () => {
    const { agents } = setup([conn('t2', 't1')]);
    expect(agents.checkSend('t1', { to: 'Claude 2', message: 'ciao' })).toBe(
      "Messaggio negato: l'agente 'Claude 2' non è collegato a questo terminale. L'utente deve aggiungere una freccia da questo terminale a 'frontend' sulla lavagna di OpenPlancia.",
    );
    // The arrow t2 → t1 lets t2 write to t1, not the other way round.
    expect(agents.checkSend('t2', { to: 'backend', message: 'ciao' })).toBeNull();
  });

  it('finds agents by the name their session was created with, @-mention, quotes or ids', () => {
    const { agents } = setup([conn('t1', 't2')]);
    for (const to of [
      'Claude 2',
      '@claude 2',
      '"Claude 2"',
      '@Claude-2',
      'claude_2',
      't2',
      '11111111-2222-4333-8444-555555555555',
    ]) {
      expect(agents.checkSend('t1', { to }), to).toBeNull();
    }
    // The panel was renamed after the session started: its title no longer addresses it.
    expect(agents.checkSend('t1', { to: 'frontend' })).toContain('non è un agente collegato');
  });

  it('refuses sessions outside the board, naming who can be reached', () => {
    const { agents } = setup([conn('t1', 't2')]);
    expect(agents.checkSend('t1', { recipient: 'other-session' })).toBe(
      'Messaggio negato: \'other-session\' non è un agente collegato sulla lavagna di OpenPlancia. Puoi scrivere a: "Claude 2", oltre ai tuoi subagent.',
    );
    expect(setup([]).agents.checkSend('t3', { to: 'x' })).toContain(
      'puoi scrivere solo ai tuoi subagent',
    );
  });

  it("recognizes a reply addressed to the sender's inbox socket", () => {
    const { agents } = setup([conn('t1', 't2')]);
    agents.setAddress('t1', '/tmp/cc-socks/79278.sock');
    // t2 answers t1 through the reply address: without the arrow t2 → t1 it is refused as t1.
    expect(agents.checkSend('t2', { to: 'uds:/tmp/cc-socks/79278.sock' })).toContain(
      "l'agente 'backend' non è collegato",
    );
    const linked = setup([conn('t1', 't2'), conn('t2', 't1')]).agents;
    linked.setAddress('t1', '/tmp/cc-socks/79278.sock');
    expect(linked.checkSend('t2', { to: 'uds:/tmp/cc-socks/79278.sock' })).toBeNull();
  });

  it('lets a terminal message the subagents its own Claude started', () => {
    const { agents } = setup([]);
    expect(agents.checkSend('t1', { to: 'helper' })).not.toBeNull();
    agents.toolDone(
      't1',
      'Agent',
      { name: 'helper', subagent_type: 'Explore' },
      { agentId: 'a828' },
    );
    expect(agents.checkSend('t1', { to: 'helper' })).toBeNull();
    expect(agents.checkSend('t1', { to: 'a828' })).toBeNull();
    // Another terminal cannot borrow them.
    expect(agents.checkSend('t3', { to: 'helper' })).not.toBeNull();
  });
});

describe('messages between agents', () => {
  it('records what was sent to board agents, per pair, and tells the app', () => {
    const { agents, messages } = setup([conn('t1', 't2'), conn('t2', 't1')]);
    agents.toolDone(
      't1',
      'SendMessage',
      { to: 'Claude 2', summary: 'Schema pronto', message: 'La colonna è tenant_id.' },
      {},
    );
    agents.toolDone('t2', 'SendMessage', { recipient: 'backend', content: 'Ricevuto' }, {});
    agents.toolDone('t1', 'SendMessage', { to: 'helper', message: 'a un subagent' }, {});
    expect(messages).toHaveLength(2);
    expect(agents.between('t2', 't1')).toEqual([
      {
        from: 't1',
        to: 't2',
        at: '2026-10-26T18:00:00.000Z',
        summary: 'Schema pronto',
        text: 'La colonna è tenant_id.',
        chars: 23,
      },
      {
        from: 't2',
        to: 't1',
        at: '2026-10-26T18:00:00.000Z',
        summary: undefined,
        text: 'Ricevuto',
        chars: 8,
      },
    ]);
    agents.forget('t2');
    expect(agents.between('t1', 't2')).toEqual([]);
  });

  it('reads the recipient from to or recipient, and names agents by their session', () => {
    expect(sendTarget({ to: 'a', recipient: 'b' })).toBe('a');
    expect(sendTarget({ recipient: 'b' })).toBe('b');
    expect(sendTarget({ to: '  ' })).toBeUndefined();
    expect(agentName(claude('t9', 'Nuovo titolo', { claudeName: 'Vecchio' }))).toBe('Vecchio');
    expect(agentName(claude('t9', 'Nuovo titolo'))).toBe('Nuovo titolo');
  });

  it('shows SendMessage in the activity timeline with recipient and summary', () => {
    expect(toolLabel('SendMessage', { to: 'Claude 2', summary: 'Schema pronto' }, null)).toBe(
      'SendMessage → Claude 2: Schema pronto',
    );
  });
});

describe('what each agent is told (manifest)', () => {
  it('lists whom it may write to and who may write to it', () => {
    const text = renderManifest([], [], { to: ['Claude 2'], from: ['tester'] });
    expect(text).toContain('puoi scrivere con SendMessage a: "Claude 2"');
    expect(text).toContain('possono scriverti: "tester"');
    expect(renderManifest([], [], { to: [], from: [] })).toBe('');
  });

  it('injects again when the arrows between agents change', () => {
    const tracker = new ManifestTracker();
    expect(tracker.sessionStart('t1', [], { to: [], from: [] })).toBeNull();
    expect(tracker.update('t1', [], { to: [], from: [] })).toBeNull();
    const text = tracker.update('t1', [], { to: ['Claude 2'], from: [] });
    expect(text).toContain('Modificato dall\'ultimo messaggio: ora puoi scrivere a "Claude 2"');
    expect(tracker.update('t1', [], { to: ['Claude 2'], from: [] })).toBeNull();
    expect(describeAgentChanges({ to: ['a'], from: ['b'] }, { to: [], from: [] })).toEqual([
      'non puoi più scrivere a "a"',
      '"b" non può più scriverti',
    ]);
  });
});

describe('hooks', () => {
  function hookDeps(denial: string | null) {
    const done: string[] = [];
    const activity: string[] = [];
    const deps: HookDeps = {
      terminal: () => claude('t1', 'backend'),
      root: () => '/repo',
      setRuntime: () => undefined,
      setSessionId: () => undefined,
      appendActivity: (_id, a) => activity.push(a.title),
      updateTool: () => undefined,
      needsAttention: () => undefined,
      settleTools: () => undefined,
      manifest: async () => null,
      checkTool: async (_id, tool) => (tool === 'SendMessage' ? denial : null),
      toolDone: (_id, tool) => done.push(tool),
    };
    return { deps, done, activity };
  }

  it('denies a message without an arrow and says so in the timeline', async () => {
    const t = hookDeps('Messaggio negato: …');
    const response = await handleHook(
      't1',
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'SendMessage',
        tool_input: { to: 'x', message: 'm' },
      },
      t.deps,
    );
    expect(response).toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: 'Messaggio negato: …',
      },
    });
    expect(t.activity).toContain('Messaggio negato dalle frecce');
  });

  it('reports tools that ended well, not the failed ones', async () => {
    const t = hookDeps(null);
    await handleHook(
      't1',
      { hook_event_name: 'PostToolUse', tool_name: 'SendMessage', tool_input: {} },
      t.deps,
    );
    await handleHook(
      't1',
      { hook_event_name: 'PostToolUseFailure', tool_name: 'Agent', tool_input: {} },
      t.deps,
    );
    expect(t.done).toEqual(['SendMessage']);
  });
});
