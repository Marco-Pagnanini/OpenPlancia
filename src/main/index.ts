import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { IpcChannels, type AppInfo, type OpenWorkspaceResult } from '@shared/ipc';
import {
  externalUrlSchema,
  terminalIdPayloadSchema,
  terminalResizeSchema,
  terminalStartSchema,
  terminalWriteSchema,
} from '@shared/schemas';
import type { WorkspaceSnapshot } from '@shared/types';
import { CLAUDE_INSTALL_URL, claudeVersion, findClaude } from './claude/ClaudeLauncher';
import { buildPtyEnv, loginShellEnv } from './env/shellEnv';
import { handlePing } from './ipc/ping';
import { nodePtySpawn } from './pty/nodePtySpawn';
import { PtyService } from './pty/PtyService';
import { TerminalService } from './terminal/TerminalService';
import { WorkspaceService } from './workspace/WorkspaceService';

const isDev = !app.isPackaged && process.env['ELECTRON_RENDERER_URL'] !== undefined;

// Development only: a separate profile, so manual tests do not touch the real settings.
const devUserData = process.env['PLANCIA_USER_DATA'];
if (!app.isPackaged && devUserData) app.setPath('userData', devUserData);

const iconPath = app.isPackaged
  ? join(process.resourcesPath, 'resources', 'icon.png')
  : join(import.meta.dirname, '../../resources/icon.png');

let mainWindow: BrowserWindow | null = null;

function windowTitle(snapshot: WorkspaceSnapshot | null): string {
  return snapshot ? `${snapshot.name} — Plancia` : 'Plancia';
}

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

const workspace = new WorkspaceService({
  settingsFile: join(app.getPath('userData'), 'settings.json'),
  onState: (snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle(windowTitle(snapshot));
    send(IpcChannels.workspaceState, snapshot);
  },
});

const ptyEnv = () => loginShellEnv().then((env) => buildPtyEnv(env, app.getVersion()));

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
  onError: (id, code, message) => send(IpcChannels.terminalError, { id, code, message }),
});

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
  ipcMain.on(IpcChannels.terminalResize, (_event, payload: unknown) => {
    const parsed = terminalResizeSchema.safeParse(payload);
    if (parsed.success) pty.resize(parsed.data.id, parsed.data.cols, parsed.data.rows);
  });
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(iconPath);
  registerIpc();
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
    .finally(() => void workspace.close({ notify: false }).finally(() => app.quit()));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
