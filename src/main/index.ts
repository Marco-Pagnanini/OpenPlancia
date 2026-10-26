import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { IpcChannels, type OpenWorkspaceResult } from '@shared/ipc';
import type { WorkspaceSnapshot } from '@shared/types';
import { handlePing } from './ipc/ping';
import { WorkspaceService } from './workspace/WorkspaceService';

const isDev = !app.isPackaged && process.env['ELECTRON_RENDERER_URL'] !== undefined;

const iconPath = app.isPackaged
  ? join(process.resourcesPath, 'resources', 'icon.png')
  : join(import.meta.dirname, '../../resources/icon.png');

let mainWindow: BrowserWindow | null = null;

function windowTitle(snapshot: WorkspaceSnapshot | null): string {
  return snapshot ? `${snapshot.name} — Plancia` : 'Plancia';
}

const workspace = new WorkspaceService({
  settingsFile: join(app.getPath('userData'), 'settings.json'),
  onState: (snapshot) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.setTitle(windowTitle(snapshot));
    mainWindow.webContents.send(IpcChannels.workspaceState, snapshot);
  },
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

// Write any pending board change before quitting.
let quitting = false;
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void workspace.close({ notify: false }).finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
