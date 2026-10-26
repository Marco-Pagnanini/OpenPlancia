import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlanciaMcpServer } from '../src/main/server/mcp';
import { LocalServer } from '../src/main/server/LocalServer';

let server: LocalServer;
let hooks: [string, unknown][];
let toolCalls: string[];
let reply: Record<string, unknown> | null;

beforeEach(async () => {
  hooks = [];
  toolCalls = [];
  reply = null;
  server = new LocalServer({
    onHook: (id, body) => {
      hooks.push([id, body]);
      return reply;
    },
    createMcpServer: (id) =>
      createPlanciaMcpServer(id, {
        listPanels: () => ({ ok: true, text: 'Nessun panel', data: { panels: [] } }),
        readPanel: async (_t, panelId) => ({ ok: false, error: `Accesso negato: ${panelId}` }),
        writePanel: async () => ({ ok: true, text: 'Scritto', data: { version: 2 } }),
        panelSchema: (type) => ({ ok: true, text: `schema ${type}`, data: { type } }),
        onToolCall: (terminalId, tool) => toolCalls.push(`${terminalId}:${tool}`),
      }),
  });
  await server.start();
});
afterEach(() => server.stop());

function post(
  url: string,
  body: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { method: 'POST', headers: { 'content-type': 'application/json', ...headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString() }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

describe('LocalServer', () => {
  it('listens on loopback with a random port and per-terminal tokens', () => {
    const token = server.issueToken('term-1');
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(server.url('hooks', 'term-1')).toBe(
      `http://127.0.0.1:${server.port}/hooks/term-1/${token}`,
    );
    expect(() => server.url('mcp', 'other')).toThrow();
  });

  it('delivers hook bodies and answers 200 with an empty body by default', async () => {
    server.issueToken('term-1');
    const res = await post(server.url('hooks', 'term-1'), '{"hook_event_name":"Stop"}');
    expect(res).toEqual({ status: 200, text: '' });
    expect(hooks).toEqual([['term-1', { hook_event_name: 'Stop' }]]);
  });

  it('returns JSON when the handler has something to say', async () => {
    server.issueToken('term-1');
    reply = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'x' } };
    const res = await post(server.url('hooks', 'term-1'), '{}');
    expect(JSON.parse(res.text)).toEqual(reply);
  });

  it('rejects wrong or revoked tokens, other hosts and browser origins', async () => {
    const url = (server.issueToken('term-1'), server.url('hooks', 'term-1'));
    const wrong = url.replace(/[0-9a-f]{64}$/, '0'.repeat(64));
    expect((await post(wrong, '{}')).status).toBe(404);
    expect((await post(url, '{}', { host: 'evil.example:80' })).status).toBe(403);
    expect((await post(url, '{}', { origin: 'https://evil.example' })).status).toBe(403);
    server.issueToken('term-1'); // rotation invalidates the old URL
    expect((await post(url, '{}')).status).toBe(404);
    server.revoke('term-1');
    expect(hooks).toEqual([]);
  });

  it('never fails a hook because of a bad body or a handler bug', async () => {
    server.issueToken('term-1');
    expect((await post(server.url('hooks', 'term-1'), 'not json')).status).toBe(200);
    server = Object.assign(server, {});
    const broken = new LocalServer({
      onHook: () => {
        throw new Error('bug');
      },
      createMcpServer: () => {
        throw new Error('unused');
      },
    });
    await broken.start();
    broken.issueToken('t');
    expect((await post(broken.url('hooks', 't'), '{}')).status).toBe(200);
    await broken.stop();
  });

  it('serves the plancia MCP server bound to the terminal in the URL', async () => {
    server.issueToken('term-1');
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(server.url('mcp', 'term-1'))));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      'list_panels',
      'read_panel',
      'write_panel',
      'get_panel_schema',
    ]);
    const result = await client.callTool({ name: 'list_panels', arguments: {} });
    expect(result.structuredContent).toEqual({ panels: [] });
    const denied = await client.callTool({ name: 'read_panel', arguments: { panelId: 'md-1' } });
    expect(denied).toMatchObject({ isError: true, content: [{ text: 'Accesso negato: md-1' }] });
    const written = await client.callTool({
      name: 'write_panel',
      arguments: { panelId: 'md-1', baseVersion: 1, content: 'x' },
    });
    expect(written.structuredContent).toEqual({ version: 2 });
    const schema = await client.callTool({
      name: 'get_panel_schema',
      arguments: { type: 'architecture' },
    });
    expect(schema.structuredContent).toEqual({ type: 'architecture' });
    expect(toolCalls).toEqual([
      'term-1:list_panels',
      'term-1:read_panel',
      'term-1:write_panel',
      'term-1:get_panel_schema',
    ]);
    await client.close();
  });
});

describe('plancia-hook.cjs', () => {
  const script = join(import.meta.dirname, '../resources/plancia-hook.cjs');

  function run(
    url: string,
    input: string,
    socket?: string,
  ): Promise<{ code: number | null; out: string }> {
    // The test may itself run inside a Claude session: never leak its inbox into the bridge.
    const env = { ...process.env };
    delete env['CLAUDE_CODE_MESSAGING_SOCKET'];
    if (socket) env['CLAUDE_CODE_MESSAGING_SOCKET'] = socket;
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [script, url], { env });
      let out = '';
      child.stdout.on('data', (c: Buffer) => (out += c.toString()));
      child.on('close', (code) => resolve({ code, out }));
      child.stdin.end(input);
    });
  }

  it('forwards stdin to the server and prints the reply', async () => {
    server.issueToken('term-1');
    reply = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'ciao' } };
    const res = await run(server.url('hooks', 'term-1'), '{"hook_event_name":"SessionStart"}');
    expect(res.code).toBe(0);
    expect(JSON.parse(res.out)).toEqual(reply);
    expect(hooks).toEqual([['term-1', { hook_event_name: 'SessionStart' }]]);
  });

  it("adds the session's inbox address, so replies between agents can be told apart", async () => {
    server.issueToken('term-1');
    await run(server.url('hooks', 'term-1'), '{"hook_event_name":"SessionStart"}', '/tmp/s.sock');
    expect(hooks).toEqual([
      ['term-1', { hook_event_name: 'SessionStart', plancia_messaging_socket: '/tmp/s.sock' }],
    ]);
  });

  it('exits 0 silently when OpenPlancia is not reachable', async () => {
    const res = await run('http://127.0.0.1:9/hooks/x/y', '{}');
    expect(res).toEqual({ code: 0, out: '' });
  });
});
