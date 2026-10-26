import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalPanel } from '@shared/types';
import { PtyService } from '../src/main/pty/PtyService';
import { TerminalService } from '../src/main/terminal/TerminalService';
import { WorkspaceService } from '../src/main/workspace/WorkspaceService';
import { fakeSpawner } from './fakePty';

let dir: string;
let project: string;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'plancia-term-')));
  project = join(dir, 'progetto');
  await mkdir(project);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

async function setup({
  claude = '/opt/bin/claude' as string | null,
  saved = true,
}: { claude?: string | null; saved?: boolean } = {}) {
  const workspace = new WorkspaceService({
    settingsFile: join(dir, 'settings.json'),
    onState: () => undefined,
    saveDelayMs: 5,
  });
  const { spawn, spawned } = fakeSpawner();
  const errors: [string, string][] = [];
  const pty: PtyService = new PtyService({
    spawn,
    onData: () => undefined,
    onExit: (id) => terminals.handleExit(id),
  });
  let n = 0;
  const terminals: TerminalService = new TerminalService({
    workspace,
    pty,
    env: () => Promise.resolve({ PATH: '/opt/bin', SHELL: '/bin/zsh' }),
    findClaude: () => Promise.resolve(claude),
    onError: (id, code) => errors.push([id, code]),
    newSessionId: () => `00000000-0000-4000-8000-00000000000${++n}`,
    sessionExists: () => Promise.resolve(saved),
  });
  await workspace.open(project);
  const terminal = (i = 0) =>
    workspace.snapshot()!.board.panels.filter((p) => p.type === 'terminal')[i] as TerminalPanel;
  const settle = () => vi.waitFor(() => undefined);
  return { workspace, terminals, pty, spawned, errors, terminal, settle };
}

const create = (mode: 'shell' | 'claude') =>
  ({ type: 'createPanel', panelType: 'terminal', position: { x: 0, y: 0 }, mode }) as const;

describe('TerminalService', () => {
  it('auto-starts a new shell terminal in the workspace with the login shell', async () => {
    const t = await setup();
    t.workspace.dispatch(create('shell'));
    await vi.waitFor(() => expect(t.spawned).toHaveLength(1));
    expect(t.spawned[0]!.options).toMatchObject({ file: '/bin/zsh', args: ['-l'], cwd: project });
    expect(t.terminal().status).toBe('idle');
    await t.workspace.close({ notify: false });
  });

  it('starts claude with a persisted session id and its title', async () => {
    const t = await setup();
    t.workspace.dispatch(create('claude'));
    await vi.waitFor(() => expect(t.spawned).toHaveLength(1));
    const sessionId = '00000000-0000-4000-8000-000000000001';
    expect(t.spawned[0]!.options).toMatchObject({
      file: '/opt/bin/claude',
      args: ['--session-id', sessionId, '--name', 'Claude'],
    });
    expect(t.terminal().claudeSessionId).toBe(sessionId);
    await t.workspace.close({ notify: false });
  });

  it('reports a clear error when claude is missing', async () => {
    const t = await setup({ claude: null });
    t.workspace.dispatch(create('claude'));
    await vi.waitFor(() => expect(t.errors).toEqual([[t.terminal().id, 'claude-not-found']]));
    expect(t.spawned).toHaveLength(0);
    expect(t.terminal().status).toBe('not-started');
    await t.workspace.close({ notify: false });
  });

  it('marks exited terminals and resumes the same session on request', async () => {
    const t = await setup();
    t.workspace.dispatch(create('claude'));
    await vi.waitFor(() => expect(t.spawned).toHaveLength(1));
    const { id, claudeSessionId } = t.terminal();
    t.spawned[0]!.exit(0);
    expect(t.terminal().status).toBe('exited');

    await expect(t.terminals.start(id, { resume: true, cols: 90, rows: 20 })).resolves.toEqual({
      ok: true,
    });
    expect(t.spawned[1]!.options).toMatchObject({ args: ['--resume', claudeSessionId], cols: 90 });
    expect(t.terminal().status).toBe('idle');
    await t.workspace.close({ notify: false });
  });

  it('starts the same session afresh when Claude saved no conversation for it', async () => {
    const t = await setup({ saved: false });
    t.workspace.dispatch(create('claude'));
    await vi.waitFor(() => expect(t.spawned).toHaveLength(1));
    const { id, claudeSessionId } = t.terminal();
    t.spawned[0]!.exit(0);
    await t.terminals.start(id, { resume: true, cols: 90, rows: 20 });
    const args = t.spawned[1]!.options.args;
    expect(args).toContain('--session-id');
    expect(args).toContain(claudeSessionId);
    expect(args).not.toContain('--resume');
    expect(t.terminal().claudeSessionId).toBe(claudeSessionId);
    await t.workspace.close({ notify: false });
  });

  it('cannot resume a terminal that never had a session', async () => {
    const t = await setup({ claude: null });
    t.workspace.dispatch(create('claude'));
    await vi.waitFor(() => expect(t.errors).toHaveLength(1));
    const result = await t.terminals.start(t.terminal().id, { resume: true, cols: 80, rows: 24 });
    expect(result).toMatchObject({ ok: false, code: 'claude-not-found' });
    await t.workspace.close({ notify: false });
  });

  it('kills the process when the panel is deleted', async () => {
    const t = await setup();
    t.workspace.dispatch(create('shell'));
    await vi.waitFor(() => expect(t.spawned).toHaveLength(1));
    t.workspace.dispatch({ type: 'deletePanels', ids: [t.terminal().id] });
    await vi.waitFor(() => expect(t.spawned[0]!.kills).toEqual([undefined]));
    expect(t.pty.runningIds()).toEqual([]);
    await t.workspace.close({ notify: false });
  });

  it('converting a shell to claude replaces the process', async () => {
    const t = await setup();
    t.workspace.dispatch(create('shell'));
    await vi.waitFor(() => expect(t.spawned).toHaveLength(1));
    t.workspace.dispatch({ type: 'setTerminalMode', id: t.terminal().id, mode: 'claude' });
    await vi.waitFor(() => expect(t.spawned).toHaveLength(2));
    expect(t.spawned[0]!.kills).toEqual([undefined]);
    expect(t.spawned[1]!.options.file).toBe('/opt/bin/claude');
    expect(t.terminal()).toMatchObject({ mode: 'claude', status: 'idle' });
    await t.workspace.close({ notify: false });
  });

  it('stops every process when the workspace closes, without persisting runtime status', async () => {
    const t = await setup();
    t.workspace.dispatch(create('shell'));
    t.workspace.dispatch(create('shell'));
    await vi.waitFor(() => expect(t.spawned).toHaveLength(2));
    await t.workspace.close({ notify: false });
    expect(t.spawned.every((p) => p.kills.length === 1)).toBe(true);

    const reopened = await t.workspace.open(project);
    expect(reopened.board.panels.map((p) => p.type === 'terminal' && p.status)).toEqual([
      'not-started',
      'not-started',
    ]);
    await t.workspace.close({ notify: false });
  });

  it('rejects a cwd that escapes the workspace', async () => {
    await mkdir(join(project, '.plancia'));
    await writeFile(
      join(project, '.plancia', 'board.json'),
      JSON.stringify({
        schemaVersion: 1,
        connections: [],
        panels: [
          {
            id: 'term-0001',
            type: 'terminal',
            mode: 'shell',
            cwd: '../..',
            title: 'Fuori',
            position: { x: 0, y: 0 },
            size: { width: 600, height: 400 },
            version: 1,
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    );
    const t = await setup();
    const result = await t.terminals.start('term-0001', { resume: false, cols: 80, rows: 24 });
    expect(result).toMatchObject({ ok: false, code: 'spawn-failed' });
    expect(result.ok === false && result.message).toMatch(/fuori dalla cartella/);
    expect(t.spawned).toHaveLength(0);
    await t.workspace.close({ notify: false });
  });
});
