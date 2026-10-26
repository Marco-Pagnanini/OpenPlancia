import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface PlanciaMcpDeps {
  /** Panels connected to this terminal (empty until connections arrive in M5). */
  listPanels(terminalId: string): unknown[];
  onToolCall(terminalId: string, tool: string): void;
}

/** Tool names as Claude Code sees them; pre-approved in the per-terminal settings. */
export const PLANCIA_MCP_TOOLS = ['list_panels', 'read_panel', 'write_panel', 'get_panel_schema'];

/** A fresh MCP server per request (stateless Streamable HTTP), bound to one terminal. */
export function createPlanciaMcpServer(terminalId: string, deps: PlanciaMcpDeps): McpServer {
  const server = new McpServer({ name: 'plancia', version: '0.1.0' });

  server.registerTool(
    'list_panels',
    {
      title: 'Elenca i panel collegati',
      description:
        'Elenca i panel della lavagna Plancia collegati a questa sessione, con id, tipo, titolo, accesso (lettura/scrittura) e versione.',
    },
    () => {
      deps.onToolCall(terminalId, 'list_panels');
      const panels = deps.listPanels(terminalId);
      return {
        content: [{ type: 'text', text: JSON.stringify({ panels }, null, 2) }],
        structuredContent: { panels },
      };
    },
  );

  return server;
}
