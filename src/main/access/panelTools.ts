import { accessLabel } from '@shared/access';
import type { Panel } from '@shared/types';
import type { MarkdownService } from '../files/MarkdownService';
import { deniedMessage, type AccessService } from './AccessService';
import type { ConnectionLog } from './ConnectionLog';

/** Result of an MCP tool: text for Claude plus structured data, or a readable error. */
export type ToolResult =
  { ok: true; text: string; data: Record<string, unknown> } | { ok: false; error: string };

export interface PanelToolsDeps {
  access: AccessService;
  markdown: MarkdownService;
  log: ConnectionLog;
  panel(id: string): Panel | undefined;
}

const NOT_YET =
  'I panel Architettura saranno leggibili e scrivibili da Claude con la prossima versione di OpenPlancia.';

/** Implementation of the plancia MCP tools (spec §7.3). Every call checks the arrows anew. */
export class PanelTools {
  constructor(private readonly deps: PanelToolsDeps) {}

  listPanels(terminalId: string): ToolResult {
    const panels = this.deps.access.connected(terminalId).map(({ panel, access }) => ({
      id: panel.id,
      type: panel.type,
      title: panel.title,
      access: { ...access, label: accessLabel(access) },
      version: panel.version,
      updatedAt: panel.updatedAt,
      ...(panel.type === 'markdown' ? { filePath: panel.filePath } : {}),
    }));
    const text =
      panels.length === 0
        ? "Nessun panel è collegato a questa sessione. L'utente collega i panel con le frecce sulla lavagna."
        : JSON.stringify({ panels }, null, 2);
    return { ok: true, text, data: { panels } };
  }

  private linked(terminalId: string, panelId: string, needed: 'read' | 'write') {
    const panel = this.deps.panel(panelId);
    if (!panel || (panel.type !== 'markdown' && panel.type !== 'architecture')) {
      return {
        error: `Panel inesistente: ${panelId}. Usa mcp__plancia__list_panels per vedere quelli collegati.`,
      };
    }
    const access = this.deps.access.access(terminalId, panelId);
    if (!access[needed]) return { error: deniedMessage(panel.title, access, needed) };
    return { panel };
  }

  async readPanel(terminalId: string, panelId: string): Promise<ToolResult> {
    const found = this.linked(terminalId, panelId, 'read');
    if ('error' in found) return { ok: false, error: found.error };
    const { panel } = found;
    if (panel.type !== 'markdown') return { ok: false, error: NOT_YET };
    let doc;
    try {
      doc = await this.deps.markdown.read(panel.id);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    this.deps.log.record({
      terminalId,
      panelId,
      kind: 'read',
      via: 'read_panel',
      version: doc.version,
      payload: doc.content,
    });
    const header = `${panel.title} · file ${panel.filePath} · versione ${doc.version}${doc.exists ? '' : ' · il file non esiste ancora'}`;
    return {
      ok: true,
      text: `${header}\n\n${doc.content}`,
      data: {
        panelId,
        type: panel.type,
        version: doc.version,
        exists: doc.exists,
        content: doc.content,
      },
    };
  }

  async writePanel(
    terminalId: string,
    panelId: string,
    baseVersion: number,
    content: unknown,
    mode: 'replace' | 'append' = 'replace',
  ): Promise<ToolResult> {
    const found = this.linked(terminalId, panelId, 'write');
    if ('error' in found) return { ok: false, error: found.error };
    const { panel } = found;
    if (panel.type !== 'markdown') return { ok: false, error: NOT_YET };
    if (typeof content !== 'string') {
      return { ok: false, error: `Per un panel markdown "content" deve essere testo (string).` };
    }
    let next = content;
    if (mode === 'append') {
      const current = await this.deps.markdown.read(panel.id);
      const glue = current.content === '' || current.content.endsWith('\n') ? '' : '\n';
      next = current.content + glue + content;
    }
    const result = await this.deps.markdown.write(panel.id, next, baseVersion, terminalId);
    if (!result.ok && result.code === 'conflict') {
      return {
        ok: false,
        error: `Conflitto di versione: il panel '${panel.title}' è alla versione ${result.doc.version}, la scrittura partiva dalla ${baseVersion}. Rileggi con mcp__plancia__read_panel e riprova.`,
      };
    }
    if (!result.ok)
      return {
        ok: false,
        error: result.code === 'error' ? result.message : 'Scrittura non riuscita',
      };
    this.deps.log.record({
      terminalId,
      panelId,
      kind: 'write',
      via: 'write_panel',
      version: result.version,
      payload: next,
    });
    return {
      ok: true,
      text: `Scritto '${panel.title}' (${panel.filePath}): versione ${baseVersion} → ${result.version}.`,
      data: { panelId, version: result.version },
    };
  }
}
