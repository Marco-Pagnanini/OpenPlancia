import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ActivityEvent, ActivityTool } from '@shared/activity';
import type { NewActivity } from '../server/hooks';

export interface ActivityLogOptions {
  /** Folder for the current workspace's logs, or null when none is open. */
  dir: () => string | null;
  onEvent: (event: ActivityEvent) => void;
  /** Entries kept per terminal. */
  limit?: number;
  now?: () => Date;
  newId?: () => string;
}

const DEFAULT_LIMIT = 500;

function isActivity(value: unknown): value is ActivityEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ActivityEvent).id === 'string' &&
    typeof (value as ActivityEvent).title === 'string'
  );
}

/**
 * Per-terminal timeline, in memory with a JSONL copy on disk (one line per add or update; the
 * last line for an id wins). Disk errors are logged, never thrown at the hook path.
 */
export class ActivityLog {
  private readonly cache = new Map<string, ActivityEvent[]>();
  private writes: Promise<void> = Promise.resolve();
  private readonly limit: number;
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(private readonly options: ActivityLogOptions) {
    this.limit = options.limit ?? DEFAULT_LIMIT;
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? randomUUID;
  }

  append(terminalId: string, activity: NewActivity): ActivityEvent {
    const event: ActivityEvent = {
      id: this.newId(),
      terminalId,
      at: this.now().toISOString(),
      ...activity,
    };
    const list = this.cache.get(terminalId) ?? [];
    list.push(event);
    if (list.length > this.limit) list.splice(0, list.length - this.limit);
    this.cache.set(terminalId, list);
    this.persist(event);
    this.options.onEvent(event);
    return event;
  }

  updateTool(
    terminalId: string,
    toolUseId: string,
    patch: Partial<ActivityTool>,
  ): ActivityEvent | null {
    const list = this.cache.get(terminalId);
    const index = list?.findLastIndex((e) => e.tool?.useId === toolUseId) ?? -1;
    if (!list || index < 0) return null;
    const current = list[index] as ActivityEvent & { tool: ActivityTool };
    const event: ActivityEvent = { ...current, tool: { ...current.tool, ...patch } };
    list[index] = event;
    this.persist(event);
    this.options.onEvent(event);
    return event;
  }

  settleRunning(terminalId: string): void {
    for (const event of this.cache.get(terminalId) ?? []) {
      if (event.tool?.state === 'running' && event.tool.useId) {
        this.updateTool(terminalId, event.tool.useId, { state: 'cancelled' });
      }
    }
  }

  async list(terminalId: string): Promise<ActivityEvent[]> {
    const cached = this.cache.get(terminalId);
    if (cached) return [...cached];
    const loaded = await this.load(terminalId);
    // Entries may have arrived while reading.
    const merged = [...loaded, ...(this.cache.get(terminalId) ?? [])].slice(-this.limit);
    this.cache.set(terminalId, merged);
    return [...merged];
  }

  async remove(terminalId: string): Promise<void> {
    this.cache.delete(terminalId);
    await this.flush();
    const file = this.file(terminalId);
    if (file) await rm(file, { force: true });
  }

  /** Forgets cached entries (e.g. when another workspace opens). */
  reset(): void {
    this.cache.clear();
  }

  private file(terminalId: string): string | null {
    const dir = this.options.dir();
    return dir ? join(dir, `${terminalId}.jsonl`) : null;
  }

  private persist(event: ActivityEvent): void {
    const file = this.file(event.terminalId);
    if (!file) return;
    const line = `${JSON.stringify(event)}\n`;
    // One write at a time: an update must never land before the entry it updates.
    this.writes = this.writes
      .then(() => mkdir(join(file, '..'), { recursive: true }))
      .then(() => appendFile(file, line, 'utf8'))
      .catch((err: unknown) => console.warn('[activity] scrittura fallita', err));
  }

  /** Resolves when everything appended so far is on disk. */
  flush(): Promise<void> {
    return this.writes;
  }

  private async load(terminalId: string): Promise<ActivityEvent[]> {
    const file = this.file(terminalId);
    if (!file) return [];
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      return [];
    }
    const byId = new Map<string, ActivityEvent>();
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const value: unknown = JSON.parse(line);
        if (isActivity(value)) {
          byId.delete(value.id); // keep insertion order of the latest version
          byId.set(value.id, value);
        }
      } catch {
        // skip a torn line
      }
    }
    return [...byId.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-this.limit);
  }
}
