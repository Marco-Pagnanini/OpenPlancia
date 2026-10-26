import { z } from 'zod';
import { accessLabel } from '@shared/access';
import { architectureDocSchema, formatArchitectureForClaude } from '@shared/architecture';
import type { Panel } from '@shared/types';
import type { ArchitectureService } from '../architecture/ArchitectureService';
import type { MarkdownService } from '../files/MarkdownService';
import { deniedMessage, type AccessService } from './AccessService';
import type { ConnectionLog } from './ConnectionLog';

/** Result of an MCP tool: text for Claude plus structured data, or a readable error. */
export type ToolResult =
  { ok: true; text: string; data: Record<string, unknown> } | { ok: false; error: string };

export interface PanelToolsDeps {
  access: AccessService;
  markdown: MarkdownService;
  architecture: Pick<ArchitectureService, 'read' | 'write'>;
  log: ConnectionLog;
  panel(id: string): Panel | undefined;
}

const SCHEMA_HINT = 'Lo schema completo si ottiene con mcp__plancia__get_panel_schema.';

function failure(err: unknown): ToolResult {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

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
    if (panel.type === 'architecture') return this.readArchitecture(terminalId, panel);
    if (panel.type !== 'markdown') return failure(new Error(`Panel non leggibile: ${panelId}`));
    let doc;
    try {
      doc = await this.deps.markdown.read(panel.id);
    } catch (err) {
      return failure(err);
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
    if (panel.type === 'architecture') {
      if (mode === 'append') {
        return {
          ok: false,
          error: `mode "append" vale solo per i markdown: per un'architettura "content" è l'ArchitectureDoc completo. ${SCHEMA_HINT}`,
        };
      }
      return this.writeArchitecture(terminalId, panel, baseVersion, content);
    }
    if (panel.type !== 'markdown') return failure(new Error(`Panel non scrivibile: ${panelId}`));
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

  private async readArchitecture(terminalId: string, panel: Panel): Promise<ToolResult> {
    let state;
    try {
      state = await this.deps.architecture.read(panel.id);
    } catch (err) {
      return failure(err);
    }
    const json = formatArchitectureForClaude(state.doc);
    this.deps.log.record({
      terminalId,
      panelId: panel.id,
      kind: 'read',
      via: 'read_panel',
      version: state.version,
      payload: json,
    });
    return {
      ok: true,
      text: `${panel.title} · architettura (ArchitectureDoc) · versione ${state.version}\n\n${json}`,
      data: { panelId: panel.id, type: panel.type, version: state.version, content: state.doc },
    };
  }

  private async writeArchitecture(
    terminalId: string,
    panel: Panel,
    baseVersion: number,
    content: unknown,
  ): Promise<ToolResult> {
    const result = await this.deps.architecture.write(panel.id, content, baseVersion, terminalId);
    if (!result.ok) {
      if (result.code === 'conflict') {
        return {
          ok: false,
          error: `Conflitto di versione: il panel '${panel.title}' è alla versione ${result.state.version}, la scrittura partiva dalla ${baseVersion}. Rileggi con mcp__plancia__read_panel e riprova.`,
        };
      }
      return {
        ok: false,
        error:
          result.code === 'invalid'
            ? `ArchitectureDoc non valido, nulla è stato scritto:\n${result.message}\n${SCHEMA_HINT}`
            : result.message,
      };
    }
    this.deps.log.record({
      terminalId,
      panelId: panel.id,
      kind: 'write',
      via: 'write_panel',
      version: result.version,
      payload: formatArchitectureForClaude(result.doc),
    });
    return {
      ok: true,
      text: `Scritto '${panel.title}': versione ${baseVersion} → ${result.version} (${result.doc.nodes.length} nodi, ${result.doc.edges.length} relazioni). I nodi nuovi sono stati posizionati automaticamente.`,
      data: { panelId: panel.id, version: result.version },
    };
  }

  /** JSON Schema of a panel type's content (spec §7.3). */
  panelSchema(type: string): ToolResult {
    if (type !== 'architecture') {
      return {
        ok: false,
        error: `Schema disponibile solo per "architecture"; i markdown sono testo libero.`,
      };
    }
    const schema = z.toJSONSchema(architectureDocSchema, { io: 'input' });
    const rules =
      'Regole oltre allo schema: id dei nodi e delle relazioni unici; "from" e "to" devono essere id di nodi esistenti; "position" si può omettere (i nodi nuovi vengono posizionati automaticamente, quelli esistenti restano dove sono).';
    return {
      ok: true,
      text: `${JSON.stringify(schema)}\n\n${rules}`,
      data: { type, schema },
    };
  }
}
