import { readFile, stat } from 'node:fs/promises';
import type { MarkdownDoc, MarkdownUndoResult, MarkdownWriteResult } from '@shared/ipc';
import { MARKDOWN_MAX_CHARS } from '@shared/schemas';
import type { MarkdownPanel, Panel } from '@shared/types';
import { writeFileAtomic } from '../util/atomicWrite';
import { resolveInWorkspace } from './resolveInWorkspace';

export interface MarkdownWorkspace {
  root(): string | null;
  panels(): Panel[];
  bumpContentVersion(id: string): number;
}

export interface MarkdownChange {
  doc: MarkdownDoc;
  /** Terminal id when Claude made the change. */
  author?: string | undefined;
  undone?: boolean | undefined;
  /** The change came from Claude's own Edit/Write (seen on disk), not from write_panel. */
  viaTool?: boolean | undefined;
}

export interface MarkdownServiceOptions {
  workspace: MarkdownWorkspace;
  /** The set of files to watch changed. */
  watch: (paths: string[]) => void;
  /** The content of a panel changed other than by its own save (outside editor, Claude, undo). */
  onExternalChange: (id: string, change: MarkdownChange) => void;
  now?: () => number;
}

/** Previous contents kept for "Annulla" (spec §7.5). */
export const UNDO_DEPTH = 20;
/** How long a permitted Edit/Write by Claude waits for the matching file change. */
const CLAUDE_WRITE_WINDOW_MS = 30_000;

interface UndoEntry {
  content: string | null;
  author: string;
}

function isMissing(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === 'ENOENT';
}

/**
 * Markdown panels are views of real files in the workspace. This service reads and writes
 * them (always through resolveInWorkspace), bumps the panel version on every change, tells
 * apart the panel's own saves from outside edits, and keeps what Claude overwrote for undo.
 */
export class MarkdownService {
  /** Last content known for each absolute path (null = file missing). */
  private readonly known = new Map<string, string | null>();
  /** Absolute path → markdown panels showing it. */
  private byPath = new Map<string, string[]>();
  /** Path → undo stack (oldest first). Kept per file: every panel on it shares it. */
  private readonly history = new Map<string, UndoEntry[]>();
  /** Path → Claude edit allowed by PreToolUse and not yet seen on disk. */
  private readonly expected = new Map<string, { terminalId: string; at: number }>();
  private readonly now: () => number;

  constructor(private readonly options: MarkdownServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  private markdownPanels(): MarkdownPanel[] {
    return this.options.workspace.panels().filter((p): p is MarkdownPanel => p.type === 'markdown');
  }

  private panel(id: string): MarkdownPanel {
    const panel = this.markdownPanels().find((p) => p.id === id);
    if (!panel) throw new Error(`Panel markdown inesistente: ${id}`);
    return panel;
  }

  /** Absolute real path of a panel's file (throws if outside the workspace). */
  async pathOf(panel: MarkdownPanel): Promise<string> {
    const root = this.options.workspace.root();
    if (!root) throw new Error('Nessuna cartella progetto aperta');
    return resolveInWorkspace(root, panel.filePath);
  }

  private async load(path: string): Promise<string | null> {
    try {
      if ((await stat(path)).size > MARKDOWN_MAX_CHARS * 4) throw new Error('File troppo grande');
      const content = await readFile(path, 'utf8');
      if (content.length > MARKDOWN_MAX_CHARS) throw new Error('File troppo grande');
      return content;
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  private doc(path: string, content: string | null, version: number): MarkdownDoc {
    return {
      content: content ?? '',
      version,
      exists: content !== null,
      canUndo: (this.history.get(path)?.length ?? 0) > 0,
    };
  }

  private pushHistory(path: string, entry: UndoEntry): void {
    const stack = this.history.get(path) ?? [];
    stack.push(entry);
    if (stack.length > UNDO_DEPTH) stack.splice(0, stack.length - UNDO_DEPTH);
    this.history.set(path, stack);
  }

  /** Bumps every panel on `path` and tells them, except `skip` (the panel that saved). */
  private broadcast(
    path: string,
    content: string | null,
    extra: Omit<MarkdownChange, 'doc'>,
    skip?: string,
  ) {
    let skipped = -1;
    for (const id of this.byPath.get(path) ?? []) {
      const version = this.options.workspace.bumpContentVersion(id);
      if (id === skip) skipped = version;
      else this.options.onExternalChange(id, { doc: this.doc(path, content, version), ...extra });
    }
    return skipped;
  }

  /** Recomputes which files to watch from the markdown panels on the board. */
  async sync(): Promise<void> {
    const byPath = new Map<string, string[]>();
    for (const panel of this.markdownPanels()) {
      try {
        const path = await this.pathOf(panel);
        byPath.set(path, [...(byPath.get(path) ?? []), panel.id]);
      } catch (err) {
        console.warn(
          `[markdown] ${panel.filePath} ignorato:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    this.byPath = byPath;
    for (const path of [...this.known.keys()]) if (!byPath.has(path)) this.known.delete(path);
    for (const path of [...this.history.keys()]) if (!byPath.has(path)) this.history.delete(path);
    this.options.watch([...byPath.keys()]);
  }

  async read(id: string): Promise<MarkdownDoc> {
    const panel = this.panel(id);
    const path = await this.pathOf(panel);
    const content = await this.load(path);
    this.known.set(path, content);
    return this.doc(path, content, panel.version);
  }

  /**
   * Saves the panel content. `baseVersion` is the version the edit started from: if the file
   * changed in the meantime the write is refused and the current content returned instead.
   * With `author` (a terminal id) the write comes from Claude: the previous content is kept
   * for undo and the panel itself is told, so it can flash.
   */
  async write(
    id: string,
    content: string,
    baseVersion: number,
    author?: string,
  ): Promise<MarkdownWriteResult> {
    try {
      const panel = this.panel(id);
      if (panel.version !== baseVersion) {
        return { ok: false, code: 'conflict', doc: await this.read(id) };
      }
      const path = await this.pathOf(panel);
      if (!this.byPath.has(path)) this.byPath.set(path, [id]);
      if (author) {
        const previous = this.known.has(path)
          ? (this.known.get(path) ?? null)
          : await this.load(path);
        this.pushHistory(path, { content: previous, author });
      }
      // Remember it before writing, so the watcher's echo is recognised as ours.
      this.known.set(path, content);
      await writeFileAtomic(path, content);
      const version = author
        ? (this.broadcast(path, content, { author }), this.panel(id).version)
        : this.broadcast(path, content, {}, id);
      return { ok: true, version };
    } catch (err) {
      return {
        ok: false,
        code: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Restores the content before Claude's last write to this panel's file. */
  async undo(id: string): Promise<MarkdownUndoResult> {
    try {
      const panel = this.panel(id);
      const path = await this.pathOf(panel);
      const entry = this.history.get(path)?.pop();
      if (!entry) return { ok: false, message: 'Niente da annullare' };
      const content = entry.content ?? '';
      this.known.set(path, content);
      await writeFileAtomic(path, content);
      this.broadcast(path, content, { undone: true });
      return { ok: true, version: this.panel(id).version };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * PreToolUse allowed Claude to Edit/Write `path`: the next change of that file is Claude's.
   * Returns the panels showing it (empty when the file is not on the board).
   */
  expectClaudeWrite(path: string, terminalId: string): string[] {
    const ids = this.byPath.get(path) ?? [];
    if (ids.length > 0) this.expected.set(path, { terminalId, at: this.now() });
    return ids;
  }

  /** Called by the file watcher. Ignores events caused by our own writes. */
  async fileChanged(path: string): Promise<void> {
    if (!this.byPath.has(path)) return;
    let content: string | null;
    try {
      content = await this.load(path);
    } catch (err) {
      console.warn('[markdown] lettura fallita', err);
      return;
    }
    const previous = this.known.has(path) ? (this.known.get(path) ?? null) : undefined;
    if (previous !== undefined && previous === content) return;
    this.known.set(path, content);

    const expected = this.expected.get(path);
    const author =
      expected && this.now() - expected.at <= CLAUDE_WRITE_WINDOW_MS
        ? expected.terminalId
        : undefined;
    this.expected.delete(path);
    if (author && previous !== undefined) this.pushHistory(path, { content: previous, author });
    this.broadcast(path, content, { author, viaTool: author ? true : undefined });
  }

  /** Panels currently showing `path`. */
  panelsAt(path: string): string[] {
    return this.byPath.get(path) ?? [];
  }

  reset(): void {
    this.known.clear();
    this.history.clear();
    this.expected.clear();
    this.byPath = new Map();
    this.options.watch([]);
  }
}
