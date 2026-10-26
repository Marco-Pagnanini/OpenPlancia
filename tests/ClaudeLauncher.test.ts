import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  claudeArgs,
  hookSettings,
  sessionStartCommand,
  writeRunFiles,
} from '../src/main/claude/ClaudeLauncher';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'plancia-run-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('per-terminal run files', () => {
  it('writes private mcp.json and settings.json plus the shared system prompt', async () => {
    const runRoot = join(dir, 'run');
    const files = await writeRunFiles({
      runRoot,
      terminalId: 'term-1',
      hookUrl: 'http://127.0.0.1:5000/hooks/term-1/tok',
      mcpUrl: 'http://127.0.0.1:5000/mcp/term-1/tok',
      startCommand: 'bridge',
      mcpTools: ['list_panels', 'read_panel'],
    });
    expect(JSON.parse(await readFile(files.mcpConfig, 'utf8'))).toEqual({
      mcpServers: { plancia: { type: 'http', url: 'http://127.0.0.1:5000/mcp/term-1/tok' } },
    });
    const settings = JSON.parse(await readFile(files.settings, 'utf8'));
    expect(settings.permissions.allow).toEqual([
      'mcp__plancia__list_panels',
      'mcp__plancia__read_panel',
    ]);
    expect(settings.hooks.SessionStart[0].hooks[0]).toEqual({
      type: 'command',
      command: 'bridge',
      timeout: 5,
    });
    expect(await readFile(files.systemPrompt, 'utf8')).toContain('mcp__plancia__write_panel');
    expect((await stat(files.settings)).mode & 0o777).toBe(0o600);
    expect((await stat(files.mcpConfig)).mode & 0o777).toBe(0o600);
    expect((await stat(runRoot)).mode & 0o777).toBe(0o700);
  });

  it('uses http hooks for every event but SessionStart, with matchers on tool events', () => {
    const { hooks } = hookSettings('http://h', 'cmd', []) as {
      hooks: Record<string, { matcher?: string; hooks: { type: string }[] }[]>;
    };
    expect(Object.keys(hooks).sort()).toEqual(
      [
        'Notification',
        'PermissionDenied',
        'PostToolUse',
        'PostToolUseFailure',
        'PreToolUse',
        'SessionEnd',
        'SessionStart',
        'Stop',
        'StopFailure',
        'UserPromptSubmit',
      ].sort(),
    );
    expect(hooks['PreToolUse']?.[0]?.matcher).toBe('*');
    expect(hooks['Stop']?.[0]?.matcher).toBeUndefined();
    expect(hooks['Stop']?.[0]?.hooks[0]?.type).toBe('http');
  });

  it('quotes the SessionStart bridge command for the shell', () => {
    expect(sessionStartCommand("/Apps/Pl'ancia", '/r/hook.js', 'http://u')).toBe(
      `ELECTRON_RUN_AS_NODE=1 '/Apps/Pl'\\''ancia' '/r/hook.js' 'http://u'`,
    );
  });

  it('adds the Plancia flags to new and resumed sessions, never --strict-mcp-config', () => {
    const files = { mcpConfig: '/m.json', settings: '/s.json', systemPrompt: '/p.md' };
    const fresh = claudeArgs({ title: 'T' }, { id: 'id', resume: false }, files);
    expect(fresh).toEqual([
      '--session-id',
      'id',
      '--name',
      'T',
      '--mcp-config',
      '/m.json',
      '--settings',
      '/s.json',
      '--append-system-prompt-file',
      '/p.md',
    ]);
    expect(claudeArgs({ title: 'T' }, { id: 'id', resume: true }, files).slice(0, 3)).toEqual([
      '--resume',
      'id',
      '--mcp-config',
    ]);
    expect(fresh).not.toContain('--strict-mcp-config');
  });
});
