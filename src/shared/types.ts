import type { z } from 'zod';
import type {
  agentStatusSchema,
  appSettingsSchema,
  architecturePanelSchema,
  boardIntentSchema,
  codePanelSchema,
  connectionSchema,
  markdownPanelSchema,
  panelTypeSchema,
  persistedBoardSchema,
  persistedPanelSchema,
  persistedTerminalPanelSchema,
  positionSchema,
  sizeSchema,
  terminalModeSchema,
  viewportSchema,
} from './schemas';

export type Position = z.infer<typeof positionSchema>;
export type Size = z.infer<typeof sizeSchema>;
export type Viewport = z.infer<typeof viewportSchema>;

export type PanelType = z.infer<typeof panelTypeSchema>;
export type TerminalMode = z.infer<typeof terminalModeSchema>;
export type AgentStatus = z.infer<typeof agentStatusSchema>;

export type PersistedTerminalPanel = z.infer<typeof persistedTerminalPanelSchema>;
export type PersistedPanel = z.infer<typeof persistedPanelSchema>;
export type PersistedBoard = z.infer<typeof persistedBoardSchema>;

/** Terminal panel as held in memory: persisted fields plus runtime-only status. */
export type TerminalPanel = PersistedTerminalPanel & {
  status: AgentStatus;
  /** Label of the tool Claude is running right now (from PreToolUse), if any. */
  currentTool?: string | undefined;
};

/** Runtime-only terminal fields, set by the main process. */
export type TerminalRuntime = Pick<TerminalPanel, 'status' | 'currentTool'>;
export type MarkdownPanel = z.infer<typeof markdownPanelSchema>;
export type ArchitecturePanel = z.infer<typeof architecturePanelSchema>;
export type CodePanel = z.infer<typeof codePanelSchema>;

export type Panel = TerminalPanel | MarkdownPanel | ArchitecturePanel | CodePanel;

export type Connection = z.infer<typeof connectionSchema>;

export interface Board {
  schemaVersion: PersistedBoard['schemaVersion'];
  panels: Panel[];
  connections: Connection[];
  viewport?: Viewport | undefined;
}

export type BoardIntent = z.infer<typeof boardIntentSchema>;

export type AppSettings = z.infer<typeof appSettingsSchema>;

export interface WorkspaceSnapshot {
  /** Absolute path of the project folder. */
  root: string;
  /** Folder name, for display. */
  name: string;
  board: Board;
}
