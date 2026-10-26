import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolResult } from '../access/panelTools';

export interface PlanciaMcpDeps {
  listPanels(terminalId: string): ToolResult;
  readPanel(terminalId: string, panelId: string, path: string | undefined): Promise<ToolResult>;
  writePanel(
    terminalId: string,
    panelId: string,
    baseVersion: number,
    content: unknown,
    mode: 'replace' | 'append' | undefined,
    path: string | undefined,
  ): Promise<ToolResult>;
  panelSchema(type: string): ToolResult;
  onToolCall(terminalId: string, tool: string): void;
}

/** Tool names as Claude Code sees them; pre-approved in the per-terminal settings. */
export const PLANCIA_MCP_TOOLS = ['list_panels', 'read_panel', 'write_panel', 'get_panel_schema'];

function reply(result: ToolResult) {
  return result.ok
    ? {
        content: [{ type: 'text' as const, text: result.text }],
        structuredContent: result.data,
      }
    : { content: [{ type: 'text' as const, text: result.error }], isError: true };
}

/** A fresh MCP server per request (stateless Streamable HTTP), bound to one terminal. */
export function createPlanciaMcpServer(terminalId: string, deps: PlanciaMcpDeps): McpServer {
  const server = new McpServer({ name: 'plancia', version: '0.1.0' });

  server.registerTool(
    'list_panels',
    {
      title: 'Elenca i panel collegati',
      description:
        "Elenca i panel della lavagna OpenPlancia collegati a questa sessione: id, tipo, titolo, accesso (lettura/scrittura), versione, data dell'ultima modifica e file per i markdown.",
    },
    () => {
      deps.onToolCall(terminalId, 'list_panels');
      return reply(deps.listPanels(terminalId));
    },
  );

  server.registerTool(
    'read_panel',
    {
      title: 'Leggi un panel collegato',
      description:
        'Legge il contenuto di un panel collegato in lettura (freccia Panel → Terminale). Restituisce anche la versione, da passare a write_panel come baseVersion. Per un panel cartella senza "path" restituisce l\'elenco dei file .md; con "path" (relativo alla cartella) il contenuto di quel file.',
      inputSchema: {
        panelId: z.string().describe('Id del panel, es. "md-3f2a"'),
        path: z
          .string()
          .optional()
          .describe(
            'Solo per i panel cartella: file .md relativo alla cartella, es. "adr/0001.md"',
          ),
      },
    },
    async ({ panelId, path }) => {
      deps.onToolCall(terminalId, 'read_panel');
      return reply(await deps.readPanel(terminalId, panelId, path));
    },
  );

  server.registerTool(
    'write_panel',
    {
      title: 'Scrivi un panel collegato',
      description:
        'Scrive un panel collegato in scrittura (freccia Terminale → Panel). Per i markdown "content" è il testo completo (mode "replace", predefinito) o da aggiungere in fondo (mode "append"). Per le architetture "content" è l\'ArchitectureDoc completo (oggetto JSON, schema da get_panel_schema): viene validato e, se non è valido, nulla viene scritto. baseVersion è la versione letta: se il panel è cambiato nel frattempo la scrittura viene rifiutata.',
      inputSchema: {
        panelId: z.string().describe('Id del panel'),
        baseVersion: z.number().int().describe('Versione su cui si basa la modifica'),
        content: z
          .unknown()
          .describe('Testo per i markdown; ArchitectureDoc (oggetto JSON) per le architetture'),
        mode: z.enum(['replace', 'append']).optional(),
        path: z
          .string()
          .optional()
          .describe(
            'Solo per i panel cartella: file .md relativo alla cartella; per un file nuovo baseVersion è 0',
          ),
      },
    },
    async ({ panelId, baseVersion, content, mode, path }) => {
      deps.onToolCall(terminalId, 'write_panel');
      return reply(await deps.writePanel(terminalId, panelId, baseVersion, content, mode, path));
    },
  );

  server.registerTool(
    'get_panel_schema',
    {
      title: 'Schema del contenuto di un panel',
      description:
        'JSON Schema del contenuto di un tipo di panel. Per "architecture" descrive l\'ArchitectureDoc da passare a write_panel.',
      inputSchema: { type: z.literal('architecture').describe('Tipo di panel') },
    },
    ({ type }) => {
      deps.onToolCall(terminalId, 'get_panel_schema');
      return reply(deps.panelSchema(type));
    },
  );

  return server;
}
