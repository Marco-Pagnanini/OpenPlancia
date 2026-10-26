import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildPtyEnv,
  defaultShell,
  findExecutable,
  withoutHostSession,
} from '../src/main/env/shellEnv';
import { claudeArgs, claudeLaunch, shellLaunch } from '../src/main/claude/ClaudeLauncher';

describe('buildPtyEnv', () => {
  it('drops Plancia variables and sets terminal info', () => {
    const env = buildPtyEnv(
      {
        PATH: '/usr/bin',
        HOME: '/home/u',
        ELECTRON_RUN_AS_NODE: '1',
        ELECTRON_RENDERER_URL: 'http://localhost:5173',
        VITE_DEV_SERVER_URL: 'x',
        PLANCIA_RESOLVING_ENV: '1',
        CLAUDECODE: '1',
        CLAUDE_CODE_USE_BEDROCK: '1',
        LANG: 'it_IT.UTF-8',
      },
      '0.0.1',
    );
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/u',
      CLAUDE_CODE_USE_BEDROCK: '1',
      LANG: 'it_IT.UTF-8',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'Plancia',
      TERM_PROGRAM_VERSION: '0.0.1',
    });
  });

  it('removes the markers of a host Claude Code session', () => {
    expect(
      withoutHostSession({
        PATH: '/usr/bin',
        CLAUDECODE: '1',
        CLAUDE_CODE_CHILD_SESSION: '1',
        CLAUDE_CODE_SESSION_ID: 'x',
        CLAUDE_AGENT_SDK_VERSION: '1',
        CLAUDE_PID: '42',
        MCP_CONNECTION_NONBLOCKING: '1',
        ANTHROPIC_API_KEY: 'kept',
      }),
    ).toEqual({ PATH: '/usr/bin', ANTHROPIC_API_KEY: 'kept' });
  });

  it('defaults LANG to UTF-8', () => {
    expect(buildPtyEnv({}, '1').LANG).toBe('en_US.UTF-8');
  });
});

describe('findExecutable', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'plancia-bin-'));
    await mkdir(join(dir, 'a'));
    await mkdir(join(dir, 'b'));
    await writeFile(join(dir, 'a', 'claude'), 'not executable');
    await writeFile(join(dir, 'b', 'claude'), '#!/bin/sh\n');
    await chmod(join(dir, 'b', 'claude'), 0o755);
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('returns the first executable match on PATH', async () => {
    const PATH = [join(dir, 'missing'), join(dir, 'a'), join(dir, 'b')].join(':');
    await expect(findExecutable('claude', { PATH }, 'darwin')).resolves.toBe(
      join(dir, 'b', 'claude'),
    );
  });

  it('returns null when absent', async () => {
    await expect(findExecutable('claude', { PATH: join(dir, 'a') }, 'darwin')).resolves.toBeNull();
  });
});

describe('ClaudeLauncher', () => {
  it('starts a new session with an app-chosen id and the panel name', () => {
    expect(claudeArgs({ title: 'claude · backend' }, { id: 'abc', resume: false })).toEqual([
      '--session-id',
      'abc',
      '--name',
      'claude · backend',
    ]);
  });

  it('resumes by session id', () => {
    expect(claudeArgs({ title: 'x' }, { id: 'abc', resume: true })).toEqual(['--resume', 'abc']);
  });

  it('wraps .cmd shims on Windows only', () => {
    expect(claudeLaunch('C:\\bin\\claude.cmd', ['--version'], 'win32')).toEqual({
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', 'C:\\bin\\claude.cmd', '--version'],
    });
    expect(claudeLaunch('/usr/local/bin/claude', ['-r'], 'darwin')).toEqual({
      file: '/usr/local/bin/claude',
      args: ['-r'],
    });
  });

  it('uses the login shell', () => {
    expect(shellLaunch({ SHELL: '/bin/fish' }, 'linux')).toEqual({
      file: '/bin/fish',
      args: ['-l'],
    });
    expect(defaultShell({}, 'darwin')).toBe('/bin/zsh');
    expect(shellLaunch({ COMSPEC: 'C:\\cmd.exe' }, 'win32')).toEqual({
      file: 'C:\\cmd.exe',
      args: [],
    });
  });
});
