import type { Env } from '../env/shellEnv';

/** The subset of node-pty's IPty that Plancia uses (injectable for tests). */
export interface PtyProcess {
  readonly pid: number;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void };
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

export interface SpawnOptions {
  file: string;
  args: string[];
  cwd: string;
  env: Env;
  cols: number;
  rows: number;
}

export type SpawnFn = (options: SpawnOptions) => PtyProcess;

export interface PtyServiceOptions {
  spawn: SpawnFn;
  onData: (id: string, data: string, start: number) => void;
  onExit: (id: string, exitCode: number, signal: number | undefined) => void;
  /** Characters of output kept per terminal for replay. */
  bufferLimit?: number;
  /** Output is coalesced for this long before being forwarded. */
  flushDelayMs?: number;
}

interface Session {
  pty: PtyProcess | null;
  /** Tail of the output stream; `end` is its absolute end offset. */
  buffer: string;
  end: number;
  pending: string;
  pendingStart: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  exited: Promise<void>;
}

const DEFAULT_BUFFER_LIMIT = 512 * 1024;
const KILL_GRACE_MS = 1500;

/**
 * Owns the pseudo-terminals. Output history survives restarts of the same terminal id, so the
 * renderer keeps scrollback across "Riavvia"; it is dropped only on dispose.
 */
export class PtyService {
  private readonly sessions = new Map<string, Session>();
  private readonly bufferLimit: number;
  private readonly flushDelayMs: number;

  constructor(private readonly options: PtyServiceOptions) {
    this.bufferLimit = options.bufferLimit ?? DEFAULT_BUFFER_LIMIT;
    this.flushDelayMs = options.flushDelayMs ?? 8;
  }

  isRunning(id: string): boolean {
    return this.sessions.get(id)?.pty != null;
  }

  runningIds(): string[] {
    return [...this.sessions].filter(([, s]) => s.pty).map(([id]) => id);
  }

  start(id: string, spawnOptions: SpawnOptions): void {
    if (this.isRunning(id)) throw new Error(`Terminale già avviato: ${id}`);
    const pty = this.options.spawn(spawnOptions);
    const session = this.sessions.get(id) ?? {
      pty: null,
      buffer: '',
      end: 0,
      pending: '',
      pendingStart: 0,
      timer: undefined,
      exited: Promise.resolve(),
    };
    session.pty = pty;
    let markExited: () => void = () => undefined;
    session.exited = new Promise((r) => (markExited = r));
    this.sessions.set(id, session);

    pty.onData((data) => this.append(id, session, data));
    pty.onExit(({ exitCode, signal }) => {
      // A newer process may already own this id after a restart.
      if (session.pty !== pty) return markExited();
      this.flush(id, session);
      session.pty = null;
      markExited();
      this.options.onExit(id, exitCode, signal);
    });
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.pty?.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const pty = this.sessions.get(id)?.pty;
    if (!pty) return;
    try {
      pty.resize(cols, rows);
    } catch {
      // The process may be exiting; resizing it is pointless.
    }
  }

  snapshot(id: string): { data: string; end: number } | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    this.flush(id, session);
    return { data: session.buffer, end: session.end };
  }

  /** Sends SIGHUP (like closing a terminal window), then SIGKILL if it lingers. */
  async stop(id: string): Promise<void> {
    const session = this.sessions.get(id);
    const pty = session?.pty;
    if (!session || !pty) return;
    pty.kill();
    const timeout = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), KILL_GRACE_MS));
    if ((await Promise.race([session.exited, timeout])) === 'timeout') {
      try {
        pty.kill('SIGKILL');
      } catch {
        // already gone
      }
    }
  }

  /** Stops the process and forgets its output. */
  async dispose(id: string): Promise<void> {
    await this.stop(id);
    const session = this.sessions.get(id);
    if (session?.timer !== undefined) clearTimeout(session.timer);
    this.sessions.delete(id);
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.dispose(id)));
  }

  private append(id: string, session: Session, data: string): void {
    if (session.pending === '') session.pendingStart = session.end;
    session.pending += data;
    session.end += data.length;
    session.buffer += data;
    if (session.buffer.length > this.bufferLimit) {
      session.buffer = session.buffer.slice(session.buffer.length - this.bufferLimit);
    }
    session.timer ??= setTimeout(() => this.flush(id, session), this.flushDelayMs);
  }

  private flush(id: string, session: Session): void {
    if (session.timer !== undefined) clearTimeout(session.timer);
    session.timer = undefined;
    if (session.pending === '') return;
    const data = session.pending;
    session.pending = '';
    this.options.onData(id, data, session.pendingStart);
  }
}
