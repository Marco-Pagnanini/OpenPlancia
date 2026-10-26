import type { ActivityEvent, ActivityTool } from '@shared/activity';
import { hookPayloadSchema } from '@shared/schemas';
import type { TerminalPanel, TerminalRuntime } from '@shared/types';
import { displayPath, toolFilePath, toolLabel } from './toolLabel';

export type NewActivity = Omit<ActivityEvent, 'id' | 'at' | 'terminalId'>;

export interface HookDeps {
  terminal(id: string): TerminalPanel | undefined;
  root(): string | null;
  setRuntime(id: string, patch: Partial<TerminalRuntime>): void;
  setSessionId(id: string, sessionId: string): void;
  appendActivity(id: string, activity: NewActivity): void;
  /** Updates the timeline entry of a tool call, by tool_use_id. */
  updateTool(id: string, toolUseId: string, patch: Partial<ActivityTool>): void;
  /** Marks tool calls still "running" as cancelled (the turn is over). */
  settleTools(id: string): void;
  /** Called when Claude needs the user (permission, question). */
  needsAttention(id: string, message: string): void;
}

/** JSON body returned to Claude Code; null means "200 with an empty body". */
export type HookResponse = Record<string, unknown> | null;

/** Notification types that mean Claude is blocked on the user. */
const ATTENTION_TYPES = new Set([
  'permission_prompt',
  'elicitation_dialog',
  'elicitation_url_dialog',
  'agent_needs_input',
]);

/** SessionEnd reasons after which the same process keeps running another session. */
const SESSION_CONTINUES = new Set(['clear', 'resume']);

function clip(text: string | undefined, max: number): string | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * Turns one hook request into state changes. Pure apart from `deps`, synchronous and cheap so
 * the HTTP answer goes back well within Claude Code's budget. Never throws on bad input.
 */
export function handleHook(terminalId: string, body: unknown, deps: HookDeps): HookResponse {
  const parsed = hookPayloadSchema.safeParse(body);
  const terminal = deps.terminal(terminalId);
  if (!parsed.success || !terminal || terminal.mode !== 'claude') return null;
  const hook = parsed.data;
  const root = deps.root();

  switch (hook.hook_event_name) {
    case 'SessionStart': {
      // /clear and in-app /resume switch session id: keep "Riprendi sessione" pointing at the live one.
      if (hook.session_id && hook.session_id !== terminal.claudeSessionId) {
        deps.setSessionId(terminalId, hook.session_id);
      }
      deps.setRuntime(terminalId, { status: 'idle', currentTool: undefined });
      const how =
        hook.source === 'resume' ? 'ripresa' : hook.source === 'clear' ? 'azzerata' : 'avviata';
      deps.appendActivity(terminalId, { kind: 'session', title: `Sessione ${how}` });
      return null;
    }
    case 'UserPromptSubmit':
      deps.setRuntime(terminalId, { status: 'working', currentTool: undefined });
      deps.appendActivity(terminalId, {
        kind: 'prompt',
        title: 'Prompt inviato',
        detail: clip(hook.prompt, 400),
      });
      return null;
    case 'PreToolUse': {
      const name = hook.tool_name ?? 'Tool';
      const label = toolLabel(name, hook.tool_input, root);
      const path = toolFilePath(hook.tool_input);
      deps.setRuntime(terminalId, { status: 'working', currentTool: label });
      deps.appendActivity(terminalId, {
        kind: 'tool',
        title: label,
        tool: {
          name,
          useId: hook.tool_use_id,
          state: 'running',
          filePath: path ? displayPath(path, root) : undefined,
        },
      });
      return null;
    }
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      const failed = hook.hook_event_name === 'PostToolUseFailure';
      // Back from a permission prompt, or simply done with this tool.
      deps.setRuntime(terminalId, { status: 'working', currentTool: undefined });
      if (hook.tool_use_id) {
        deps.updateTool(terminalId, hook.tool_use_id, { state: failed ? 'failed' : 'ok' });
      }
      if (failed && hook.error) {
        deps.appendActivity(terminalId, {
          kind: 'error',
          title: `${hook.tool_name ?? 'Tool'} non riuscito`,
          detail: clip(hook.error, 400),
        });
      }
      return null;
    }
    case 'PermissionDenied': {
      if (hook.tool_use_id) deps.updateTool(terminalId, hook.tool_use_id, { state: 'failed' });
      deps.appendActivity(terminalId, {
        kind: 'error',
        title: `Permesso negato: ${toolLabel(hook.tool_name ?? 'Tool', hook.tool_input, root)}`,
        detail: clip(hook.reason, 400),
      });
      return null;
    }
    case 'Notification': {
      const type = hook.notification_type ?? '';
      if (ATTENTION_TYPES.has(type)) {
        const message = hook.message ?? 'Claude richiede la tua attenzione';
        deps.setRuntime(terminalId, { status: 'needs-input' });
        deps.appendActivity(terminalId, {
          kind: 'attention',
          title: type === 'permission_prompt' ? 'In attesa di permesso' : 'In attesa di risposta',
          detail: clip(message, 400),
        });
        deps.needsAttention(terminalId, message);
      }
      return null;
    }
    case 'Stop':
      deps.settleTools(terminalId);
      deps.setRuntime(terminalId, { status: 'idle', currentTool: undefined });
      deps.appendActivity(terminalId, {
        kind: 'response',
        title: 'Risposta completata',
        detail: clip(hook.last_assistant_message, 600),
      });
      return null;
    case 'StopFailure':
      deps.settleTools(terminalId);
      deps.setRuntime(terminalId, { status: 'idle', currentTool: undefined });
      deps.appendActivity(terminalId, {
        kind: 'error',
        title: 'Risposta interrotta da un errore',
        detail: clip(hook.error ?? hook.message, 400),
      });
      return null;
    case 'SessionEnd':
      if (!SESSION_CONTINUES.has(hook.reason ?? '')) {
        deps.settleTools(terminalId);
        deps.setRuntime(terminalId, { status: 'exited', currentTool: undefined });
        deps.appendActivity(terminalId, { kind: 'session', title: 'Sessione terminata' });
      }
      return null;
    default:
      return null;
  }
}
