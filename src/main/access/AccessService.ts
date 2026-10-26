import { isAbsolute, relative, resolve, sep } from 'node:path';
import { accessFor, connectedPanels, type Access, type ConnectedPanel } from '@shared/access';
import type { Connection, MarkdownPanel, Panel } from '@shared/types';
import { realpathAllowMissing } from '../files/resolveInWorkspace';

export interface AccessDeps {
  panels(): Panel[];
  connections(): Connection[];
  root(): string | null;
  /** Absolute real path of a markdown panel's file. */
  pathOf(panel: MarkdownPanel): Promise<string>;
  /** Folder panels whose files include `path` (absolute, real). */
  foldersAt?(path: string): string[];
}

/** Claude's own file tools that the arrows also govern (spec §7.5). */
export const FILE_WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

export function deniedMessage(title: string, access: Access, needed: 'read' | 'write'): string {
  if (needed === 'write') {
    return access.read
      ? `Accesso negato: il panel '${title}' è collegato a questo terminale in sola lettura. L'utente deve aggiungere una freccia Terminale → Panel per consentire la scrittura.`
      : `Accesso negato: il panel '${title}' non è collegato a questo terminale in scrittura. L'utente deve aggiungere una freccia Terminale → Panel per consentire la scrittura.`;
  }
  return `Accesso negato: il panel '${title}' non è collegato a questo terminale in lettura. L'utente deve aggiungere una freccia Panel → Terminale per consentire la lettura.`;
}

export const PLANCIA_DIR_DENIED =
  'Scrittura negata: i file in .plancia/ sono gestiti da OpenPlancia. Le architetture si modificano solo con mcp__plancia__write_panel, che le valida.';

export type WriteDecision =
  | { decision: 'none' }
  | { decision: 'allow'; path: string; panelIds: string[] }
  | { decision: 'deny'; reason: string };

/** Permissions computed from the arrows at the moment of each request (never cached). */
export class AccessService {
  constructor(private readonly deps: AccessDeps) {}

  access(terminalId: string, panelId: string): Access {
    return accessFor(terminalId, panelId, this.deps.connections());
  }

  connected(terminalId: string): ConnectedPanel[] {
    return connectedPanels(terminalId, this.deps.panels(), this.deps.connections());
  }

  /**
   * PreToolUse guard for Write/Edit/MultiEdit/NotebookEdit: a file shown in a markdown panel or
   * in a folder panel (also a new .md file there) can be changed only with a write arrow to one
   * of those panels; nothing inside .plancia/ can be changed this way.
   */
  async checkFileWrite(
    terminalId: string,
    toolName: string,
    toolInput: Record<string, unknown> | undefined,
    cwd: string | undefined,
  ): Promise<WriteDecision> {
    if (!FILE_WRITE_TOOLS.has(toolName)) return { decision: 'none' };
    const raw = toolInput?.['file_path'] ?? toolInput?.['notebook_path'];
    const root = this.deps.root();
    if (typeof raw !== 'string' || raw === '' || !root) return { decision: 'none' };

    const path = await realpathAllowMissing(isAbsolute(raw) ? raw : resolve(cwd ?? root, raw));
    const realRoot = await realpathAllowMissing(root);
    const rel = relative(realRoot, path);
    if (rel === '.plancia' || rel.startsWith(`.plancia${sep}`)) {
      return { decision: 'deny', reason: PLANCIA_DIR_DENIED };
    }

    const matches: Panel[] = [];
    const folders = new Set(this.deps.foldersAt?.(path) ?? []);
    for (const panel of this.deps.panels()) {
      if (folders.has(panel.id)) matches.push(panel);
      if (panel.type !== 'markdown') continue;
      try {
        if ((await this.deps.pathOf(panel)) === path) matches.push(panel);
      } catch {
        // a panel pointing outside the workspace never matches
      }
    }
    if (matches.length === 0) return { decision: 'none' };
    // The arrows add up: a write arrow to any panel showing the file is enough.
    if (!matches.some((p) => this.access(terminalId, p.id).write)) {
      const first = matches[0] as Panel;
      return {
        decision: 'deny',
        reason: deniedMessage(first.title, this.access(terminalId, first.id), 'write'),
      };
    }
    return { decision: 'allow', path, panelIds: matches.map((p) => p.id) };
  }
}
