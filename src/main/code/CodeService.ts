import { open, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { CodeFeedEntry, CodeFile } from '@shared/ipc';
import { resolveInWorkspace } from '../files/resolveInWorkspace';
import type { HeadContent } from '../git/GitService';

/** Files changed by Claude kept in the feed; files above this size are not shown. */
export const CODE_LIMITS = { feed: 200, bytes: 2_000_000 } as const;
/** A NUL in the first bytes means a binary file (as git does). */
const BINARY_SNIFF = 8000;

export interface CodeServiceOptions {
  root(): string | null;
  git: { headContent(root: string, rel: string): Promise<HeadContent> };
  onFeed: (feed: CodeFeedEntry[]) => void;
  /** A file shown by a Code panel changed on disk. */
  onFileChanged: (path: string) => void;
  /** Absolute paths to watch (the files Code panels show). */
  watch: (paths: string[]) => void;
  now?: () => Date;
}

const toPosix = (rel: string) => rel.split(sep).join('/');

/**
 * Code panels (spec §8.4, M7): the feed of files Claude changed (from PostToolUse), reading a
 * file of the project with its version at git HEAD, and watching the files on screen.
 * Read-only: nothing here writes to the project.
 */
export class CodeService {
  private feed: CodeFeedEntry[] = [];
  /** Code panel → file it shows (relative). */
  private readonly shown = new Map<string, string>();
  /** Absolute watched path → relative path. */
  private watchedPaths = new Map<string, string>();
  private readonly now: () => Date;

  constructor(private readonly options: CodeServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  /** Project-relative path of a file, or null when it is outside the project or in .plancia/. */
  private async relativePath(path: string): Promise<{ abs: string; rel: string } | null> {
    const root = this.options.root();
    if (!root) return null;
    try {
      const abs = await resolveInWorkspace(root, path);
      const rel = toPosix(relative(await resolveInWorkspace(root, '.'), abs));
      if (rel === '' || rel === '.plancia' || rel.startsWith('.plancia/')) return null;
      return { abs, rel };
    } catch {
      return null;
    }
  }

  /** PostToolUse of Write/Edit/MultiEdit/NotebookEdit: the file goes to the top of the feed. */
  async touched(terminalId: string, tool: string, path: string, cwd?: string): Promise<void> {
    const root = this.options.root();
    if (!root) return;
    const found = await this.relativePath(isAbsolute(path) ? path : resolve(cwd ?? root, path));
    if (!found) return;
    const previous = this.feed.find((e) => e.path === found.rel);
    this.feed = [
      {
        path: found.rel,
        terminalId,
        tool,
        at: this.now().toISOString(),
        edits: (previous?.edits ?? 0) + 1,
      },
      ...this.feed.filter((e) => e.path !== found.rel),
    ].slice(0, CODE_LIMITS.feed);
    this.options.onFeed(this.feed);
  }

  list(): CodeFeedEntry[] {
    return this.feed;
  }

  /** A file of the project with its content at HEAD (for the diff). */
  async read(path: string): Promise<CodeFile> {
    const root = this.options.root();
    const found = await this.relativePath(path);
    if (!root || !found) throw new Error(`Percorso fuori dalla cartella del progetto: ${path}`);
    const empty = { path: found.rel, content: '', binary: false, tooLarge: false };
    let size: number;
    try {
      const info = await stat(found.abs);
      if (!info.isFile()) throw new Error(`Non è un file: ${found.rel}`);
      size = info.size;
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        const head = await this.options.git.headContent(root, found.rel);
        return { ...empty, exists: false, head: head.content, repo: head.repo };
      }
      throw err;
    }
    if (size > CODE_LIMITS.bytes) {
      return { ...empty, exists: true, tooLarge: true, head: null, repo: false };
    }
    const handle = await open(found.abs, 'r');
    let buffer: Buffer;
    try {
      buffer = Buffer.alloc(size);
      await handle.read(buffer, 0, size, 0);
    } finally {
      await handle.close();
    }
    if (buffer.subarray(0, BINARY_SNIFF).includes(0)) {
      return { ...empty, exists: true, binary: true, head: null, repo: false };
    }
    const head = await this.options.git.headContent(root, found.rel);
    return {
      ...empty,
      exists: true,
      content: buffer.toString('utf8'),
      head: head.content,
      repo: head.repo,
    };
  }

  /** The file a Code panel shows now (null = none); the set of watched files follows. */
  async watch(panelId: string, path: string | null): Promise<void> {
    if (path) this.shown.set(panelId, path);
    else this.shown.delete(panelId);
    const watched = new Map<string, string>();
    for (const rel of new Set(this.shown.values())) {
      const found = await this.relativePath(rel);
      if (found) watched.set(found.abs, found.rel);
    }
    this.watchedPaths = watched;
    this.options.watch([...watched.keys()]);
  }

  /** From the watcher. */
  fileChanged(abs: string): void {
    const rel = this.watchedPaths.get(abs);
    if (rel) this.options.onFileChanged(rel);
  }

  reset(): void {
    this.feed = [];
    this.shown.clear();
    this.watchedPaths = new Map();
    this.options.watch([]);
    this.options.onFeed([]);
  }
}
