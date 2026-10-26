import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export interface LocalServerOptions {
  onHook: (terminalId: string, body: unknown) => Record<string, unknown> | null;
  createMcpServer: (terminalId: string) => McpServer;
}

const MAX_BODY = 1024 * 1024;
const LOOPBACK = new Set(['127.0.0.1', '::ffff:127.0.0.1', '::1']);

class HttpError extends Error {
  constructor(readonly status: number) {
    super(String(status));
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * HTTP server on 127.0.0.1 for Claude Code hooks and the "plancia" MCP server.
 * Every terminal gets a random 32-byte token carried in the URL path:
 *   /hooks/:terminalId/:token   /mcp/:terminalId/:token
 */
export class LocalServer {
  private server: Server | null = null;
  private readonly tokens = new Map<string, string>();

  constructor(private readonly options: LocalServerOptions) {}

  get port(): number {
    const address = this.server?.address() as AddressInfo | null | undefined;
    if (!address) throw new Error('Server locale non avviato');
    return address.port;
  }

  async start(port = 0): Promise<number> {
    if (this.server) return this.port;
    const server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve());
    });
    this.server = server;
    return this.port;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** New token for a terminal; any previous one stops working. */
  issueToken(terminalId: string): string {
    const token = randomBytes(32).toString('hex');
    this.tokens.set(terminalId, token);
    return token;
  }

  revoke(terminalId: string): void {
    this.tokens.delete(terminalId);
  }

  url(kind: 'hooks' | 'mcp', terminalId: string): string {
    const token = this.tokens.get(terminalId);
    if (!token) throw new Error(`Nessun token per ${terminalId}`);
    return `http://127.0.0.1:${this.port}/${kind}/${encodeURIComponent(terminalId)}/${token}`;
  }

  private authorized(terminalId: string, token: string): boolean {
    const expected = this.tokens.get(terminalId);
    if (!expected) return false;
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      // Loopback only, and never a browser page (DNS rebinding, CSRF).
      if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) throw new HttpError(403);
      const host = req.headers.host ?? '';
      if (host !== `127.0.0.1:${this.port}` && host !== `localhost:${this.port}`) {
        throw new HttpError(403);
      }
      if (req.headers.origin !== undefined) throw new HttpError(403);

      const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      const [, kind, rawId, token, ...rest] = path.split('/');
      const terminalId = decodeURIComponent(rawId ?? '');
      if ((kind !== 'hooks' && kind !== 'mcp') || rest.length > 0 || !token) {
        throw new HttpError(404);
      }
      // Unknown terminal and wrong token look the same from outside.
      if (!this.authorized(terminalId, token)) throw new HttpError(404);

      if (kind === 'hooks') await this.handleHook(terminalId, req, res);
      else await this.handleMcp(terminalId, req, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error('[server] errore', err);
      if (!res.headersSent) res.writeHead(status).end();
    }
  }

  private async handleHook(terminalId: string, req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'POST') throw new HttpError(405);
    const body = parseJson(await readBody(req));
    let reply: Record<string, unknown> | null = null;
    try {
      reply = this.options.onHook(terminalId, body);
    } catch (err) {
      // A Plancia bug must never block Claude: answer 2xx with no decision.
      console.error('[hooks] errore nella gestione dell’evento', err);
    }
    if (reply) {
      const json = JSON.stringify(reply);
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(json),
      });
      res.end(json);
    } else {
      res.writeHead(200, { 'content-length': 0 }).end();
    }
  }

  private async handleMcp(terminalId: string, req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'POST') {
      // Stateless server: no SSE stream (GET) and no sessions to delete.
      const json = JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed' },
        id: null,
      });
      res.writeHead(405, { 'content-type': 'application/json', allow: 'POST' }).end(json);
      return;
    }
    const body = parseJson(await readBody(req));
    const server = this.options.createMcpServer(terminalId);
    // No sessionIdGenerator: stateless mode, one server and transport per request.
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }
}
