import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  diffArchitecture,
  emptyArchitectureDoc,
  parseArchitectureDoc,
  type ArchitectureDoc,
} from '@shared/architecture';
import type {
  ArchitectureChangedEvent,
  ArchitectureState,
  ArchitectureUndoResult,
  ArchitectureWriteResult,
} from '@shared/ipc';
import type { ArchitecturePanel, Panel } from '@shared/types';
import type { BoardChange } from '../board/BoardStore';
import { UNDO_DEPTH } from '../files/MarkdownService';
import { writeFileAtomic } from '../util/atomicWrite';
import { PLANCIA_DIR } from '../workspace/boardFile';
import { placeNewNodes } from './layout';

export interface ArchitectureWorkspace {
  root(): string | null;
  panels(): Panel[];
  bumpContentVersion(id: string): number;
}

export interface ArchitectureServiceOptions {
  workspace: ArchitectureWorkspace;
  /** Claude wrote the document, or a write was undone: the panel must show it. */
  onChange: (event: ArchitectureChangedEvent) => void;
}

/** Architecture files are app data, not project files: they are never this big. */
const MAX_FILE_BYTES = 2_000_000;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

interface UndoEntry {
  doc: ArchitectureDoc;
  author: string;
}

/**
 * Content of Architecture panels (spec §5, §8.3): one `ArchitectureDoc` per panel in
 * `.plancia/panels/<id>.arch.json`. Every write is validated with zod; Claude's writes keep the
 * position of existing nodes, place the new ones with dagre and can be undone.
 */
export class ArchitectureService {
  private readonly history = new Map<string, UndoEntry[]>();
  /** Architecture panels on the board after the last change. */
  private known = new Set<string>();

  constructor(private readonly options: ArchitectureServiceOptions) {}

  private panel(id: string): ArchitecturePanel {
    const panel = this.options.workspace.panels().find((p) => p.id === id);
    if (panel?.type !== 'architecture') throw new Error(`Panel architettura inesistente: ${id}`);
    return panel;
  }

  /** `.plancia/panels/<id>.arch.json`; the id comes from the board but is checked anyway. */
  pathOf(id: string): string {
    const root = this.options.workspace.root();
    if (!root) throw new Error('Nessuna cartella progetto aperta');
    if (!SAFE_ID.test(id)) throw new Error(`Id di panel non valido: ${id}`);
    return join(root, PLANCIA_DIR, 'panels', `${id}.arch.json`);
  }

  private async load(panel: ArchitecturePanel): Promise<ArchitectureDoc> {
    const path = this.pathOf(panel.id);
    let text: string;
    try {
      if ((await stat(path)).size > MAX_FILE_BYTES) throw new Error('File troppo grande');
      text = await readFile(path, 'utf8');
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        return emptyArchitectureDoc(panel.title);
      }
      throw err;
    }
    const parsed = parseArchitectureDoc(text);
    if (!parsed.ok) {
      throw new Error(`${PLANCIA_DIR}/panels/${panel.id}.arch.json non è valido:\n${parsed.error}`);
    }
    // Hand-written files may lack positions: show them laid out (saved on the next write).
    return placeNewNodes(parsed.doc);
  }

  private async save(id: string, doc: ArchitectureDoc): Promise<void> {
    await writeFileAtomic(this.pathOf(id), `${JSON.stringify(doc, null, 2)}\n`);
  }

  private canUndo(id: string): boolean {
    return (this.history.get(id)?.length ?? 0) > 0;
  }

  async read(id: string): Promise<ArchitectureState> {
    const panel = this.panel(id);
    return { doc: await this.load(panel), version: panel.version, canUndo: this.canUndo(id) };
  }

  /**
   * Replaces the document. `baseVersion` is the version the edit started from: if the panel
   * changed in the meantime the write is refused with the current state. With `author` (a
   * terminal id) the write comes from Claude: positions of known nodes are kept, new nodes are
   * placed automatically, the previous document is kept for undo and the panel is told.
   */
  async write(
    id: string,
    input: unknown,
    baseVersion: number,
    author?: string,
  ): Promise<ArchitectureWriteResult> {
    try {
      const panel = this.panel(id);
      const parsed = parseArchitectureDoc(input);
      if (!parsed.ok) return { ok: false, code: 'invalid', message: parsed.error };
      if (panel.version !== baseVersion) {
        return { ok: false, code: 'conflict', state: await this.read(id) };
      }
      const previous = await this.load(panel);
      let doc = parsed.doc;
      if (author) {
        const known = new Map(previous.nodes.map((n) => [n.id, n.position]));
        doc = {
          ...doc,
          nodes: doc.nodes.map((node) => {
            const position = known.get(node.id) ?? node.position;
            return position ? { ...node, position } : node;
          }),
        };
      }
      doc = placeNewNodes(doc);
      if (author) this.pushHistory(id, { doc: previous, author });
      await this.save(id, doc);
      const version = this.options.workspace.bumpContentVersion(id);
      if (author) {
        this.options.onChange({
          id,
          doc,
          version,
          canUndo: true,
          author,
          diff: diffArchitecture(previous, doc),
        });
      }
      return { ok: true, version, doc };
    } catch (err) {
      return {
        ok: false,
        code: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Restores the document before Claude's last write. */
  async undo(id: string): Promise<ArchitectureUndoResult> {
    try {
      const panel = this.panel(id);
      const entry = this.history.get(id)?.pop();
      if (!entry) return { ok: false, message: 'Niente da annullare' };
      const current = await this.load(panel);
      await this.save(id, entry.doc);
      const version = this.options.workspace.bumpContentVersion(id);
      this.options.onChange({
        id,
        doc: entry.doc,
        version,
        canUndo: this.canUndo(id),
        undone: true,
        diff: diffArchitecture(current, entry.doc),
      });
      return { ok: true, version };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  private pushHistory(id: string, entry: UndoEntry): void {
    const stack = this.history.get(id) ?? [];
    stack.push(entry);
    if (stack.length > UNDO_DEPTH) stack.splice(0, stack.length - UNDO_DEPTH);
    this.history.set(id, stack);
  }

  /** The workspace was opened: remember which panels are architectures, touch nothing. */
  sync(panels: Panel[]): void {
    this.known = new Set(panels.filter((p) => p.type === 'architecture').map((p) => p.id));
  }

  /**
   * Keeps the files in step with the board: a new panel gets an empty document (replacing any
   * leftover with the same id), a duplicate gets a copy, a deleted panel loses its file.
   */
  async boardChanged(change: BoardChange, panels: Panel[]): Promise<void> {
    const before = this.known;
    this.sync(panels);
    const added = panels.filter((p) => p.type === 'architecture' && !before.has(p.id));
    for (const panel of added) {
      try {
        const source =
          change.type === 'duplicatePanel' && before.has(change.id)
            ? await this.load(this.panel(change.id))
            : null;
        await this.save(panel.id, source ?? emptyArchitectureDoc(panel.title));
      } catch (err) {
        console.warn('[architecture] creazione del documento fallita', err);
      }
    }
    for (const id of before) {
      if (this.known.has(id)) continue;
      this.history.delete(id);
      try {
        await rm(this.pathOf(id), { force: true });
      } catch (err) {
        console.warn('[architecture] eliminazione del documento fallita', err);
      }
    }
  }

  reset(): void {
    this.history.clear();
    this.known = new Set();
  }
}
