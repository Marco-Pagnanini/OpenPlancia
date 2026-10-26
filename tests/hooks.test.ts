import { describe, expect, it } from 'vitest';
import type { TerminalPanel, TerminalRuntime } from '@shared/types';
import { handleHook, type HookDeps, type NewActivity } from '../src/main/server/hooks';
import { toolLabel } from '../src/main/server/toolLabel';

const ROOT = '/repo';

function setup(overrides: Partial<TerminalPanel> = {}) {
  let terminal: TerminalPanel = {
    id: 'term-1',
    type: 'terminal',
    mode: 'claude',
    cwd: '.',
    claudeSessionId: 'sess-1',
    status: 'idle',
    title: 'claude · backend',
    position: { x: 0, y: 0 },
    size: { width: 600, height: 400 },
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
  const activity: NewActivity[] = [];
  const toolUpdates: [string, unknown][] = [];
  const attention: string[] = [];
  const sessions: string[] = [];
  let settled = 0;
  const manifests: Record<'start' | 'prompt', string | null> = { start: null, prompt: null };
  const deny =
    "Accesso negato: il panel 'AGENTS.md' è collegato a questo terminale in sola lettura.";
  const deps: HookDeps = {
    terminal: (id) => (id === terminal.id ? terminal : undefined),
    root: () => ROOT,
    setRuntime: (_id, patch: Partial<TerminalRuntime>) => {
      terminal = { ...terminal, ...patch };
    },
    setSessionId: (_id, sid) => sessions.push(sid),
    appendActivity: (_id, a) => activity.push(a),
    updateTool: (_id, useId, patch) => toolUpdates.push([useId, patch]),
    needsAttention: (_id, message) => attention.push(message),
    settleTools: () => {
      settled++;
    },
    manifest: async (_id, moment) => manifests[moment],
    checkFileWrite: async (_id, tool, input) =>
      tool === 'Edit' && input?.['file_path'] === '/repo/AGENTS.md' ? deny : null,
  };
  const fire = (body: Record<string, unknown>) =>
    handleHook('term-1', { session_id: 'sess-1', cwd: ROOT, ...body }, deps);
  return {
    fire,
    manifests,
    activity,
    toolUpdates,
    attention,
    sessions,
    get: () => terminal,
    settled: () => settled,
  };
}

describe('handleHook', () => {
  it('follows a full turn: prompt → tool → done → stop', async () => {
    const t = setup();
    expect(
      await t.fire({ hook_event_name: 'UserPromptSubmit', prompt: 'esegui i test' }),
    ).toBeNull();
    expect(t.get().status).toBe('working');

    await t.fire({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm test\necho done' },
      tool_use_id: 'toolu_1',
    });
    expect(t.get()).toMatchObject({ status: 'working', currentTool: 'Bash: npm test' });

    await t.fire({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'toolu_1' });
    expect(t.get().currentTool).toBeUndefined();
    expect(t.toolUpdates).toEqual([['toolu_1', { state: 'ok' }]]);

    await t.fire({ hook_event_name: 'Stop', last_assistant_message: 'Tutti i test passano.' });
    expect(t.get().status).toBe('idle');
    expect(t.activity.map((a) => a.title)).toEqual([
      'Prompt inviato',
      'Bash: npm test',
      'Risposta completata',
    ]);
    expect(t.activity[2]?.detail).toBe('Tutti i test passano.');
  });

  it('settles leftover running tools when the turn ends', async () => {
    const t = setup();
    await t.fire({ hook_event_name: 'Stop' });
    await t.fire({ hook_event_name: 'StopFailure', error: 'rate_limit' });
    await t.fire({ hook_event_name: 'SessionEnd', reason: 'clear' });
    expect(t.settled()).toBe(2);
  });

  it('marks a tool denied by auto mode as failed', async () => {
    const t = setup();
    await t.fire({
      hook_event_name: 'PermissionDenied',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf build' },
      tool_use_id: 'toolu_9',
      reason: 'Auto mode classifier',
    });
    expect(t.toolUpdates).toEqual([['toolu_9', { state: 'failed' }]]);
    expect(t.activity[0]?.title).toBe('Permesso negato: Bash: rm -rf build');
  });

  it('records file tools with a workspace-relative path', async () => {
    const t = setup();
    await t.fire({
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/repo/src/auth.ts' },
      tool_use_id: 'toolu_2',
    });
    expect(t.activity[0]).toMatchObject({
      kind: 'tool',
      title: 'Edit: src/auth.ts',
      tool: { name: 'Edit', useId: 'toolu_2', state: 'running', filePath: 'src/auth.ts' },
    });
  });

  it('marks failed tools and logs the error', async () => {
    const t = setup();
    await t.fire({
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Bash',
      tool_use_id: 'toolu_3',
      error: 'Exit code 1',
    });
    expect(t.toolUpdates).toEqual([['toolu_3', { state: 'failed' }]]);
    expect(t.activity[0]).toMatchObject({ kind: 'error', detail: 'Exit code 1' });
  });

  it('switches to needs-input on permission prompts and notifies', async () => {
    const t = setup({ status: 'working' });
    await t.fire({
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt',
      message: 'Claude needs your permission to use Bash',
    });
    expect(t.get().status).toBe('needs-input');
    expect(t.activity[0]?.title).toBe('In attesa di permesso');
    expect(t.attention).toEqual(['Claude needs your permission to use Bash']);
  });

  it('ignores informational notifications such as idle_prompt', async () => {
    const t = setup();
    await t.fire({
      hook_event_name: 'Notification',
      notification_type: 'idle_prompt',
      message: 'x',
    });
    expect(t.get().status).toBe('idle');
    expect(t.attention).toEqual([]);
  });

  it('tracks a new session id after /clear', async () => {
    const t = setup();
    await t.fire({ hook_event_name: 'SessionStart', source: 'clear', session_id: 'sess-2' });
    expect(t.sessions).toEqual(['sess-2']);
    expect(t.activity[0]?.title).toBe('Sessione azzerata');
  });

  it('marks the terminal exited only when the session really ends', async () => {
    const t = setup();
    await t.fire({ hook_event_name: 'SessionEnd', reason: 'clear' });
    expect(t.get().status).toBe('idle');
    await t.fire({ hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' });
    expect(t.get().status).toBe('exited');
  });

  it('ignores invalid bodies and shell terminals', async () => {
    const t = setup();
    expect(await t.fire({ prompt: 'no event name' })).toBeNull();
    expect(t.get().status).toBe('idle');
    const shell = setup({ mode: 'shell' });
    await shell.fire({ hook_event_name: 'UserPromptSubmit', prompt: 'x' });
    expect(shell.get().status).toBe('idle');
  });
});

describe('handleHook — arrows (M5)', () => {
  it('injects the manifest at session start and on prompts when there is one', async () => {
    const t = setup();
    t.manifests.start = 'Plancia — panel collegati a questa sessione: …';
    expect(await t.fire({ hook_event_name: 'SessionStart', source: 'startup' })).toEqual({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: 'Plancia — panel collegati a questa sessione: …',
      },
    });
    expect(await t.fire({ hook_event_name: 'UserPromptSubmit', prompt: 'ciao' })).toBeNull();
    t.manifests.prompt = "Modificato dall'ultimo messaggio: …";
    expect(await t.fire({ hook_event_name: 'UserPromptSubmit', prompt: 'ciao' })).toEqual({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: "Modificato dall'ultimo messaggio: …",
      },
    });
  });

  it('denies file writes the arrows do not allow, with the reason', async () => {
    const t = setup();
    const res = await t.fire({
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/repo/AGENTS.md' },
      tool_use_id: 'toolu_x',
    });
    expect(res).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining('sola lettura'),
      },
    });
    expect(t.activity.map((a) => [a.title, a.tool?.state])).toEqual([
      ['Edit: AGENTS.md', 'failed'],
      ['Scrittura negata dalle frecce', undefined],
    ]);
    expect(t.get().currentTool).toBeUndefined();
  });
});

describe('toolLabel', () => {
  it('formats common tools', async () => {
    expect(toolLabel('Grep', { pattern: 'TODO' }, ROOT)).toBe('Grep: TODO');
    expect(toolLabel('Read', { file_path: '/elsewhere/x.md' }, ROOT)).toBe('Read: /elsewhere/x.md');
    expect(toolLabel('NotebookEdit', { notebook_path: '/repo/a.ipynb' }, ROOT)).toBe(
      'NotebookEdit: a.ipynb',
    );
    expect(toolLabel('mcp__plancia__list_panels', {}, ROOT)).toBe('plancia › list_panels');
    expect(toolLabel('TodoWrite', { todos: [] }, ROOT)).toBe('TodoWrite');
    expect(toolLabel('Bash', { command: 'x'.repeat(200) }, ROOT)).toHaveLength(96);
  });
});
