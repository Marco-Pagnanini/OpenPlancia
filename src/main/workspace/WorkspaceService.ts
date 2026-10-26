import { realpath, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { z } from 'zod';
import type { DispatchResult, RecentWorkspace } from '@shared/ipc';
import { boardIntentSchema } from '@shared/schemas';
import type {
  AgentStatus,
  Connection,
  Panel,
  TerminalRuntime,
  WorkspaceSnapshot,
} from '@shared/types';
import { BoardStore, fromPersisted, toPersisted, type BoardChange } from '../board/BoardStore';
import { loadSettings, saveSettings } from '../settings/AppSettings';
import { createDebouncedTask, type DebouncedTask } from '../util/debounce';
import { readBoardFile, writeBoardFile } from './boardFile';

const MAX_RECENT = 8;

export interface WorkspaceServiceOptions {
  settingsFile: string;
  onState: (snapshot: WorkspaceSnapshot | null) => void;
  saveDelayMs?: number;
}

export type WorkspaceChangeListener = (change: BoardChange, panels: Panel[]) => void;

interface OpenWorkspace {
  root: string;
  name: string;
  store: BoardStore;
  saver: DebouncedTask;
  unsubscribe: () => void;
}

/** Owns the open project folder: loads its board, persists changes, remembers the last one. */
export class WorkspaceService {
  private current: OpenWorkspace | null = null;
  private readonly changeListeners = new Set<WorkspaceChangeListener>();
  private readonly closeListeners = new Set<() => Promise<void> | void>();

  constructor(private readonly options: WorkspaceServiceOptions) {}

  root(): string | null {
    return this.current?.root ?? null;
  }

  getPanel(id: string): Panel | undefined {
    return this.current?.store.getBoard().panels.find((p) => p.id === id);
  }

  /** Board changes of the open workspace, after they are applied. */
  onChange(listener: WorkspaceChangeListener): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /** Runs (and is awaited) before a workspace is closed or replaced. */
  onBeforeClose(listener: () => Promise<void> | void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  setTerminalStatus(id: string, status: AgentStatus): void {
    this.setTerminalRuntime(id, { status });
  }

  setTerminalRuntime(id: string, patch: Partial<TerminalRuntime>): void {
    if (this.getPanel(id)?.type === 'terminal') this.current?.store.setTerminalRuntime(id, patch);
  }

  panels(): Panel[] {
    return this.current?.store.getBoard().panels ?? [];
  }

  connections(): Connection[] {
    return this.current?.store.getBoard().connections ?? [];
  }

  /** Records a content change of a panel; returns the new version. */
  bumpContentVersion(id: string): number {
    const store = this.current?.store;
    if (!store) throw new Error('Nessuna cartella progetto aperta');
    return store.bumpVersion(id);
  }

  setClaudeSessionId(id: string, sessionId: string, name?: string): void {
    this.current?.store.setClaudeSessionId(id, sessionId, name);
  }

  snapshot(): WorkspaceSnapshot | null {
    const ws = this.current;
    return ws ? { root: ws.root, name: ws.name, board: ws.store.getBoard() } : null;
  }

  async open(folder: string): Promise<WorkspaceSnapshot> {
    let root: string;
    try {
      root = await realpath(folder);
      if (!(await stat(root)).isDirectory()) throw new Error();
    } catch {
      throw new Error(`Cartella non trovata: ${folder}`);
    }

    const persisted = await readBoardFile(root);
    await this.close({ notify: false });

    const store = new BoardStore(fromPersisted(persisted));
    const saver = createDebouncedTask(
      () => writeBoardFile(root, toPersisted(store.getBoard())),
      this.options.saveDelayMs ?? 500,
      (err) => console.error('[workspace] salvataggio di board.json fallito', err),
    );
    const unsubscribe = store.subscribe((board, change) => {
      if (change.type !== 'terminalRuntime') saver.schedule();
      // The renderer already shows its own viewport; echoing it back is wasted work.
      if (change.type !== 'setViewport') this.emit();
      for (const listener of this.changeListeners) listener(change, board.panels);
    });
    this.current = { root, name: basename(root), store, saver, unsubscribe };

    const settings = await loadSettings(this.options.settingsFile);
    const recentWorkspaces = [root, ...(settings.recentWorkspaces ?? []).filter((p) => p !== root)];
    await saveSettings(this.options.settingsFile, {
      ...settings,
      lastWorkspace: root,
      recentWorkspaces: recentWorkspaces.slice(0, MAX_RECENT),
    });

    this.emit();
    return this.snapshot() as WorkspaceSnapshot;
  }

  /** Closes the board and forgets it as "last": the next launch shows the home screen. */
  async goHome(): Promise<void> {
    await this.close();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { lastWorkspace, ...settings } = await loadSettings(this.options.settingsFile);
    await saveSettings(this.options.settingsFile, settings);
  }

  /** Recently opened folders, most recent first. */
  async recent(): Promise<RecentWorkspace[]> {
    const { recentWorkspaces = [] } = await loadSettings(this.options.settingsFile);
    return Promise.all(
      recentWorkspaces.map(async (path) => ({
        path,
        name: basename(path),
        exists: await stat(path).then(
          (s) => s.isDirectory(),
          () => false,
        ),
      })),
    );
  }

  /** Opens a folder from the recent list (and only from there). */
  async openRecent(path: string): Promise<WorkspaceSnapshot> {
    const { recentWorkspaces = [] } = await loadSettings(this.options.settingsFile);
    if (!recentWorkspaces.includes(path)) throw new Error('Cartella non presente tra le recenti');
    return this.open(path);
  }

  /** Reopens the last workspace if it still exists. Never throws. */
  async restoreLast(): Promise<WorkspaceSnapshot | null> {
    const { lastWorkspace } = await loadSettings(this.options.settingsFile);
    if (!lastWorkspace) return null;
    try {
      return await this.open(lastWorkspace);
    } catch (err) {
      console.warn('[workspace] impossibile riaprire l’ultima cartella', err);
      return null;
    }
  }

  dispatch(rawIntent: unknown): DispatchResult {
    const ws = this.current;
    if (!ws) return { ok: false, error: 'Nessuna cartella progetto aperta' };
    const parsed = boardIntentSchema.safeParse(rawIntent);
    if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
    try {
      ws.store.apply(parsed.data);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Writes any pending change to disk. */
  async flush(): Promise<void> {
    await this.current?.saver.flush();
  }

  async close({ notify = true }: { notify?: boolean } = {}): Promise<void> {
    const ws = this.current;
    if (!ws) return;
    for (const listener of this.closeListeners) await listener();
    ws.unsubscribe();
    await ws.saver.flush();
    this.current = null;
    if (notify) this.emit();
  }

  private emit(): void {
    this.options.onState(this.snapshot());
  }
}
