import { open, readdir, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, sep } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type {
  FolderFile,
  FolderFileChangedEvent,
  FolderIndex,
  FolderIndexEvent,
  MarkdownDoc,
  MarkdownUndoResult,
  MarkdownWriteResult,
} from '@shared/ipc';
import type { FolderPanel, Panel } from '@shared/types';
import type { MarkdownChange, MarkdownService } from './MarkdownService';
import { resolveInWorkspace } from './resolveInWorkspace';

/** What a folder panel shows (M6.5): markdown files, a few levels deep, not too many. */
export const FOLDER_LIMITS = { depth: 4, files: 500 } as const;
/** What a folder adds to Claude's context: the index plus the smallest files, within budget. */
export const FOLDER_INLINE = { total: 4000, file: 1500, indexLines: 150 } as const;

const MARKDOWN = /\.(md|mdx)$/i;
const IGNORED_DIRS = new Set(['node_modules', '.git', '.plancia']);
const TITLE_BYTES = 4096;
const RESCAN_MS = 150;

/** Whether a path relative to the folder is one of the files the panel shows. */
export function isFolderFile(rel: string): boolean {
  if (rel === '' || isAbsolute(rel)) return false;
  const parts = rel.split(/[\\/]/);
  if (parts.some((p) => p === '' || p === '.' || p === '..' || p.startsWith('.'))) return false;
  if (parts.length - 1 > FOLDER_LIMITS.depth) return false;
  if (parts.slice(0, -1).some((p) => IGNORED_DIRS.has(p))) return false;
  return MARKDOWN.test(parts[parts.length - 1] ?? '');
}

/** First "# " heading of a markdown text, or the file name without extension. */
export function fileTitle(text: string, rel: string): string {
  const heading = /^#[ \t]+(.+?)[ \t#]*$/m.exec(text)?.[1]?.trim();
  return heading || basename(rel, extname(rel));
}

/** The index as Claude reads it: one file per line, paths relative to the folder. */
export function renderFolderIndex(panel: Pick<FolderPanel, 'dirPath'>, index: FolderIndex): string {
  const name = panel.dirPath === '.' ? 'cartella del progetto' : `cartella ${panel.dirPath}/`;
  if (!index.exists) return `${name}: non trovata.`;
  const head = `${name} · ${index.files.length}${index.truncated ? '+' : ''} file .md (percorsi relativi alla cartella):`;
  const lines = index.files
    .slice(0, FOLDER_INLINE.indexLines)
    .map((f) => `- ${f.path} "${f.title}" · v${f.version} · ${f.chars} car`);
  const rest = index.files.length - lines.length;
  if (rest > 0) lines.push(`- … altri ${rest} file`);
  return [head, ...lines].join('\n');
}

const toPosix = (rel: string) => rel.split(sep).join('/');

export interface FolderWorkspace {
  root(): string | null;
  panels(): Panel[];
  bumpContentVersion(id: string): number;
}

export interface FolderServiceOptions {
  workspace: FolderWorkspace;
  markdown: Pick<
    MarkdownService,
    'readPath' | 'writePath' | 'undoPath' | 'canUndoPath' | 'fileChanged'
  >;
  onIndex: (event: FolderIndexEvent) => void;
  /** A file changed other than by the folder panel's own save. */
  onFileChanged: (event: FolderFileChangedEvent & { viaTool?: boolean | undefined }) => void;
  /** Watch the folders on disk (off in unit tests). */
  watch?: boolean;
}

interface OpenFolder {
  id: string;
  dirPath: string;
  /** Real absolute path, null when the folder does not exist. */
  dir: string | null;
  index: FolderIndex;
  watcher: FSWatcher | null;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Folder panels (M6.5): a directory of the project shown as a tree of its markdown files. The
 * file contents go through MarkdownService (echoes, undo, Claude attribution are shared with
 * markdown panels); this service keeps the index, a version per file and the watchers.
 */
export class FolderService {
  private readonly folders = new Map<string, OpenFolder>();
  /** Absolute path → version of the file, +1 on every change seen while the app runs. */
  private readonly versions = new Map<string, number>();

  constructor(private readonly options: FolderServiceOptions) {}

  private folderPanels(): FolderPanel[] {
    return this.options.workspace.panels().filter((p): p is FolderPanel => p.type === 'folder');
  }

  private folder(id: string): OpenFolder {
    const folder = this.folders.get(id);
    if (!folder) throw new Error(`Panel cartella inesistente: ${id}`);
    return folder;
  }

  /** Opens the folders of new folder panels and closes the ones whose panel is gone. */
  async sync(): Promise<void> {
    const root = this.options.workspace.root();
    const panels = this.folderPanels();
    for (const [id, folder] of this.folders) {
      if (!panels.some((p) => p.id === id && p.dirPath === folder.dirPath)) {
        await this.closeFolder(id);
      }
    }
    if (!root) return;
    for (const panel of panels) {
      if (!this.folders.has(panel.id)) await this.openFolder(panel, root);
    }
  }

  private async openFolder(panel: FolderPanel, root: string): Promise<void> {
    let dir: string | null;
    try {
      const path = await resolveInWorkspace(root, panel.dirPath);
      dir = (await stat(path)).isDirectory() ? path : null;
    } catch {
      dir = null;
    }
    const folder: OpenFolder = {
      id: panel.id,
      dirPath: panel.dirPath,
      dir,
      index: { dirPath: panel.dirPath, exists: dir !== null, files: [], truncated: false },
      watcher: null,
      timer: null,
    };
    this.folders.set(panel.id, folder);
    if (dir) {
      folder.index = await this.scan(folder);
      if (this.options.watch !== false) folder.watcher = this.watchFolder(folder, dir);
    }
    this.options.onIndex({ id: folder.id, index: folder.index });
  }

  private async closeFolder(id: string): Promise<void> {
    const folder = this.folders.get(id);
    if (!folder) return;
    this.folders.delete(id);
    if (folder.timer) clearTimeout(folder.timer);
    await folder.watcher?.close();
  }

  private versionOf(path: string, exists: boolean): number {
    const known = this.versions.get(path);
    if (known !== undefined) return known;
    if (!exists) return 0;
    this.versions.set(path, 1);
    return 1;
  }

  private async describe(path: string, rel: string): Promise<FolderFile> {
    const { size } = await stat(path);
    const handle = await open(path, 'r');
    let head: string;
    try {
      const buffer = Buffer.alloc(Math.min(size, TITLE_BYTES));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      head = buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
    return {
      path: rel,
      title: fileTitle(head, rel),
      chars: size,
      version: this.versionOf(path, true),
    };
  }

  /** Lists the markdown files: no symlinks, no hidden or ignored folders, limited depth. */
  private async scan(folder: OpenFolder): Promise<FolderIndex> {
    const files: FolderFile[] = [];
    let truncated = false;
    const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (!IGNORED_DIRS.has(entry.name) && depth < FOLDER_LIMITS.depth) {
            await walk(join(dir, entry.name), childRel, depth + 1);
          }
        } else if (entry.isFile() && MARKDOWN.test(entry.name)) {
          if (files.length >= FOLDER_LIMITS.files) {
            truncated = true;
            continue;
          }
          try {
            files.push(await this.describe(join(dir, entry.name), childRel));
          } catch {
            // vanished while scanning
          }
        }
      }
    };
    if (folder.dir) await walk(folder.dir, '', 0);
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { dirPath: folder.dirPath, exists: folder.dir !== null, files, truncated };
  }

  /** Files were added or removed: list them again, shortly (events come in bursts). */
  private scheduleRescan(folder: OpenFolder): void {
    if (folder.timer) clearTimeout(folder.timer);
    folder.timer = setTimeout(() => {
      folder.timer = null;
      void this.rescan(folder.id);
    }, RESCAN_MS);
  }

  async rescan(id: string): Promise<void> {
    const folder = this.folders.get(id);
    if (!folder) return;
    const before = folder.index.files.map((f) => f.path).join('\n');
    const index = await this.scan(folder);
    if (this.folders.get(id) !== folder) return;
    folder.index = index;
    // Files added or removed are a change of the panel's content, for the manifest too.
    if (index.files.map((f) => f.path).join('\n') !== before) {
      this.options.workspace.bumpContentVersion(id);
    }
    this.options.onIndex({ id, index });
  }

  private watchFolder(folder: OpenFolder, dir: string): FSWatcher {
    const watcher = watch(dir, {
      ignoreInitial: true,
      depth: FOLDER_LIMITS.depth,
      atomic: true,
      awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
      ignored: (path, stats) => {
        const rel = relative(dir, path);
        if (rel === '') return false;
        const parts = rel.split(sep);
        if (parts.some((p) => p.startsWith('.') || IGNORED_DIRS.has(p))) return true;
        return stats?.isFile() === true && !MARKDOWN.test(path);
      },
    });
    const listChanged = (path: string) => {
      void this.options.markdown.fileChanged(path);
      this.scheduleRescan(folder);
    };
    watcher.on('add', listChanged);
    watcher.on('unlink', listChanged);
    watcher.on('change', (path) => void this.options.markdown.fileChanged(path));
    watcher.on('addDir', () => this.scheduleRescan(folder));
    watcher.on('unlinkDir', () => this.scheduleRescan(folder));
    watcher.on('error', (err) => console.warn('[folder]', err));
    return watcher;
  }

  private relIn(folder: OpenFolder, path: string): string | null {
    if (!folder.dir) return null;
    const rel = relative(folder.dir, path);
    return isFolderFile(rel) ? toPosix(rel) : null;
  }

  /** Folder panels that show `path` (absolute, real). */
  foldersAt(path: string): string[] {
    return [...this.folders.values()]
      .filter((folder) => this.relIn(folder, path) !== null)
      .map((folder) => folder.id);
  }

  tracks(path: string): boolean {
    return this.foldersAt(path).length > 0;
  }

  /** Absolute real path of a file of the folder; rejects anything the panel would not show. */
  async resolveFile(id: string, rel: string): Promise<string> {
    const folder = this.folder(id);
    const root = this.options.workspace.root();
    if (!folder.dir || !root) throw new Error(`La cartella ${folder.dirPath} non esiste`);
    if (!isFolderFile(rel)) {
      throw new Error(
        `Percorso non valido nella cartella: ${rel}. Sono ammessi solo file .md/.mdx, al massimo ${FOLDER_LIMITS.depth} sottocartelle, senza cartelle nascoste né node_modules.`,
      );
    }
    const path = await resolveInWorkspace(root, join(folder.dir, ...rel.split(/[\\/]/)));
    if (this.relIn(folder, path) === null) {
      throw new Error(`Percorso fuori dalla cartella ${folder.dirPath}: ${rel}`);
    }
    return path;
  }

  index(id: string): FolderIndex {
    return this.folder(id).index;
  }

  /** Version of every file, for the manifest's "what changed" line. */
  fileVersions(id: string): Record<string, number> {
    return Object.fromEntries(this.folder(id).index.files.map((f) => [f.path, f.version]));
  }

  async read(id: string, rel: string): Promise<MarkdownDoc> {
    const path = await this.resolveFile(id, rel);
    const content = await this.options.markdown.readPath(path);
    return {
      content: content ?? '',
      version: this.versionOf(path, content !== null),
      exists: content !== null,
      canUndo: this.options.markdown.canUndoPath(path),
    };
  }

  /**
   * Writes a file of the folder. `baseVersion` is the file's version (0 for a file that does
   * not exist yet, which is then created). With `author` the write is Claude's.
   */
  async write(
    id: string,
    rel: string,
    content: string,
    baseVersion: number,
    author?: string,
  ): Promise<MarkdownWriteResult> {
    try {
      const path = await this.resolveFile(id, rel);
      const current = await this.options.markdown.readPath(path);
      const version = this.versionOf(path, current !== null);
      if (version !== baseVersion) {
        return {
          ok: false,
          code: 'conflict',
          doc: {
            content: current ?? '',
            version,
            exists: current !== null,
            canUndo: this.options.markdown.canUndoPath(path),
          },
        };
      }
      // The panel's own save is not echoed back to it; Claude's write is (it flashes).
      await this.options.markdown.writePath(
        path,
        content,
        author,
        author ? undefined : `folder:${id}`,
      );
      if (current === null) await this.rescan(id);
      return { ok: true, version: this.versions.get(path) ?? 1 };
    } catch (err) {
      return {
        ok: false,
        code: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async undo(id: string, rel: string): Promise<MarkdownUndoResult> {
    try {
      const path = await this.resolveFile(id, rel);
      if (!(await this.options.markdown.undoPath(path))) {
        return { ok: false, message: 'Niente da annullare' };
      }
      return { ok: true, version: this.versions.get(path) ?? 1 };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  /** From MarkdownService: a file changed, by whoever. Bumps it and tells its folders. */
  pathChanged(
    path: string,
    content: string | null,
    extra: Omit<MarkdownChange, 'doc'>,
    origin?: string,
  ): void {
    const ids = this.foldersAt(path);
    if (ids.length === 0) return;
    const version = (this.versions.get(path) ?? 0) + 1;
    this.versions.set(path, version);
    for (const id of ids) {
      const folder = this.folder(id);
      const rel = this.relIn(folder, path) ?? '';
      this.options.workspace.bumpContentVersion(id);
      const entry = folder.index.files.find((f) => f.path === rel);
      if (entry && content !== null) {
        folder.index = {
          ...folder.index,
          files: folder.index.files.map((f) =>
            f === entry
              ? {
                  ...f,
                  version,
                  chars: Buffer.byteLength(content),
                  title: fileTitle(content, rel),
                }
              : f,
          ),
        };
        this.options.onIndex({ id, index: folder.index });
      } else {
        this.scheduleRescan(folder);
      }
      if (origin === `folder:${id}`) continue;
      this.options.onFileChanged({
        id,
        path: rel,
        content: content ?? '',
        version,
        exists: content !== null,
        canUndo: this.options.markdown.canUndoPath(path),
        author: extra.author,
        undone: extra.undone,
        viaTool: extra.viaTool,
      });
    }
  }

  /**
   * The index plus the smallest files in full, for Claude's context. `inlined` (absolute paths)
   * is shared by the folders of one manifest: a file inside two linked folders goes in once.
   * The files are chosen before the first await, so the first folder on the board wins.
   */
  async manifestContent(panel: FolderPanel, inlined = new Set<string>()): Promise<string> {
    const folder = this.folder(panel.id);
    const parts = [renderFolderIndex(panel, folder.index)];
    let budget: number = FOLDER_INLINE.total;
    const chosen: string[] = [];
    let elsewhere = 0;
    const small = [...folder.index.files]
      .filter((f) => f.chars <= FOLDER_INLINE.file)
      .sort((a, b) => a.chars - b.chars);
    for (const file of small) {
      if (file.chars > budget) break;
      const path = folder.dir ? join(folder.dir, ...file.path.split('/')) : '';
      if (inlined.has(path)) {
        elsewhere++;
        continue;
      }
      inlined.add(path);
      chosen.push(file.path);
      budget -= file.chars;
    }
    for (const rel of chosen) {
      const doc = await this.read(panel.id, rel).catch(() => null);
      if (!doc?.exists) continue;
      parts.push(`--- ${rel} (v${doc.version}) ---\n${doc.content.replace(/\s+$/, '')}`);
    }
    const left = folder.index.files.length - (parts.length - 1) - elsewhere;
    if (elsewhere > 0) {
      parts.push(`${elsewhere} file sono già riportati per intero da un'altra cartella collegata.`);
    }
    if (left > 0) {
      parts.push(
        `Gli altri ${left} file si leggono con mcp__plancia__read_panel indicando "path".`,
      );
    }
    return parts.join('\n\n');
  }

  async close(): Promise<void> {
    for (const id of [...this.folders.keys()]) await this.closeFolder(id);
  }

  async reset(): Promise<void> {
    await this.close();
    this.versions.clear();
  }
}
