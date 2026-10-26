import { execFile } from 'node:child_process';
import type { TerminalPanel } from '@shared/types';
import { defaultShell, findExecutable, type Env } from '../env/shellEnv';

export const CLAUDE_INSTALL_URL = 'https://code.claude.com/docs/en/setup';

export interface LaunchSpec {
  file: string;
  args: string[];
}

/** Interactive login shell. */
export function shellLaunch(env: Env, platform: NodeJS.Platform = process.platform): LaunchSpec {
  const file = defaultShell(env, platform);
  return { file, args: platform === 'win32' ? [] : ['-l'] };
}

/**
 * Arguments for `claude`. A new session gets an app-generated id so hook events can be tied
 * to the panel (M3); resuming reuses it. Plancia's MCP/settings flags arrive in M3.
 */
export function claudeArgs(
  panel: Pick<TerminalPanel, 'title'>,
  session: { id: string; resume: boolean },
): string[] {
  return session.resume
    ? ['--resume', session.id]
    : ['--session-id', session.id, '--name', panel.title];
}

export function claudeLaunch(
  claudePath: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): LaunchSpec {
  // .cmd shims cannot be spawned directly on Windows.
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(claudePath)) {
    return { file: 'cmd.exe', args: ['/d', '/s', '/c', claudePath, ...args] };
  }
  return { file: claudePath, args };
}

export function findClaude(env: Env): Promise<string | null> {
  return findExecutable('claude', env);
}

/** `claude --version`, or null if it cannot be run. */
export function claudeVersion(claudePath: string, env: Env): Promise<string | null> {
  return new Promise((resolve) => {
    const { file, args } = claudeLaunch(claudePath, ['--version']);
    execFile(file, args, { env, timeout: 10_000 }, (err, stdout) => {
      resolve(err ? null : stdout.trim() || null);
    });
  });
}
