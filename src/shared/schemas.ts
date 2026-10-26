import { z } from 'zod';

// Zod schemas for every boundary (IPC, HTTP, files on disk). See docs/MVP_SPEC.md §5.

export const BOARD_SCHEMA_VERSION = 1;

export const pingResponseSchema = z.object({
  message: z.literal('pong'),
  at: z.iso.datetime(),
});

const finite = z.number().refine(Number.isFinite, 'Numero non finito');

export const positionSchema = z.object({ x: finite, y: finite });
export const sizeSchema = z.object({
  width: finite.refine((n) => n > 0, 'Larghezza non positiva'),
  height: finite.refine((n) => n > 0, 'Altezza non positiva'),
});
export const viewportSchema = z.object({ x: finite, y: finite, zoom: finite });

export const panelTypeSchema = z.enum(['terminal', 'markdown', 'architecture', 'code', 'folder']);
export const terminalModeSchema = z.enum(['shell', 'claude']);
export const agentStatusSchema = z.enum([
  'not-started',
  'idle',
  'working',
  'needs-input',
  'exited',
]);

const panelBaseShape = {
  id: z.string().min(1),
  title: z.string(),
  position: positionSchema,
  size: sizeSchema,
  version: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime(),
};

// Persisted shapes: what lives in .plancia/board.json. Runtime-only fields (terminal status) are absent.
export const persistedTerminalPanelSchema = z.object({
  ...panelBaseShape,
  type: z.literal('terminal'),
  mode: terminalModeSchema,
  cwd: z.string(),
  claudeSessionId: z.uuid().optional(),
  /** Name the Claude session got when it was created (--name): other agents address it so (M8). */
  claudeName: z.string().optional(),
});

export const markdownPanelSchema = z.object({
  ...panelBaseShape,
  type: z.literal('markdown'),
  filePath: z.string().min(1),
});

export const architecturePanelSchema = z.object({
  ...panelBaseShape,
  type: z.literal('architecture'),
});

/** A folder of the project shown as a tree of its markdown files (M6.5). */
export const folderPanelSchema = z.object({
  ...panelBaseShape,
  type: z.literal('folder'),
  /** Relative to the root, "." for the project folder itself. */
  dirPath: z.string().min(1),
});

export const codeFollowSchema = z.union([
  z.literal('all-agents'),
  z.object({ terminalId: z.string().min(1) }),
]);

export const codePanelSchema = z.object({
  ...panelBaseShape,
  type: z.literal('code'),
  follow: codeFollowSchema,
  pinnedFile: z.string().optional(),
});

export const persistedPanelSchema = z.discriminatedUnion('type', [
  persistedTerminalPanelSchema,
  markdownPanelSchema,
  architecturePanelSchema,
  codePanelSchema,
  folderPanelSchema,
]);

export const connectionSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  createdAt: z.iso.datetime(),
});

export const persistedBoardSchema = z.object({
  schemaVersion: z.literal(BOARD_SCHEMA_VERSION),
  panels: z.array(persistedPanelSchema),
  connections: z.array(connectionSchema),
  viewport: viewportSchema.optional(),
});

/** A path as stored on a panel: relative to the workspace, checked again on every access. */
export const workspacePathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((p) => !p.includes('\0'), 'Percorso non valido');

// Intents: the only way the renderer can ask the main process to change the board.
export const boardIntentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('createPanel'),
    panelType: panelTypeSchema,
    position: positionSchema,
    mode: terminalModeSchema.optional(),
    /** Required for markdown panels. */
    filePath: workspacePathSchema.optional(),
    /** Required for folder panels. */
    dirPath: workspacePathSchema.optional(),
  }),
  z.object({
    type: z.literal('movePanels'),
    moves: z.array(z.object({ id: z.string(), position: positionSchema })).min(1),
  }),
  z.object({
    type: z.literal('resizePanel'),
    id: z.string(),
    position: positionSchema,
    size: sizeSchema,
  }),
  z.object({ type: z.literal('renamePanel'), id: z.string(), title: z.string().trim().min(1) }),
  z.object({ type: z.literal('duplicatePanel'), id: z.string() }),
  z.object({ type: z.literal('deletePanels'), ids: z.array(z.string()).min(1) }),
  z.object({ type: z.literal('setViewport'), viewport: viewportSchema }),
  z.object({ type: z.literal('setTerminalMode'), id: z.string(), mode: terminalModeSchema }),
  /** Arrow from `source` to `target` (spec §6). */
  z.object({ type: z.literal('connect'), source: z.string().min(1), target: z.string().min(1) }),
  z.object({ type: z.literal('disconnect'), ids: z.array(z.string()).min(1) }),
  /** Code panel (M7): whose files it follows, and the file opened by hand (null = none). */
  z.object({ type: z.literal('setCodeFollow'), id: z.string(), follow: codeFollowSchema }),
  z.object({
    type: z.literal('setCodePinned'),
    id: z.string(),
    pinnedFile: workspacePathSchema.nullable(),
  }),
]);

// Terminal IPC payloads (renderer → main).
const terminalIdSchema = z.string().min(1).max(64);
const dimension = z.number().int().min(1).max(1000);

export const terminalStartSchema = z.object({
  id: terminalIdSchema,
  resume: z.boolean(),
  cols: dimension,
  rows: dimension,
});
export const terminalWriteSchema = z.object({
  id: terminalIdSchema,
  data: z.string().max(1_000_000),
});
export const terminalResizeSchema = z.object({
  id: terminalIdSchema,
  cols: dimension,
  rows: dimension,
});
export const terminalIdPayloadSchema = z.object({ id: terminalIdSchema });
/** Same shape for any panel id. */
export const panelIdPayloadSchema = terminalIdPayloadSchema;

/** Markdown files above this size are not loaded into a panel. */
export const MARKDOWN_MAX_CHARS = 2_000_000;

export const markdownCreateSchema = z.object({
  mode: z.enum(['new', 'open']),
  position: positionSchema,
});
export const agentHistorySchema = z.object({ a: terminalIdSchema, b: terminalIdSchema });
export const codeFileSchema = z.object({ path: workspacePathSchema });
export const codeWatchSchema = z.object({
  id: terminalIdSchema,
  path: workspacePathSchema.nullable(),
});
export const folderCreateSchema = z.object({ position: positionSchema });
/** A file of a folder panel, relative to the folder; checked again by FolderService. */
export const folderFileSchema = z.object({ id: terminalIdSchema, path: workspacePathSchema });
export const folderWriteSchema = z.object({
  id: terminalIdSchema,
  path: workspacePathSchema,
  content: z.string().max(MARKDOWN_MAX_CHARS),
  baseVersion: z.number().int().nonnegative(),
});
export const connectionHistorySchema = z.object({
  terminalId: terminalIdSchema,
  panelId: terminalIdSchema,
});

export const markdownWriteSchema = z.object({
  id: terminalIdSchema,
  content: z.string().max(MARKDOWN_MAX_CHARS),
  baseVersion: z.number().int().nonnegative(),
});
/** The document itself is validated by ArchitectureService with the ArchitectureDoc schema. */
export const architectureWriteSchema = z.object({
  id: terminalIdSchema,
  doc: z.unknown(),
  baseVersion: z.number().int().nonnegative(),
});
export const externalUrlSchema = z.url({ protocol: /^https?$/ });

export const appSettingsSchema = z.object({
  lastWorkspace: z.string().optional(),
  /** Most recent first, shown on the home screen. */
  recentWorkspaces: z.array(z.string()).max(20).optional(),
});

export const workspacePathPayloadSchema = z.object({ path: z.string().min(1).max(4096) });

/**
 * Body of a Claude Code hook request. Only the fields OpenPlancia reads are listed; everything else
 * passes through. See https://code.claude.com/docs/en/hooks.
 */
export const hookPayloadSchema = z.looseObject({
  hook_event_name: z.string(),
  session_id: z.string().optional(),
  cwd: z.string().optional(),
  source: z.string().optional(),
  prompt: z.string().optional(),
  tool_name: z.string().optional(),
  tool_input: z.record(z.string(), z.unknown()).optional(),
  tool_use_id: z.string().optional(),
  tool_response: z.unknown().optional(),
  /** Added by plancia-hook.cjs at SessionStart: the session's inbox (M8). */
  plancia_messaging_socket: z.string().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
  title: z.string().optional(),
  notification_type: z.string().optional(),
  last_assistant_message: z.string().optional(),
  reason: z.string().optional(),
});
