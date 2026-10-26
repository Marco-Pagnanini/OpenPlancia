import { execFile } from 'node:child_process';
import { access, constants, stat } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

export type Env = Record<string, string>;

const RESOLVE_TIMEOUT_MS = 10_000;

/** Variables that belong to OpenPlancia itself, never to user terminals. */
const STRIPPED_PREFIXES = ['ELECTRON_', 'VITE_', 'PLANCIA_'];
const STRIPPED_KEYS = ['CLAUDECODE', 'NODE_OPTIONS'];

/**
 * Markers of a Claude Code session that launched OpenPlancia (e.g. `npm run dev` from Claude Code).
 * Inherited by a terminal they make `claude` behave as a child session (no transcript, so no
 * --resume). They are removed before asking the login shell, so anything the user's dotfiles
 * set on purpose comes back.
 */
const HOST_SESSION_PREFIXES = ['CLAUDE_CODE_', 'CLAUDE_AGENT_SDK_', 'CLAUDE_PREVIEW_'];
const HOST_SESSION_KEYS = [
  'CLAUDECODE',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
  'MCP_CONNECTION_NONBLOCKING',
  'MCP_SERVER_CONNECTION_BATCH_SIZE',
];

export function withoutHostSession(env: Env): Env {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([k]) =>
        !HOST_SESSION_KEYS.includes(k) && !HOST_SESSION_PREFIXES.some((p) => k.startsWith(p)),
    ),
  );
}

function toEnv(source: NodeJS.ProcessEnv): Env {
  const env: Env = {};
  for (const [k, v] of Object.entries(source)) if (typeof v === 'string') env[k] = v;
  return env;
}

export function defaultShell(env: Env, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return env['COMSPEC'] ?? 'powershell.exe';
  return env['SHELL'] || (platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
}

/**
 * Apps launched from Finder or a desktop menu do not inherit the user's shell PATH.
 * Ask the login + interactive shell for its environment once, printed as JSON by this
 * same binary running as Node (the approach VS Code uses).
 */
export function readLoginShellEnv(): Promise<Env> {
  const base = withoutHostSession(toEnv(process.env));
  if (process.platform === 'win32') return Promise.resolve(base);

  const shell = defaultShell(base);
  const mark = `__PLANCIA_ENV_${Math.random().toString(36).slice(2)}__`;
  const node = `'${process.execPath.replace(/'/g, `'\\''`)}'`;
  const command = `${node} -e 'process.stdout.write("${mark}" + JSON.stringify(process.env) + "${mark}")'`;

  return new Promise((resolvePromise) => {
    execFile(
      shell,
      ['-i', '-l', '-c', command],
      {
        env: { ...base, ELECTRON_RUN_AS_NODE: '1', PLANCIA_RESOLVING_ENV: '1' },
        timeout: RESOLVE_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
      },
      (err, stdout) => {
        const match = stdout.split(mark);
        const json = match.length >= 3 ? match[1] : undefined;
        if (json === undefined) {
          console.warn('[env] impossibile leggere l’ambiente della shell di login', err ?? '');
          resolvePromise(base);
          return;
        }
        try {
          resolvePromise(toEnv(JSON.parse(json) as NodeJS.ProcessEnv));
        } catch (parseErr) {
          console.warn('[env] ambiente della shell non valido', parseErr);
          resolvePromise(base);
        }
      },
    );
  });
}

let cached: Promise<Env> | null = null;

/** Cached login-shell environment. */
export function loginShellEnv(): Promise<Env> {
  cached ??= readLoginShellEnv();
  return cached;
}

/** Environment for a user terminal: login-shell env, minus OpenPlancia internals, plus terminal info. */
export function buildPtyEnv(source: Env, appVersion: string): Env {
  const env: Env = {};
  for (const [k, v] of Object.entries(source)) {
    if (STRIPPED_KEYS.includes(k) || STRIPPED_PREFIXES.some((p) => k.startsWith(p))) continue;
    env[k] = v;
  }
  env['TERM'] = 'xterm-256color';
  env['COLORTERM'] = 'truecolor';
  env['TERM_PROGRAM'] = 'OpenPlancia';
  env['TERM_PROGRAM_VERSION'] = appVersion;
  env['LANG'] ??= 'en_US.UTF-8';
  return env;
}

/** Looks up an executable on PATH (with PATHEXT on Windows). */
export async function findExecutable(
  name: string,
  env: Env,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  const dirs = (env['PATH'] ?? env['Path'] ?? '').split(platform === 'win32' ? ';' : delimiter);
  const exts = platform === 'win32' ? (env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';') : [''];
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, name + ext.toLowerCase());
      try {
        if (!(await stat(candidate)).isFile()) continue;
        if (platform !== 'win32') await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        // not here
      }
    }
  }
  return null;
}
