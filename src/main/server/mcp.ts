import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolResult } from '../access/panelTools';

export interface PlanciaMcpDeps {
  listPanels(terminalId: string): ToolResult;
  readPanel(terminalId: string, panelId: string): Promise<ToolResult>;
  writePanel(
    terminalId: string,
    panelId: string,
    baseVersion: number,
    content: unknown,
    mode: 'replace' | 'append' | undefined,
  ): Promise<ToolResult>;
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
        "Elenca i panel della lavagna Plancia collegati a questa sessione: id, tipo, titolo, accesso (lettura/scrittura), versione, data dell'ultima modifica e file per i markdown.",
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
        'Legge il contenuto di un panel collegato in lettura (freccia Panel → Terminale). Restituisce anche la versione, da passare a write_panel come baseVersion.',
      inputSchema: { panelId: z.string().describe('Id del panel, es. "md-3f2a"') },
    },
    async ({ panelId }) => {
      deps.onToolCall(terminalId, 'read_panel');
      return reply(await deps.readPanel(terminalId, panelId));
    },
  );

  server.registerTool(
    'write_panel',
    {
      title: 'Scrivi un panel collegato',
      description:
        'Scrive un panel collegato in scrittura (freccia Terminale → Panel). Per i markdown "content" è il testo completo (mode "replace", predefinito) o da aggiungere in fondo (mode "append"). baseVersion è la versione letta: se il panel è cambiato nel frattempo la scrittura viene rifiutata.',
      inputSchema: {
        panelId: z.string().describe('Id del panel'),
        baseVersion: z.number().int().describe('Versione su cui si basa la modifica'),
        content: z.unknown().describe('Testo per i markdown'),
        mode: z.enum(['replace', 'append']).optional(),
      },
    },
    async ({ panelId, baseVersion, content, mode }) => {
      deps.onToolCall(terminalId, 'write_panel');
      return reply(await deps.writePanel(terminalId, panelId, baseVersion, content, mode));
    },
  );

  return server;
}
