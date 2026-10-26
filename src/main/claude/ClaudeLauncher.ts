import { execFile } from 'node:child_process';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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

/** Files generated for one Claude terminal (they contain its token: never in the repo). */
export interface RunFiles {
  mcpConfig: string;
  settings: string;
  systemPrompt: string;
}

/**
 * Arguments for `claude`. A new session gets an app-generated id so hook events can be tied
 * to the panel; resuming reuses it. `--strict-mcp-config` is deliberately absent: the user's
 * own MCP servers stay available.
 */
export function claudeArgs(
  panel: Pick<TerminalPanel, 'title'>,
  session: { id: string; resume: boolean },
  files?: RunFiles,
): string[] {
  const sessionArgs = session.resume
    ? ['--resume', session.id]
    : ['--session-id', session.id, '--name', panel.title];
  if (!files) return sessionArgs;
  return [
    ...sessionArgs,
    '--mcp-config',
    files.mcpConfig,
    '--settings',
    files.settings,
    '--append-system-prompt-file',
    files.systemPrompt,
  ];
}

/** Short system prompt appended to Claude's, written as facts (spec §7.4). */
export const PLANCIA_SYSTEM_PROMPT = `Questa sessione di Claude Code gira dentro Plancia, una lavagna per sviluppatori con panel collegati da frecce.
Una freccia da un panel verso questo terminale dà accesso in lettura a quel panel; una freccia da questo terminale verso un panel dà accesso in scrittura.
I panel collegati (file markdown, schemi di architettura) sono elencati dal tool mcp__plancia__list_panels.
mcp__plancia__read_panel e mcp__plancia__write_panel sono l'unico modo corretto per leggere e modificare architetture e panel markdown collegati: Plancia verifica l'accesso e valida i contenuti.
L'utente vede sulla lavagna quali panel vengono letti e scritti.
`;

function quoteSh(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * SessionStart only accepts command hooks: run the bundled bridge script with Plancia's own
 * binary in Node mode, so no separate Node install is needed.
 */
export function sessionStartCommand(nodeBinary: string, script: string, hookUrl: string): string {
  return `ELECTRON_RUN_AS_NODE=1 ${quoteSh(nodeBinary)} ${quoteSh(script)} ${quoteSh(hookUrl)}`;
}

const HTTP_HOOK_EVENTS = [
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionDenied',
  'Notification',
  'Stop',
  'StopFailure',
  'SessionEnd',
] as const;
const TOOL_EVENTS = new Set<string>([
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionDenied',
]);
const HOOK_TIMEOUT_S = 5;

/** settings.json for one terminal: hooks towards the local server, Plancia tools pre-approved. */
export function hookSettings(hookUrl: string, startCommand: string, mcpTools: string[]) {
  const hooks: Record<string, unknown[]> = {
    SessionStart: [
      { hooks: [{ type: 'command', command: startCommand, timeout: HOOK_TIMEOUT_S }] },
    ],
  };
  for (const event of HTTP_HOOK_EVENTS) {
    hooks[event] = [
      {
        ...(TOOL_EVENTS.has(event) ? { matcher: '*' } : {}),
        hooks: [{ type: 'http', url: hookUrl, timeout: HOOK_TIMEOUT_S }],
      },
    ];
  }
  // The arrow on the board is the user's consent; the server still checks access on every call.
  return { hooks, permissions: { allow: mcpTools.map((t) => `mcp__plancia__${t}`) } };
}

/** mcp.json for one terminal. The token travels in the URL path (header support has varied). */
export function mcpConfig(mcpUrl: string) {
  return { mcpServers: { plancia: { type: 'http', url: mcpUrl } } };
}

async function writePrivate(path: string, content: string): Promise<void> {
  await writeFile(path, content, { encoding: 'utf8', mode: 0o600 });
  await chmod(path, 0o600);
}

/** Writes `<runRoot>/<terminalId>/{mcp,settings}.json` and `<runRoot>/plancia-system.md`. */
export async function writeRunFiles(options: {
  runRoot: string;
  terminalId: string;
  hookUrl: string;
  mcpUrl: string;
  startCommand: string;
  mcpTools: string[];
}): Promise<RunFiles> {
  const dir = join(options.runRoot, options.terminalId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(options.runRoot, 0o700);
  const files: RunFiles = {
    mcpConfig: join(dir, 'mcp.json'),
    settings: join(dir, 'settings.json'),
    systemPrompt: join(options.runRoot, 'plancia-system.md'),
  };
  await writePrivate(files.mcpConfig, `${JSON.stringify(mcpConfig(options.mcpUrl), null, 2)}\n`);
  await writePrivate(
    files.settings,
    `${JSON.stringify(hookSettings(options.hookUrl, options.startCommand, options.mcpTools), null, 2)}\n`,
  );
  await writeFile(files.systemPrompt, PLANCIA_SYSTEM_PROMPT, 'utf8');
  return files;
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
