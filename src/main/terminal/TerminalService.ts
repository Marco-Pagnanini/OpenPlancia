import { randomUUID } from 'node:crypto';
import type { TerminalErrorCode, TerminalStartResult } from '@shared/ipc';
import type { TerminalPanel } from '@shared/types';
import {
  CLAUDE_INSTALL_URL,
  claudeArgs,
  claudeLaunch,
  shellLaunch,
  type RunFiles,
} from '../claude/ClaudeLauncher';
import type { Env } from '../env/shellEnv';
import { resolveInWorkspace } from '../files/resolveInWorkspace';
import type { PtyService } from '../pty/PtyService';
import type { WorkspaceService } from '../workspace/WorkspaceService';

export interface TerminalServiceOptions {
  workspace: WorkspaceService;
  pty: PtyService;
  /** Environment for user terminals (login-shell env, cleaned up). */
  env: () => Promise<Env>;
  findClaude: (env: Env) => Promise<string | null>;
  onError: (id: string, code: TerminalErrorCode, message: string) => void;
  /** Writes the per-terminal MCP config and hook settings (fresh token each launch). */
  prepareClaude?: (id: string) => Promise<RunFiles>;
  newSessionId?: () => string;
  /** Whether Claude Code has a conversation to resume for this session id. */
  sessionExists?: (sessionId: string, env: Env) => Promise<boolean>;
}

/** Size used when the main process starts a terminal on its own; the renderer fits it right after. */
const DEFAULT_SIZE = { cols: 100, rows: 30 };

class StartError extends Error {
  constructor(
    readonly code: TerminalErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Connects terminal panels on the board to pseudo-terminal processes. */
export class TerminalService {
  private readonly newSessionId: () => string;

  constructor(private readonly options: TerminalServiceOptions) {
    this.newSessionId = options.newSessionId ?? randomUUID;
    const { workspace, pty } = options;

    workspace.onChange((change, panels) => {
      switch (change.type) {
        case 'createPanel': {
          // A terminal created by the user starts right away; reopened ones wait for a click.
          const created = panels.at(-1);
          if (created?.type === 'terminal') void this.autoStart(created.id);
          break;
        }
        case 'deletePanels':
          for (const id of change.ids) void pty.dispose(id);
          break;
        case 'setTerminalMode':
          void pty.stop(change.id).then(() => this.autoStart(change.id));
          break;
      }
    });
    workspace.onBeforeClose(() => pty.disposeAll());
  }

  async start(
    id: string,
    { resume, cols, rows }: { resume: boolean; cols: number; rows: number },
  ): Promise<TerminalStartResult> {
    try {
      await this.spawn(id, resume, cols, rows);
      return { ok: true };
    } catch (err) {
      const code = err instanceof StartError ? err.code : 'spawn-failed';
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, code, message };
    }
  }

  stop(id: string): Promise<void> {
    return this.options.pty.stop(id);
  }

  /** Called when a process exits. */
  handleExit(id: string): void {
    this.options.workspace.setTerminalStatus(id, 'exited');
  }

  shutdown(): Promise<void> {
    return this.options.pty.disposeAll();
  }

  private async autoStart(id: string): Promise<void> {
    const result = await this.start(id, { resume: false, ...DEFAULT_SIZE });
    if (!result.ok) this.options.onError(id, result.code, result.message);
  }

  private terminal(id: string): TerminalPanel {
    const panel = this.options.workspace.getPanel(id);
    if (panel?.type !== 'terminal') throw new StartError('invalid', `Terminale inesistente: ${id}`);
    return panel;
  }

  private async spawn(id: string, resume: boolean, cols: number, rows: number): Promise<void> {
    const { workspace, pty } = this.options;
    if (pty.isRunning(id)) return;
    const panel = this.terminal(id);
    const root = workspace.root();
    if (!root) throw new StartError('invalid', 'Nessuna cartella progetto aperta');

    const cwd = await resolveInWorkspace(root, panel.cwd);
    const env = await this.options.env();

    let launch;
    if (panel.mode === 'shell') {
      launch = shellLaunch(env);
    } else {
      const claudePath = await this.options.findClaude(env);
      if (!claudePath) {
        throw new StartError(
          'claude-not-found',
          `Claude Code non trovato nel PATH della shell di login. Installalo da ${CLAUDE_INSTALL_URL}`,
        );
      }
      const sessionId = resume ? panel.claudeSessionId : this.newSessionId();
      if (!sessionId) throw new StartError('no-session', 'Nessuna sessione da riprendere');
      if (!resume) workspace.setClaudeSessionId(id, sessionId);
      // A session that never got a message has nothing to resume: start it, with the same id.
      const resumable = resume && ((await this.options.sessionExists?.(sessionId, env)) ?? true);
      const files = await this.options.prepareClaude?.(id);
      launch = claudeLaunch(
        claudePath,
        claudeArgs(panel, { id: sessionId, resume: resumable }, files),
      );
    }

    pty.start(id, { ...launch, cwd, env, cols, rows });
    workspace.setTerminalStatus(id, 'idle');
  }
}
