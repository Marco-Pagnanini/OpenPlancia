/** One entry of a terminal's activity timeline (spec §9). */
export type ActivityKind = 'session' | 'prompt' | 'tool' | 'attention' | 'response' | 'error';

/** `cancelled`: the turn ended without a result (denied by another hook, interrupted…). */
export type ToolState = 'running' | 'ok' | 'failed' | 'cancelled';

export interface ActivityTool {
  name: string;
  useId?: string | undefined;
  state: ToolState;
  /** Workspace-relative path for file tools. */
  filePath?: string | undefined;
}

export interface ActivityEvent {
  id: string;
  terminalId: string;
  /** ISO timestamp. */
  at: string;
  kind: ActivityKind;
  title: string;
  detail?: string | undefined;
  tool?: ActivityTool | undefined;
}
