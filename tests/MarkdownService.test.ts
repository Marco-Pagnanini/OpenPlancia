import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MarkdownDoc } from '@shared/ipc';
import type { MarkdownPanel, Panel } from '@shared/types';
import { MarkdownService } from '../src/main/files/MarkdownService';

let dir: string;
let root: string;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'plancia-md-')));
  root = join(dir, 'repo');
  await mkdir(root);
  await writeFile(join(root, 'AGENTS.md'), '# Regole\n- usa sempre pnpm\n');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

function panel(id: string, filePath: string, version = 1): MarkdownPanel {
  return {
    id,
    type: 'markdown',
    filePath,
    title: filePath,
    position: { x: 0, y: 0 },
    size: { width: 480, height: 560 },
    version,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function setup(initial: MarkdownPanel[]) {
  let panels: Panel[] = initial;
  const watched: string[][] = [];
  const external: [string, MarkdownDoc][] = [];
  const service = new MarkdownService({
    workspace: {
      root: () => root,
      panels: () => panels,
      bumpContentVersion: (id) => {
        let version = 0;
        panels = panels.map((p) =>
          p.id === id ? { ...p, version: (version = p.version + 1) } : p,
        );
        return version;
      },
    },
    watch: (paths) => watched.push(paths),
    onExternalChange: (id, change) => external.push([id, change.doc]),
  });
  const version = (id: string) => panels.find((p) => p.id === id)!.version;
  return { service, watched, external, version };
}

describe('MarkdownService', () => {
  it('reads the file behind a panel', async () => {
    const t = setup([panel('md-1', 'AGENTS.md')]);
    await expect(t.service.read('md-1')).resolves.toEqual({
      content: '# Regole\n- usa sempre pnpm\n',
      version: 1,
      exists: true,
      canUndo: false,
    });
  });

  it('reports a missing file and creates it on first save', async () => {
    const t = setup([panel('md-1', 'docs/NUOVO.md')]);
    await expect(t.service.read('md-1')).resolves.toMatchObject({ exists: false, content: '' });
    await expect(t.service.write('md-1', '# Nuovo\n', 1)).resolves.toEqual({
      ok: true,
      version: 2,
    });
    expect(await readFile(join(root, 'docs/NUOVO.md'), 'utf8')).toBe('# Nuovo\n');
  });

  it('saves with version +1 and refuses stale writes', async () => {
    const t = setup([panel('md-1', 'AGENTS.md')]);
    await t.service.sync();
    await t.service.read('md-1');
    await expect(t.service.write('md-1', 'v2', 1)).resolves.toEqual({ ok: true, version: 2 });
    const stale = await t.service.write('md-1', 'vecchia base', 1);
    expect(stale).toEqual({
      ok: false,
      code: 'conflict',
      doc: { content: 'v2', version: 2, exists: true, canUndo: false },
    });
    expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toBe('v2');
  });

  it('ignores the watcher echo of its own writes', async () => {
    const t = setup([panel('md-1', 'AGENTS.md')]);
    await t.service.sync();
    await t.service.write('md-1', 'scritto dal panel', 1);
    await t.service.fileChanged(join(root, 'AGENTS.md'));
    expect(t.external).toEqual([]);
    expect(t.version('md-1')).toBe(2);
  });

  it('turns outside edits into a new version for every panel on that file', async () => {
    const t = setup([panel('md-1', 'AGENTS.md'), panel('md-2', './AGENTS.md', 5)]);
    await t.service.sync();
    await t.service.read('md-1');
    await writeFile(join(root, 'AGENTS.md'), '# Regole\n- usa sempre bun\n');
    await t.service.fileChanged(join(root, 'AGENTS.md'));
    expect(t.external).toEqual([
      [
        'md-1',
        { content: '# Regole\n- usa sempre bun\n', version: 2, exists: true, canUndo: false },
      ],
      [
        'md-2',
        { content: '# Regole\n- usa sempre bun\n', version: 6, exists: true, canUndo: false },
      ],
    ]);
  });

  it('notices a deleted file', async () => {
    const t = setup([panel('md-1', 'AGENTS.md')]);
    await t.service.sync();
    await t.service.read('md-1');
    await rm(join(root, 'AGENTS.md'));
    await t.service.fileChanged(join(root, 'AGENTS.md'));
    expect(t.external).toEqual([
      ['md-1', { content: '', version: 2, exists: false, canUndo: false }],
    ]);
  });

  it('watches only files inside the workspace', async () => {
    await writeFile(join(dir, 'fuori.md'), 'segreto');
    await symlink(join(dir, 'fuori.md'), join(root, 'link.md'));
    const t = setup([
      panel('md-1', 'AGENTS.md'),
      panel('md-2', '../fuori.md'),
      panel('md-3', 'link.md'),
    ]);
    await t.service.sync();
    expect(t.watched.at(-1)).toEqual([join(root, 'AGENTS.md')]);
    await expect(t.service.read('md-2')).rejects.toThrow(/fuori dalla cartella/);
    await expect(t.service.read('md-3')).rejects.toThrow(/fuori dalla cartella/);
    expect(await t.service.write('md-2', 'x', 1)).toMatchObject({ ok: false, code: 'error' });
    expect(await readFile(join(dir, 'fuori.md'), 'utf8')).toBe('segreto');
  });

  it('stops watching on reset', async () => {
    const t = setup([panel('md-1', 'AGENTS.md')]);
    await t.service.sync();
    t.service.reset();
    expect(t.watched.at(-1)).toEqual([]);
  });
});
