import { watch, type FSWatcher } from 'chokidar';

export type FileEvent = 'add' | 'change' | 'unlink';

/**
 * Watches an explicit set of files (those shown in panels) with chokidar. Atomic saves
 * (write temp + rename, as editors and Plancia itself do) surface as a single change.
 */
export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private paths = new Set<string>();

  constructor(private readonly onEvent: (path: string, event: FileEvent) => void) {}

  /** Replaces the watched set with `paths` (absolute). */
  setPaths(paths: Iterable<string>): void {
    const next = new Set(paths);
    const added = [...next].filter((p) => !this.paths.has(p));
    const removed = [...this.paths].filter((p) => !next.has(p));
    this.paths = next;
    if (removed.length > 0) this.watcher?.unwatch(removed);
    if (added.length === 0) return;
    if (!this.watcher) {
      this.watcher = watch(added, {
        ignoreInitial: true,
        atomic: true,
        awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
      });
      this.watcher.on('add', (p) => this.onEvent(p, 'add'));
      this.watcher.on('change', (p) => this.onEvent(p, 'change'));
      this.watcher.on('unlink', (p) => this.onEvent(p, 'unlink'));
      this.watcher.on('error', (err) => console.warn('[watcher]', err));
    } else {
      this.watcher.add(added);
    }
  }

  async close(): Promise<void> {
    this.paths.clear();
    const watcher = this.watcher;
    this.watcher = null;
    await watcher?.close();
  }
}
