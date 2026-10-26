import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { access, rm } from 'node:fs/promises';
import { basename, dirname, extname, join, relative } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron';
import {
  IpcChannels,
  type AppInfo,
  type MarkdownCreateResult,
  type OpenWorkspaceResult,
} from '@shared/ipc';
import { agentLinks } from '@shared/access';
import { formatArchitectureForClaude } from '@shared/architecture';
import {
  agentHistorySchema,
  architectureWriteSchema,
  codeFileSchema,
  codeWatchSchema,
  connectionHistorySchema,
  externalUrlSchema,
  folderCreateSchema,
  folderFileSchema,
  folderWriteSchema,
  markdownCreateSchema,
  markdownWriteSchema,
  panelIdPayloadSchema,
  terminalIdPayloadSchema,
  terminalResizeSchema,
  terminalStartSchema,
  terminalWriteSchema,
  workspacePathPayloadSchema,
} from '@shared/schemas';
import type { WorkspaceSnapshot } from '@shared/types';
import { AccessService } from './access/AccessService';
import { ConnectionLog } from './access/ConnectionLog';
import { PanelTools } from './access/panelTools';
import { ActivityLog } from './activity/ActivityLog';
import { AgentService, agentName } from './agents/AgentService';
import { ArchitectureService } from './architecture/ArchitectureService';
import { CodeService } from './code/CodeService';
import { collectManifestEntries, ManifestTracker, renderManifest } from './claude/manifest';
import {
  CLAUDE_INSTALL_URL,
  claudeSessionExists,
  claudeVersion,
  findClaude,
  sessionStartCommand,
  writeRunFiles,
} from './claude/ClaudeLauncher';
import { buildPtyEnv, findExecutable, loginShellEnv } from './env/shellEnv';
import { FileWatcher } from './files/FileWatcher';
import { FolderService } from './files/FolderService';
import { MarkdownService } from './files/MarkdownService';
import { PathOutsideWorkspaceError, resolveInWorkspace } from './files/resolveInWorkspace';
import { writeFileAtomic } from './util/atomicWrite';
import { GitService } from './git/GitService';
import { handlePing } from './ipc/ping';
import { nodePtySpawn } from './pty/nodePtySpawn';
import { PtyService } from './pty/PtyService';
import { handleHook } from './server/hooks';
import { LocalServer } from './server/LocalServer';
import { createPlanciaMcpServer, PLANCIA_MCP_TOOLS } from './server/mcp';
import { TerminalService } from './terminal/TerminalService';
import { WorkspaceService } from './workspace/WorkspaceService';

const isDev = !app.isPackaged && process.env['ELECTRON_RENDERER_URL'] !== undefined;

// Development only: a separate profile, so manual tests do not touch the real settings.
const devUserData = process.env['PLANCIA_USER_DATA'];
if (!app.isPackaged && devUserData) app.setPath('userData', devUserData);

// The app was called "Plancia" before: carry its settings (recent folders) over once.
if (!devUserData) {
  const previous = join(app.getPath('appData'), 'plancia', 'settings.json');
  const current = join(app.getPath('userData'), 'settings.json');
  if (existsSync(previous) && !existsSync(current)) {
    mkdirSync(dirname(current), { recursive: true });
    copyFileSync(previous, current);
  }
}

const resourcesDir = app.isPackaged
  ? join(process.resourcesPath, 'resources')
  : join(import.meta.dirname, '../../resources');
const iconPath = join(resourcesDir, 'icon.png');
/** Per-terminal config files with tokens live here, never in the project (spec §4). */
const runRoot = join(app.getPath('userData'), 'run');

let mainWindow: BrowserWindow | null = null;

function windowTitle(snapshot: WorkspaceSnapshot | null): string {
  return snapshot ? `${snapshot.name} — OpenPlancia` : 'OpenPlancia';
}

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

let openRoot: string | null = null;

const workspace = new WorkspaceService({
  settingsFile: join(app.getPath('userData'), 'settings.json'),
  onState: (snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle(windowTitle(snapshot));
    send(IpcChannels.workspaceState, snapshot);
    // A different folder was opened: watch its markdown files.
    if (snapshot && snapshot.root !== openRoot) {
      void folders.sync().then(() => markdown.sync());
      architecture.sync(snapshot.board.panels);
    }
    openRoot = snapshot?.root ?? null;
  },
});

const watcher = new FileWatcher((path) => void markdown.fileChanged(path));
const markdown: MarkdownService = new MarkdownService({
  workspace,
  watch: (paths) => watcher.setPaths(paths),
  tracks: (path) => folders.tracks(path),
  onPathChanged: (path, content, extra, origin) =>
    folders.pathChanged(path, content, extra, origin),
  onExternalChange: (id, { doc, author, undone, viaTool }) => {
    send(IpcChannels.markdownChanged, { id, ...doc, author, undone });
    // Claude's own Edit/Write on a linked file counts as a write through the arrow.
    if (author && viaTool) {
      connectionLog.record({
        terminalId: author,
        panelId: id,
        kind: 'write',
        via: 'tool',
        version: doc.version,
        payload: doc.content,
      });
    }
  },
});

const folders: FolderService = new FolderService({
  workspace,
  markdown,
  onIndex: (event) => send(IpcChannels.folderIndexChanged, event),
  onFileChanged: ({ viaTool, ...event }) => {
    send(IpcChannels.folderFileChanged, event);
    if (event.author && viaTool) {
      connectionLog.record({
        terminalId: event.author,
        panelId: event.id,
        kind: 'write',
        via: 'tool',
        version: event.version,
        payload: `${event.path}\n${event.content}`,
      });
    }
  },
});

const architecture: ArchitectureService = new ArchitectureService({
  workspace,
  onChange: (event) => send(IpcChannels.architectureChanged, event),
});

const connectionLog = new ConnectionLog((use) => send(IpcChannels.connectionUsed, use));
const accessService = new AccessService({
  panels: () => workspace.panels(),
  connections: () => workspace.connections(),
  root: () => workspace.root(),
  pathOf: (panel) => markdown.pathOf(panel),
  foldersAt: (path) => folders.foldersAt(path),
});
const panelTools = new PanelTools({
  access: accessService,
  markdown,
  architecture,
  folders,
  log: connectionLog,
  panel: (id) => workspace.getPanel(id),
});
const manifests = new ManifestTracker();

function manifestEntries(terminalId: string) {
  const inlined = new Set<string>();
  return collectManifestEntries(
    terminalId,
    workspace.panels(),
    workspace.connections(),
    async (panel) => {
      if (panel.type === 'markdown') return (await markdown.read(panel.id)).content;
      if (panel.type === 'architecture') {
        return formatArchitectureForClaude((await architecture.read(panel.id)).doc);
      }
      if (panel.type === 'folder') return folders.manifestContent(panel, inlined);
      return undefined;
    },
    (panel) => {
      try {
        return folders.fileVersions(panel.id);
      } catch {
        return undefined;
      }
    },
  );
}

/** Manifest for a hook; inline contents count as reads through their arrows. */
// Messages between agents (M8): the arrows between Claude terminals decide who may write to whom.
const agents = new AgentService({
  panels: () => workspace.panels(),
  connections: () => workspace.connections(),
  onMessage: (message) => send(IpcChannels.agentMessage, message),
});

/** Names of the agents a terminal may message and of the ones that may message it. */
function agentNames(terminalId: string) {
  const { to, from } = agentLinks(terminalId, workspace.panels(), workspace.connections());
  return { to: to.map(agentName), from: from.map(agentName) };
}

async function manifestFor(terminalId: string, moment: 'start' | 'prompt'): Promise<string | null> {
  const entries = await manifestEntries(terminalId);
  const names = agentNames(terminalId);
  const text =
    moment === 'start'
      ? manifests.sessionStart(terminalId, entries, names)
      : manifests.prompt(terminalId, entries, names);
  if (text) {
    for (const entry of entries) {
      if (entry.content === undefined) continue;
      if (!text.includes(`=== ${entry.title} (versione ${entry.version}) ===`)) continue;
      connectionLog.record({
        terminalId,
        panelId: entry.id,
        kind: 'read',
        via: 'manifest',
        version: entry.version,
        payload: entry.content,
      });
    }
  }
  return text;
}

const ptyEnv = () => loginShellEnv().then((env) => buildPtyEnv(env, app.getVersion()));

// Code panels (M7): files Claude changed, read-only, with their version at git HEAD.
let gitPath: Promise<string | null> | null = null;
const git = new GitService(
  () => (gitPath ??= ptyEnv().then((env) => findExecutable('git', env))),
  ptyEnv,
);
const codeWatcher = new FileWatcher((path) => code.fileChanged(path));
const code: CodeService = new CodeService({
  root: () => workspace.root(),
  git,
  onFeed: (feed) => send(IpcChannels.codeFeedChanged, feed),
  onFileChanged: (path) => send(IpcChannels.codeFileChanged, { path }),
  watch: (paths) => codeWatcher.setPaths(paths),
});

const activity = new ActivityLog({
  dir: () => {
    const root = workspace.root();
    if (!root) return null;
    const key = createHash('sha256').update(root).digest('hex').slice(0, 16);
    return join(app.getPath('userData'), 'activity', key);
  },
  onEvent: (event) => send(IpcChannels.activityEvent, event),
});

function notifyAttention(terminalId: string, message: string): void {
  if (!Notification.isSupported() || mainWindow?.isFocused()) return;
  const panel = workspace.getPanel(terminalId);
  const notification = new Notification({
    title: `${panel?.title ?? 'Claude'} richiede attenzione`,
    body: message,
  });
  notification.on('click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
  notification.show();
}

const server = new LocalServer({
  onHook: (terminalId, body) =>
    handleHook(terminalId, body, {
      terminal: (id) => {
        const panel = workspace.getPanel(id);
        return panel?.type === 'terminal' ? panel : undefined;
      },
      root: () => workspace.root(),
      setRuntime: (id, patch) => workspace.setTerminalRuntime(id, patch),
      setSessionId: (id, sessionId) => workspace.setClaudeSessionId(id, sessionId),
      appendActivity: (id, entry) => activity.append(id, entry),
      updateTool: (id, useId, patch) => activity.updateTool(id, useId, patch),
      manifest: manifestFor,
      checkTool: async (id, toolName, toolInput, cwd) => {
        if (toolName === 'SendMessage') return agents.checkSend(id, toolInput);
        const decision = await accessService.checkFileWrite(id, toolName, toolInput, cwd);
        if (decision.decision === 'deny') return decision.reason;
        if (decision.decision === 'allow') markdown.expectClaudeWrite(decision.path, id);
        return null;
      },
      settleTools: (id) => activity.settleRunning(id),
      fileTouched: (id, tool, path, cwd) => void code.touched(id, tool, path, cwd),
      toolDone: (id, tool, input, response) => agents.toolDone(id, tool, input, response),
      setMessagingAddress: (id, address) => agents.setAddress(id, address),
      needsAttention: notifyAttention,
    }),
  createMcpServer: (terminalId) =>
    createPlanciaMcpServer(terminalId, {
      listPanels: (id) => panelTools.listPanels(id),
      readPanel: (id, panelId, path) => panelTools.readPanel(id, panelId, path),
      writePanel: (id, panelId, baseVersion, content, mode, path) =>
        panelTools.writePanel(id, panelId, baseVersion, content, mode, path),
      panelSchema: (type) => panelTools.panelSchema(type),
      // The tool call itself shows up in the timeline through PreToolUse/PostToolUse.
      onToolCall: () => undefined,
    }),
});

function prepareClaude(terminalId: string) {
  server.issueToken(terminalId);
  const hookUrl = server.url('hooks', terminalId);
  return writeRunFiles({
    runRoot,
    terminalId,
    hookUrl,
    mcpUrl: server.url('mcp', terminalId),
    startCommand: sessionStartCommand(
      process.execPath,
      join(resourcesDir, 'plancia-hook.cjs'),
      hookUrl,
    ),
    mcpTools: PLANCIA_MCP_TOOLS,
  });
}

const pty = new PtyService({
  spawn: nodePtySpawn,
  onData: (id, data, start) => send(IpcChannels.terminalData, { id, data, start }),
  onExit: (id, exitCode, signal) => {
    terminals.handleExit(id);
    send(IpcChannels.terminalExit, { id, exitCode, signal });
  },
});

const terminals: TerminalService = new TerminalService({
  workspace,
  pty,
  env: ptyEnv,
  findClaude,
  sessionExists: claudeSessionExists,
  onError: (id, code, message) => send(IpcChannels.terminalError, { id, code, message }),
  prepareClaude,
});

workspace.onChange((change) => {
  if (change.type !== 'deletePanels') return;
  for (const id of change.ids) {
    server.revoke(id);
    void activity.remove(id);
    void code.watch(id, null);
    agents.forget(id);
  }
});
workspace.onBeforeClose(() => {
  activity.reset();
  markdown.reset();
  architecture.reset();
  connectionLog.reset();
  code.reset();
  git.forget();
  agents.reset();
  return folders.reset();
});
workspace.onChange((change, panels) => void architecture.boardChanged(change, panels));
workspace.onChange((change) => {
  if (
    change.type === 'createPanel' ||
    change.type === 'deletePanels' ||
    change.type === 'duplicatePanel'
  ) {
    void folders.sync().then(() => markdown.sync());
  }
});

const MARKDOWN_FILTERS = [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdx'] }];

/** "Nuovo file markdown" / "Apri markdown": the file must live inside the project. */
async function createMarkdownPanel(
  mode: 'new' | 'open',
  position: { x: number; y: number },
): Promise<MarkdownCreateResult> {
  const root = workspace.root();
  if (!root) return { status: 'error', message: 'Nessuna cartella progetto aperta' };
  let picked: string | undefined;
  if (mode === 'new') {
    const options: Electron.SaveDialogOptions = {
      title: 'Nuovo file markdown',
      buttonLabel: 'Crea',
      defaultPath: join(root, 'NOTE.md'),
      filters: MARKDOWN_FILTERS,
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    };
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options);
    picked = result.canceled ? undefined : result.filePath;
  } else {
    const options: Electron.OpenDialogOptions = {
      title: 'Apri file markdown',
      buttonLabel: 'Apri',
      defaultPath: root,
      filters: MARKDOWN_FILTERS,
      properties: ['openFile'],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    picked = result.canceled ? undefined : result.filePaths[0];
  }
  if (!picked) return { status: 'cancelled' };

  try {
    const path = await resolveInWorkspace(root, picked);
    if (mode === 'new') {
      // An existing file is never overwritten: the panel simply shows it.
      const exists = await access(path).then(
        () => true,
        () => false,
      );
      if (!exists) await writeFileAtomic(path, `# ${basename(path, extname(path))}\n`);
    }
    const before = new Set(workspace.panels().map((p) => p.id));
    const result = workspace.dispatch({
      type: 'createPanel',
      panelType: 'markdown',
      position,
      filePath: relative(root, path),
    });
    if (!result.ok) return { status: 'error', message: result.error };
    const created = workspace.panels().find((p) => !before.has(p.id));
    return created ? { status: 'created', panelId: created.id } : { status: 'cancelled' };
  } catch (err) {
    const message =
      err instanceof PathOutsideWorkspaceError
        ? 'Il file deve stare dentro la cartella del progetto.'
        : err instanceof Error
          ? err.message
          : String(err);
    return { status: 'error', message };
  }
}

/** "Cartella": a folder inside the project, shown as a tree of its markdown files. */
async function createFolderPanel(position: {
  x: number;
  y: number;
}): Promise<MarkdownCreateResult> {
  const root = workspace.root();
  if (!root) return { status: 'error', message: 'Nessuna cartella progetto aperta' };
  const options: Electron.OpenDialogOptions = {
    title: 'Scegli una cartella del progetto',
    buttonLabel: 'Aggiungi',
    defaultPath: root,
    properties: ['openDirectory'],
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  const picked = result.filePaths[0];
  if (result.canceled || !picked) return { status: 'cancelled' };
  try {
    const path = await resolveInWorkspace(root, picked);
    const before = new Set(workspace.panels().map((p) => p.id));
    const created = workspace.dispatch({
      type: 'createPanel',
      panelType: 'folder',
      position,
      dirPath: relative(root, path) || '.',
    });
    if (!created.ok) return { status: 'error', message: created.error };
    const panel = workspace.panels().find((p) => !before.has(p.id));
    return panel ? { status: 'created', panelId: panel.id } : { status: 'cancelled' };
  } catch (err) {
    const message =
      err instanceof PathOutsideWorkspaceError
        ? 'La cartella deve stare dentro la cartella del progetto.'
        : err instanceof Error
          ? err.message
          : String(err);
    return { status: 'error', message };
  }
}

/** "Apri come panel": one file of a folder becomes a markdown panel next to it. */
async function extractFolderFile(id: string, rel: string): Promise<MarkdownCreateResult> {
  const root = workspace.root();
  const panel = workspace.getPanel(id);
  if (!root || panel?.type !== 'folder') return { status: 'error', message: 'Panel inesistente' };
  try {
    const path = await folders.resolveFile(id, rel);
    const before = new Set(workspace.panels().map((p) => p.id));
    const created = workspace.dispatch({
      type: 'createPanel',
      panelType: 'markdown',
      position: { x: panel.position.x + panel.size.width + 48, y: panel.position.y },
      filePath: relative(root, path),
    });
    if (!created.ok) return { status: 'error', message: created.error };
    const markdownPanel = workspace.panels().find((p) => !before.has(p.id));
    return markdownPanel
      ? { status: 'created', panelId: markdownPanel.id }
      : { status: 'cancelled' };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

/** "Apri file…" in a Code panel: any file of the project, shown read-only. */
async function pickCodeFile(id: string): Promise<MarkdownCreateResult> {
  const root = workspace.root();
  if (!root || workspace.getPanel(id)?.type !== 'code') {
    return { status: 'error', message: 'Panel inesistente' };
  }
  const options: Electron.OpenDialogOptions = {
    title: 'Apri un file del progetto',
    buttonLabel: 'Apri',
    defaultPath: root,
    properties: ['openFile'],
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  const picked = result.filePaths[0];
  if (result.canceled || !picked) return { status: 'cancelled' };
  try {
    const path = await resolveInWorkspace(root, picked);
    const set = workspace.dispatch({
      type: 'setCodePinned',
      id,
      pinnedFile: relative(await resolveInWorkspace(root, '.'), path),
    });
    return set.ok ? { status: 'created', panelId: id } : { status: 'error', message: set.error };
  } catch (err) {
    const message =
      err instanceof PathOutsideWorkspaceError
        ? 'Il file deve stare dentro la cartella del progetto.'
        : err instanceof Error
          ? err.message
          : String(err);
    return { status: 'error', message };
  }
}

// Detected once at startup (spec §7.1); shown in the UI.
const appInfo: Promise<AppInfo> = ptyEnv().then(async (env) => {
  const claudePath = await findClaude(env);
  const version = claudePath ? await claudeVersion(claudePath, env) : null;
  console.log(`[claude] ${version ?? 'non trovato'}${claudePath ? ` (${claudePath})` : ''}`);
  return {
    platform: process.platform,
    claudeVersion: version,
    claudeInstallUrl: CLAUDE_INSTALL_URL,
  };
});

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    show: false,
    title: windowTitle(workspace.snapshot()),
    icon: iconPath,
    backgroundColor: '#09090b',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  // Keep the workspace name in the title even if the page sets its own <title>.
  win.on('page-title-updated', (event) => event.preventDefault());

  // Never open new Electron windows; send http(s) links to the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Block navigation away from the app's own page.
  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL();
    if (url !== current) event.preventDefault();
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (isDev && devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  mainWindow = win;
  return win;
}

async function openWorkspaceDialog(): Promise<OpenWorkspaceResult> {
  const options: Electron.OpenDialogOptions = {
    title: 'Apri cartella progetto',
    buttonLabel: 'Apri',
    properties: ['openDirectory', 'createDirectory'],
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  const folder = result.filePaths[0];
  if (result.canceled || !folder) return { status: 'cancelled' };
  try {
    return { status: 'opened', snapshot: await workspace.open(folder) };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

function registerIpc(): void {
  ipcMain.handle(IpcChannels.ping, () => {
    const response = handlePing();
    console.log(`[ipc] ${IpcChannels.ping} -> ${response.message}`);
    return response;
  });
  ipcMain.handle(IpcChannels.workspaceGet, () => workspace.snapshot());
  ipcMain.handle(IpcChannels.workspaceOpenDialog, () => openWorkspaceDialog());
  ipcMain.handle(IpcChannels.workspaceClose, () => workspace.goHome());
  ipcMain.handle(IpcChannels.workspaceRecent, () => workspace.recent());
  ipcMain.handle(
    IpcChannels.workspaceOpenRecent,
    async (_event, payload: unknown): Promise<OpenWorkspaceResult> => {
      const parsed = workspacePathPayloadSchema.safeParse(payload);
      if (!parsed.success) return { status: 'error', message: 'Richiesta non valida' };
      try {
        return { status: 'opened', snapshot: await workspace.openRecent(parsed.data.path) };
      } catch (err) {
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    },
  );
  // The payload is untrusted: WorkspaceService validates it with zod.
  ipcMain.handle(IpcChannels.boardDispatch, (_event, intent: unknown) =>
    workspace.dispatch(intent),
  );

  ipcMain.handle(IpcChannels.appInfo, () => appInfo);
  ipcMain.handle(IpcChannels.openExternal, async (_event, url: unknown) => {
    const parsed = externalUrlSchema.safeParse(url);
    if (parsed.success) await shell.openExternal(parsed.data);
  });

  ipcMain.handle(IpcChannels.terminalStart, (_event, payload: unknown) => {
    const parsed = terminalStartSchema.safeParse(payload);
    if (!parsed.success) {
      return { ok: false, code: 'invalid', message: 'Richiesta non valida' } as const;
    }
    const { id, ...rest } = parsed.data;
    return terminals.start(id, rest);
  });
  ipcMain.handle(IpcChannels.terminalStop, async (_event, payload: unknown) => {
    const parsed = terminalIdPayloadSchema.safeParse(payload);
    if (parsed.success) await terminals.stop(parsed.data.id);
  });
  ipcMain.handle(IpcChannels.terminalSnapshot, (_event, payload: unknown) => {
    const parsed = terminalIdPayloadSchema.safeParse(payload);
    return parsed.success ? pty.snapshot(parsed.data.id) : null;
  });
  ipcMain.on(IpcChannels.terminalWrite, (_event, payload: unknown) => {
    const parsed = terminalWriteSchema.safeParse(payload);
    if (parsed.success) pty.write(parsed.data.id, parsed.data.data);
  });
  ipcMain.handle(IpcChannels.markdownCreate, (_event, payload: unknown) => {
    const parsed = markdownCreateSchema.safeParse(payload);
    if (!parsed.success) return { status: 'error', message: 'Richiesta non valida' } as const;
    return createMarkdownPanel(parsed.data.mode, parsed.data.position);
  });
  ipcMain.handle(IpcChannels.markdownRead, (_event, payload: unknown) => {
    const parsed = panelIdPayloadSchema.parse(payload);
    return markdown.read(parsed.id);
  });
  ipcMain.handle(IpcChannels.markdownWrite, (_event, payload: unknown) => {
    const parsed = markdownWriteSchema.safeParse(payload);
    if (!parsed.success)
      return { ok: false, code: 'error', message: 'Richiesta non valida' } as const;
    return markdown.write(parsed.data.id, parsed.data.content, parsed.data.baseVersion);
  });
  ipcMain.handle(IpcChannels.markdownUndo, (_event, payload: unknown) => {
    const parsed = panelIdPayloadSchema.safeParse(payload);
    if (!parsed.success) return { ok: false, message: 'Richiesta non valida' } as const;
    return markdown.undo(parsed.data.id);
  });
  ipcMain.handle(IpcChannels.agentHistory, (_event, payload: unknown) => {
    const parsed = agentHistorySchema.safeParse(payload);
    return parsed.success ? agents.between(parsed.data.a, parsed.data.b) : [];
  });
  ipcMain.handle(IpcChannels.codeFeed, () => code.list());
  ipcMain.handle(IpcChannels.codeRead, (_event, payload: unknown) => {
    const parsed = codeFileSchema.parse(payload);
    return code.read(parsed.path);
  });
  ipcMain.on(IpcChannels.codeWatch, (_event, payload: unknown) => {
    const parsed = codeWatchSchema.safeParse(payload);
    if (parsed.success) void code.watch(parsed.data.id, parsed.data.path);
  });
  ipcMain.handle(IpcChannels.codePick, (_event, payload: unknown) => {
    const parsed = panelIdPayloadSchema.safeParse(payload);
    if (!parsed.success) return { status: 'error', message: 'Richiesta non valida' } as const;
    return pickCodeFile(parsed.data.id);
  });
  ipcMain.handle(IpcChannels.folderCreate, (_event, payload: unknown) => {
    const parsed = folderCreateSchema.safeParse(payload);
    if (!parsed.success) return { status: 'error', message: 'Richiesta non valida' } as const;
    return createFolderPanel(parsed.data.position);
  });
  ipcMain.handle(IpcChannels.folderIndex, (_event, payload: unknown) => {
    const parsed = panelIdPayloadSchema.parse(payload);
    return folders.index(parsed.id);
  });
  ipcMain.handle(IpcChannels.folderRead, (_event, payload: unknown) => {
    const parsed = folderFileSchema.parse(payload);
    return folders.read(parsed.id, parsed.path);
  });
  ipcMain.handle(IpcChannels.folderWrite, (_event, payload: unknown) => {
    const parsed = folderWriteSchema.safeParse(payload);
    if (!parsed.success) {
      return { ok: false, code: 'error', message: 'Richiesta non valida' } as const;
    }
    const { id, path, content, baseVersion } = parsed.data;
    return folders.write(id, path, content, baseVersion);
  });
  ipcMain.handle(IpcChannels.folderUndo, (_event, payload: unknown) => {
    const parsed = folderFileSchema.safeParse(payload);
    if (!parsed.success) return { ok: false, message: 'Richiesta non valida' } as const;
    return folders.undo(parsed.data.id, parsed.data.path);
  });
  ipcMain.handle(IpcChannels.folderExtract, (_event, payload: unknown) => {
    const parsed = folderFileSchema.safeParse(payload);
    if (!parsed.success) return { status: 'error', message: 'Richiesta non valida' } as const;
    return extractFolderFile(parsed.data.id, parsed.data.path);
  });
  ipcMain.handle(IpcChannels.architectureRead, (_event, payload: unknown) => {
    const parsed = panelIdPayloadSchema.parse(payload);
    return architecture.read(parsed.id);
  });
  ipcMain.handle(IpcChannels.architectureWrite, (_event, payload: unknown) => {
    const parsed = architectureWriteSchema.safeParse(payload);
    if (!parsed.success) {
      return { ok: false, code: 'error', message: 'Richiesta non valida' } as const;
    }
    return architecture.write(parsed.data.id, parsed.data.doc, parsed.data.baseVersion);
  });
  ipcMain.handle(IpcChannels.architectureUndo, (_event, payload: unknown) => {
    const parsed = panelIdPayloadSchema.safeParse(payload);
    if (!parsed.success) return { ok: false, message: 'Richiesta non valida' } as const;
    return architecture.undo(parsed.data.id);
  });
  ipcMain.handle(IpcChannels.connectionHistory, (_event, payload: unknown) => {
    const parsed = connectionHistorySchema.safeParse(payload);
    return parsed.success ? connectionLog.list(parsed.data.terminalId, parsed.data.panelId) : [];
  });
  ipcMain.handle(IpcChannels.manifestPreview, async (_event, payload: unknown) => {
    const parsed = panelIdPayloadSchema.safeParse(payload);
    if (!parsed.success) return '';
    return renderManifest(await manifestEntries(parsed.data.id), [], agentNames(parsed.data.id));
  });
  ipcMain.handle(IpcChannels.activityList, (_event, payload: unknown) => {
    const parsed = terminalIdPayloadSchema.safeParse(payload);
    return parsed.success ? activity.list(parsed.data.id) : [];
  });
  ipcMain.on(IpcChannels.terminalResize, (_event, payload: unknown) => {
    const parsed = terminalResizeSchema.safeParse(payload);
    if (parsed.success) pty.resize(parsed.data.id, parsed.data.cols, parsed.data.rows);
  });
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(iconPath);
  registerIpc();
  // Run files from a previous launch hold tokens that no longer work: drop them.
  await rm(runRoot, { recursive: true, force: true });
  const port = await server.start();
  console.log(`[server] in ascolto su 127.0.0.1:${port}`);
  await workspace.restoreLast();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Refuse any webview or extra content the renderer might try to attach.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

// Close every terminal process and write any pending board change before quitting.
let quitting = false;
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void terminals
    .shutdown()
    .catch((err: unknown) => console.error('[pty] chiusura dei terminali fallita', err))
    .finally(
      () =>
        void workspace
          .close({ notify: false })
          .then(() =>
            Promise.all([server.stop(), watcher.close(), folders.close(), codeWatcher.close()]),
          )
          .finally(() => app.quit()),
    );
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
