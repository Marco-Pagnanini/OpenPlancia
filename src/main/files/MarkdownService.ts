import { readFile, stat } from 'node:fs/promises';
import type { MarkdownDoc, MarkdownWriteResult } from '@shared/ipc';
import { MARKDOWN_MAX_CHARS } from '@shared/schemas';
import type { MarkdownPanel, Panel } from '@shared/types';
import { writeFileAtomic } from '../util/atomicWrite';
import { resolveInWorkspace } from './resolveInWorkspace';

export interface MarkdownWorkspace {
  root(): string | null;
  panels(): Panel[];
  bumpContentVersion(id: string): number;
}

export interface MarkdownServiceOptions {
  workspace: MarkdownWorkspace;
  /** The set of files to watch changed. */
  watch: (paths: string[]) => void;
  /** A file changed outside the panel (another editor, Claude in M5…). */
  onExternalChange: (id: string, doc: MarkdownDoc) => void;
}

function isMissing(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === 'ENOENT';
}

/**
 * Markdown panels are views of real files in the workspace. This service reads and writes
 * them (always through resolveInWorkspace), bumps the panel version on every change and tells
 * apart the panel's own saves from outside edits.
 */
export class MarkdownService {
  /** Last content known for each absolute path (null = file missing). */
  private readonly known = new Map<string, string | null>();
  /** Absolute path → markdown panels showing it. */
  private byPath = new Map<string, string[]>();

  constructor(private readonly options: MarkdownServiceOptions) {}

  private markdownPanels(): MarkdownPanel[] {
    return this.options.workspace.panels().filter((p): p is MarkdownPanel => p.type === 'markdown');
  }

  private panel(id: string): MarkdownPanel {
    const panel = this.markdownPanels().find((p) => p.id === id);
    if (!panel) throw new Error(`Panel markdown inesistente: ${id}`);
    return panel;
  }

  private async resolve(panel: MarkdownPanel): Promise<string> {
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

  /** Recomputes which files to watch from the markdown panels on the board. */
  async sync(): Promise<void> {
    const byPath = new Map<string, string[]>();
    for (const panel of this.markdownPanels()) {
      try {
        const path = await this.resolve(panel);
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
    this.options.watch([...byPath.keys()]);
  }

  async read(id: string): Promise<MarkdownDoc> {
    const panel = this.panel(id);
    const path = await this.resolve(panel);
    const content = await this.load(path);
    this.known.set(path, content);
    return { content: content ?? '', version: panel.version, exists: content !== null };
  }

  /**
   * Saves the panel content. `baseVersion` is the version the edit started from: if the file
   * changed in the meantime the write is refused and the current content returned instead.
   */
  async write(id: string, content: string, baseVersion: number): Promise<MarkdownWriteResult> {
    try {
      const panel = this.panel(id);
      if (panel.version !== baseVersion) {
        return { ok: false, code: 'conflict', doc: await this.read(id) };
      }
      const path = await this.resolve(panel);
      // Remember it before writing, so the watcher's echo is recognised as ours.
      this.known.set(path, content);
      await writeFileAtomic(path, content);
      let version = baseVersion;
      for (const panelId of this.byPath.get(path) ?? [id]) {
        const next = this.options.workspace.bumpContentVersion(panelId);
        if (panelId === id) version = next;
        else this.options.onExternalChange(panelId, { content, version: next, exists: true });
      }
      return { ok: true, version };
    } catch (err) {
      return {
        ok: false,
        code: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Called by the file watcher. Ignores events caused by our own writes. */
  async fileChanged(path: string): Promise<void> {
    const ids = this.byPath.get(path);
    if (!ids) return;
    let content: string | null;
    try {
      content = await this.load(path);
    } catch (err) {
      console.warn('[markdown] lettura fallita', err);
      return;
    }
    if (this.known.has(path) && this.known.get(path) === content) return;
    this.known.set(path, content);
    for (const id of ids) {
      const version = this.options.workspace.bumpContentVersion(id);
      this.options.onExternalChange(id, {
        content: content ?? '',
        version,
        exists: content !== null,
      });
    }
  }

  reset(): void {
    this.known.clear();
    this.byPath = new Map();
    this.options.watch([]);
  }
}
