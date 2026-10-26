import { realpath, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { z } from 'zod';
import type { DispatchResult } from '@shared/ipc';
import { boardIntentSchema } from '@shared/schemas';
import type { WorkspaceSnapshot } from '@shared/types';
import { BoardStore, fromPersisted, toPersisted } from '../board/BoardStore';
import { loadSettings, saveSettings } from '../settings/AppSettings';
import { createDebouncedTask, type DebouncedTask } from '../util/debounce';
import { readBoardFile, writeBoardFile } from './boardFile';

export interface WorkspaceServiceOptions {
  settingsFile: string;
  onState: (snapshot: WorkspaceSnapshot | null) => void;
  saveDelayMs?: number;
}

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

  constructor(private readonly options: WorkspaceServiceOptions) {}

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
    const unsubscribe = store.subscribe((_board, intent) => {
      saver.schedule();
      // The renderer already shows its own viewport; echoing it back is wasted work.
      if (intent.type !== 'setViewport') this.emit();
    });
    this.current = { root, name: basename(root), store, saver, unsubscribe };

    const settings = await loadSettings(this.options.settingsFile);
    await saveSettings(this.options.settingsFile, { ...settings, lastWorkspace: root });

    this.emit();
    return this.snapshot() as WorkspaceSnapshot;
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
    ws.unsubscribe();
    await ws.saver.flush();
    this.current = null;
    if (notify) this.emit();
  }

  private emit(): void {
    this.options.onState(this.snapshot());
  }
}
