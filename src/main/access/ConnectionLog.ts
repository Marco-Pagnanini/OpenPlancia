import { wireKey } from '@shared/access';
import type { ConnectionUse } from '@shared/ipc';

const PER_WIRE = 30;
export const PREVIEW_CHARS = 1200;

/** Reads and writes through each arrow, for the inspector and the wire animation (spec §6, §9). */
export class ConnectionLog {
  private readonly uses = new Map<string, ConnectionUse[]>();

  constructor(
    private readonly onUse: (use: ConnectionUse) => void,
    private readonly now: () => Date = () => new Date(),
  ) {}

  record(
    entry: Omit<ConnectionUse, 'at' | 'chars' | 'preview'> & { payload: string },
  ): ConnectionUse {
    const { payload, ...rest } = entry;
    const use: ConnectionUse = {
      ...rest,
      at: this.now().toISOString(),
      chars: payload.length,
      preview: payload.slice(0, PREVIEW_CHARS),
    };
    const key = wireKey(use.terminalId, use.panelId);
    const list = this.uses.get(key) ?? [];
    list.push(use);
    if (list.length > PER_WIRE) list.splice(0, list.length - PER_WIRE);
    this.uses.set(key, list);
    this.onUse(use);
    return use;
  }

  list(terminalId: string, panelId: string): ConnectionUse[] {
    return [...(this.uses.get(wireKey(terminalId, panelId)) ?? [])];
  }

  reset(): void {
    this.uses.clear();
  }
}
