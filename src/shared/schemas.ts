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

export const panelTypeSchema = z.enum(['terminal', 'markdown', 'architecture', 'code']);
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

// Intents: the only way the renderer can ask the main process to change the board.
export const boardIntentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('createPanel'),
    panelType: panelTypeSchema,
    position: positionSchema,
    mode: terminalModeSchema.optional(),
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
export const externalUrlSchema = z.url({ protocol: /^https?$/ });

export const appSettingsSchema = z.object({
  lastWorkspace: z.string().optional(),
});
