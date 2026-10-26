import type { ActivityEvent } from './activity';
import type { ArchDiff, ArchitectureDoc } from './architecture';
import type { BoardIntent, Position, WorkspaceSnapshot } from './types';

/**
 * IPC channel names and the typed API exposed to the renderer as `window.plancia`.
 * Shared by main, preload and renderer.
 */
export const IpcChannels = {
  ping: 'plancia:ping',
  workspaceGet: 'plancia:workspace:get',
  workspaceOpenDialog: 'plancia:workspace:open-dialog',
  workspaceClose: 'plancia:workspace:close',
  workspaceRecent: 'plancia:workspace:recent',
  workspaceOpenRecent: 'plancia:workspace:open-recent',
  /** main → renderer: the whole workspace snapshot after any change (or null when closed). */
  workspaceState: 'plancia:workspace:state',
  boardDispatch: 'plancia:board:dispatch',
  appInfo: 'plancia:app:info',
  openExternal: 'plancia:app:open-external',
  terminalStart: 'plancia:terminal:start',
  terminalStop: 'plancia:terminal:stop',
  terminalSnapshot: 'plancia:terminal:snapshot',
  /** renderer → main, fire and forget. */
  terminalWrite: 'plancia:terminal:write',
  terminalResize: 'plancia:terminal:resize',
  /** main → renderer events. */
  terminalData: 'plancia:terminal:data',
  terminalExit: 'plancia:terminal:exit',
  terminalError: 'plancia:terminal:error',
  markdownCreate: 'plancia:markdown:create',
  markdownRead: 'plancia:markdown:read',
  markdownWrite: 'plancia:markdown:write',
  markdownUndo: 'plancia:markdown:undo',
  connectionHistory: 'plancia:connection:history',
  /** main → renderer: an arrow was used (read or write). */
  connectionUsed: 'plancia:connection:used',
  manifestPreview: 'plancia:manifest:preview',
  /** main → renderer: a markdown file changed outside the panel. */
  markdownChanged: 'plancia:markdown:changed',
  architectureRead: 'plancia:architecture:read',
  architectureWrite: 'plancia:architecture:write',
  architectureUndo: 'plancia:architecture:undo',
  /** main → renderer: Claude changed an architecture, or a change was undone. */
  architectureChanged: 'plancia:architecture:changed',
  folderCreate: 'plancia:folder:create',
  folderIndex: 'plancia:folder:index',
  folderRead: 'plancia:folder:read',
  folderWrite: 'plancia:folder:write',
  folderUndo: 'plancia:folder:undo',
  folderExtract: 'plancia:folder:extract',
  /** main → renderer: the list of files of a folder panel changed. */
  folderIndexChanged: 'plancia:folder:index-changed',
  /** main → renderer: a file of a folder panel changed outside the panel. */
  folderFileChanged: 'plancia:folder:file-changed',
  activityList: 'plancia:activity:list',
  /** main → renderer: an activity entry was added or updated. */
  activityEvent: 'plancia:activity:event',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

export interface PingResponse {
  message: 'pong';
  /** ISO timestamp produced by the main process. */
  at: string;
}

export type OpenWorkspaceResult =
  | { status: 'opened'; snapshot: WorkspaceSnapshot }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export interface RecentWorkspace {
  path: string;
  name: string;
  /** False when the folder was moved or deleted. */
  exists: boolean;
}

export type DispatchResult = { ok: true } | { ok: false; error: string };

export interface AppInfo {
  platform: string;
  /** Output of `claude --version`, or null when Claude Code was not found. */
  claudeVersion: string | null;
  claudeInstallUrl: string;
}

export type TerminalErrorCode = 'claude-not-found' | 'no-session' | 'spawn-failed' | 'invalid';

export type TerminalStartResult =
  { ok: true } | { ok: false; code: TerminalErrorCode; message: string };

export interface TerminalSnapshot {
  data: string;
  /** Absolute offset (in UTF-16 units) of the end of `data` in the terminal's output stream. */
  end: number;
}

export interface TerminalDataEvent {
  id: string;
  data: string;
  /** Absolute offset of the first character of `data`. */
  start: number;
}

export interface TerminalExitEvent {
  id: string;
  exitCode: number;
  signal?: number | undefined;
}

export interface TerminalErrorEvent {
  id: string;
  code: TerminalErrorCode;
  message: string;
}

export interface MarkdownDoc {
  content: string;
  /** Panel content version (spec §5): +1 on every change, from the panel or from outside. */
  version: number;
  exists: boolean;
  /** A previous version written over by Claude can be restored ("Annulla"). */
  canUndo: boolean;
}

export interface MarkdownChangedEvent extends MarkdownDoc {
  id: string;
  /** Terminal whose Claude made this change, if any (the panel flashes and offers "Annulla"). */
  author?: string | undefined;
  /** This change restored a previous version. */
  undone?: boolean | undefined;
}

/** One read or write through an arrow (spec §9, arrow inspector). */
export interface ConnectionUse {
  terminalId: string;
  panelId: string;
  kind: 'read' | 'write';
  /** manifest = inline in the injected context; tool = Claude's own Edit/Write. */
  via: 'manifest' | 'read_panel' | 'write_panel' | 'tool';
  /** ISO timestamp. */
  at: string;
  version: number;
  chars: number;
  /** Start of the payload, for the inspector. */
  preview: string;
}

export type MarkdownUndoResult = { ok: true; version: number } | { ok: false; message: string };

export type MarkdownCreateResult =
  | { status: 'created'; panelId: string }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export type MarkdownWriteResult =
  | { ok: true; version: number }
  | { ok: false; code: 'conflict'; doc: MarkdownDoc }
  | { ok: false; code: 'error'; message: string };

export interface ArchitectureState {
  doc: ArchitectureDoc;
  /** Panel content version, as for markdown. */
  version: number;
  canUndo: boolean;
}

export interface ArchitectureChangedEvent extends ArchitectureState {
  id: string;
  author?: string | undefined;
  undone?: boolean | undefined;
  /** What changed, so the panel can highlight it. */
  diff?: ArchDiff | undefined;
}

export type ArchitectureWriteResult =
  | { ok: true; version: number; doc: ArchitectureDoc }
  | { ok: false; code: 'conflict'; state: ArchitectureState }
  | { ok: false; code: 'invalid' | 'error'; message: string };

export type ArchitectureUndoResult = MarkdownUndoResult;

/** A markdown file of a folder panel. */
export interface FolderFile {
  /** Relative to the folder, with "/" separators. */
  path: string;
  /** First "# " heading, or the file name. */
  title: string;
  chars: number;
  /** +1 on every change of the file while the app runs. */
  version: number;
}

export interface FolderIndex {
  dirPath: string;
  exists: boolean;
  files: FolderFile[];
  /** More files than the limit: the rest is not listed. */
  truncated: boolean;
}

export interface FolderIndexEvent {
  id: string;
  index: FolderIndex;
}

export interface FolderFileChangedEvent extends MarkdownDoc {
  id: string;
  path: string;
  author?: string | undefined;
  undone?: boolean | undefined;
}

export interface PlanciaApi {
  ping(): Promise<PingResponse>;
  workspace: {
    get(): Promise<WorkspaceSnapshot | null>;
    openDialog(): Promise<OpenWorkspaceResult>;
    onState(listener: (snapshot: WorkspaceSnapshot | null) => void): () => void;
    /** Closes the board (stopping its terminals) and goes back to the home screen. */
    close(): Promise<void>;
    recent(): Promise<RecentWorkspace[]>;
    openRecent(path: string): Promise<OpenWorkspaceResult>;
  };
  board: {
    dispatch(intent: BoardIntent): Promise<DispatchResult>;
  };
  app: {
    info(): Promise<AppInfo>;
    openExternal(url: string): Promise<void>;
  };
  terminal: {
    start(request: {
      id: string;
      resume: boolean;
      cols: number;
      rows: number;
    }): Promise<TerminalStartResult>;
    stop(id: string): Promise<void>;
    snapshot(id: string): Promise<TerminalSnapshot | null>;
    write(id: string, data: string): void;
    resize(id: string, cols: number, rows: number): void;
    onData(listener: (event: TerminalDataEvent) => void): () => void;
    onExit(listener: (event: TerminalExitEvent) => void): () => void;
    onError(listener: (event: TerminalErrorEvent) => void): () => void;
  };
  markdown: {
    /** Shows the native dialog ("new" or "open") and creates the panel at `position`. */
    create(request: { mode: 'new' | 'open'; position: Position }): Promise<MarkdownCreateResult>;
    read(id: string): Promise<MarkdownDoc>;
    write(id: string, content: string, baseVersion: number): Promise<MarkdownWriteResult>;
    onChanged(listener: (event: MarkdownChangedEvent) => void): () => void;
    /** Restores the content before Claude's last write. */
    undo(id: string): Promise<MarkdownUndoResult>;
  };
  folder: {
    /** Shows the native folder dialog and creates the panel at `position`. */
    create(request: { position: Position }): Promise<MarkdownCreateResult>;
    index(id: string): Promise<FolderIndex>;
    read(id: string, path: string): Promise<MarkdownDoc>;
    write(
      id: string,
      path: string,
      content: string,
      baseVersion: number,
    ): Promise<MarkdownWriteResult>;
    undo(id: string, path: string): Promise<MarkdownUndoResult>;
    /** Opens one file of the folder as its own markdown panel. */
    extract(id: string, path: string): Promise<MarkdownCreateResult>;
    onIndex(listener: (event: FolderIndexEvent) => void): () => void;
    onFileChanged(listener: (event: FolderFileChangedEvent) => void): () => void;
  };
  architecture: {
    read(id: string): Promise<ArchitectureState>;
    /** Saves the whole document (positions included); refused if `baseVersion` is stale. */
    write(id: string, doc: ArchitectureDoc, baseVersion: number): Promise<ArchitectureWriteResult>;
    undo(id: string): Promise<ArchitectureUndoResult>;
    onChanged(listener: (event: ArchitectureChangedEvent) => void): () => void;
  };
  connections: {
    history(terminalId: string, panelId: string): Promise<ConnectionUse[]>;
    onUsed(listener: (use: ConnectionUse) => void): () => void;
    /** The manifest exactly as it would be injected now ("Cosa vede Claude"). */
    manifest(terminalId: string): Promise<string>;
  };
  activity: {
    list(terminalId: string): Promise<ActivityEvent[]>;
    onEvent(listener: (event: ActivityEvent) => void): () => void;
  };
}
