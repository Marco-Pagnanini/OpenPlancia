import { mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileWatcher, type FileEvent } from '../src/main/files/FileWatcher';

let dir: string;
let watcher: FileWatcher | null = null;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'plancia-watch-')));
});
afterEach(async () => {
  await watcher?.close();
  watcher = null;
  await rm(dir, { recursive: true, force: true });
});

const ready = () => new Promise((r) => setTimeout(r, 300));

describe('FileWatcher', () => {
  it('reports edits, atomic replacements and deletions of watched files only', async () => {
    const watched = join(dir, 'AGENTS.md');
    const other = join(dir, 'altro.md');
    await writeFile(watched, 'a');
    await writeFile(other, 'a');
    const events: [string, FileEvent][] = [];
    watcher = new FileWatcher((path, event) => events.push([path, event]));
    watcher.setPaths([watched]);
    await ready();

    await writeFile(other, 'b');
    await writeFile(watched, 'b');
    await vi.waitFor(() => expect(events).toContainEqual([watched, 'change']), { timeout: 3000 });

    // Editors and Plancia save via temp file + rename.
    events.length = 0;
    await writeFile(`${watched}.tmp`, 'c');
    await rename(`${watched}.tmp`, watched);
    await vi.waitFor(() => expect(events.some(([p]) => p === watched)).toBe(true), {
      timeout: 3000,
    });

    events.length = 0;
    await rm(watched);
    await vi.waitFor(() => expect(events).toContainEqual([watched, 'unlink']), { timeout: 3000 });
    expect(events.some(([p]) => p === other)).toBe(false);
  });

  it('stops reporting files removed from the set', async () => {
    const file = join(dir, 'A.md');
    await writeFile(file, 'a');
    const events: string[] = [];
    watcher = new FileWatcher((path) => events.push(path));
    watcher.setPaths([file]);
    await ready();
    watcher.setPaths([]);
    await writeFile(file, 'b');
    await new Promise((r) => setTimeout(r, 400));
    expect(events).toEqual([]);
  });
});
