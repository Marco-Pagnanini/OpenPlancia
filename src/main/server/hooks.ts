import type { ActivityEvent, ActivityTool } from '@shared/activity';
import { hookPayloadSchema } from '@shared/schemas';
import type { TerminalPanel, TerminalRuntime } from '@shared/types';
import { displayPath, EDIT_TOOLS, toolFilePath, toolLabel } from './toolLabel';

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
  /** Manifest to inject now, or null (spec §7.4). */
  manifest(id: string, moment: 'start' | 'prompt'): Promise<string | null>;
  /**
   * Denial reason when the arrows forbid this tool call, else null: a file write without a
   * write arrow (spec §7.5), a message to an agent without an arrow (M8).
   */
  checkTool(
    id: string,
    toolName: string,
    toolInput: Record<string, unknown> | undefined,
    cwd: string | undefined,
  ): Promise<string | null>;
  /** Claude changed a file (Write/Edit/MultiEdit/NotebookEdit done): the Code panel feed. */
  fileTouched?(id: string, toolName: string, path: string, cwd: string | undefined): void;
  /** The session's inbox address, from SessionStart: other agents reply to it (M8). */
  setMessagingAddress?(id: string, address: string): void;
  /** A tool call ended well (PostToolUse): subagents started, messages sent to agents. */
  toolDone?(
    id: string,
    toolName: string,
    input: Record<string, unknown> | undefined,
    response: unknown,
  ): void;
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

function context(event: 'SessionStart' | 'UserPromptSubmit', text: string | null): HookResponse {
  return text ? { hookSpecificOutput: { hookEventName: event, additionalContext: text } } : null;
}

/**
 * Turns one hook request into state changes and, where needed, a decision for Claude Code.
 * Cheap enough to answer well within the hook budget. Never throws on bad input.
 */
export async function handleHook(
  terminalId: string,
  body: unknown,
  deps: HookDeps,
): Promise<HookResponse> {
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
      if (hook.plancia_messaging_socket) {
        deps.setMessagingAddress?.(terminalId, hook.plancia_messaging_socket);
      }
      const how =
        hook.source === 'resume' ? 'ripresa' : hook.source === 'clear' ? 'azzerata' : 'avviata';
      deps.appendActivity(terminalId, { kind: 'session', title: `Sessione ${how}` });
      return context('SessionStart', await deps.manifest(terminalId, 'start'));
    }
    case 'UserPromptSubmit':
      deps.setRuntime(terminalId, { status: 'working', currentTool: undefined });
      deps.appendActivity(terminalId, {
        kind: 'prompt',
        title: 'Prompt inviato',
        detail: clip(hook.prompt, 400),
      });
      return context('UserPromptSubmit', await deps.manifest(terminalId, 'prompt'));
    case 'PreToolUse': {
      const name = hook.tool_name ?? 'Tool';
      const label = toolLabel(name, hook.tool_input, root);
      const path = toolFilePath(hook.tool_input);
      const denied = await deps.checkTool(terminalId, name, hook.tool_input, hook.cwd);
      deps.appendActivity(terminalId, {
        kind: 'tool',
        title: label,
        tool: {
          name,
          useId: hook.tool_use_id,
          state: denied ? 'failed' : 'running',
          filePath: path ? displayPath(path, root) : undefined,
        },
      });
      if (denied) {
        deps.appendActivity(terminalId, {
          kind: 'error',
          title:
            name === 'SendMessage'
              ? 'Messaggio negato dalle frecce'
              : 'Scrittura negata dalle frecce',
          detail: denied,
        });
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: denied,
          },
        };
      }
      deps.setRuntime(terminalId, { status: 'working', currentTool: label });
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
      const touched = toolFilePath(hook.tool_input);
      if (!failed && touched && EDIT_TOOLS.has(hook.tool_name ?? '')) {
        deps.fileTouched?.(terminalId, hook.tool_name ?? '', touched, hook.cwd);
      }
      if (!failed && hook.tool_name) {
        deps.toolDone?.(terminalId, hook.tool_name, hook.tool_input, hook.tool_response);
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
