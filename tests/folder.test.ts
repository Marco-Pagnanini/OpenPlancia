import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ConnectionUse,
  FolderFileChangedEvent,
  FolderIndexEvent,
  MarkdownDoc,
} from '@shared/ipc';
import type { Connection, Panel } from '@shared/types';
import { AccessService } from '../src/main/access/AccessService';
import { ConnectionLog } from '../src/main/access/ConnectionLog';
import { PanelTools } from '../src/main/access/panelTools';
import { ArchitectureService } from '../src/main/architecture/ArchitectureService';
import { describeChanges, manifestState, type ManifestEntry } from '../src/main/claude/manifest';
import {
  fileTitle,
  FOLDER_INLINE,
  FolderService,
  isFolderFile,
} from '../src/main/files/FolderService';
import { MarkdownService, type MarkdownChange } from '../src/main/files/MarkdownService';

let dir: string;
let root: string;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'plancia-folder-')));
  root = join(dir, 'repo');
  const docs = join(root, 'docs');
  await mkdir(join(docs, 'adr', 'old'), { recursive: true });
  await mkdir(join(docs, 'node_modules'), { recursive: true });
  await mkdir(join(docs, '.draft'), { recursive: true });
  await mkdir(join(docs, 'a', 'b', 'c', 'd', 'e'), { recursive: true });
  await writeFile(join(docs, 'AGENTS.md'), '# Regole\n- usa sempre pnpm\n');
  await writeFile(join(docs, 'PLAN.md'), 'senza titolo\n');
  await writeFile(join(docs, 'notes.txt'), 'non markdown');
  await writeFile(join(docs, 'adr', '0001-db.md'), '# Scelta del database\nPostgres.\n');
  await writeFile(join(docs, 'adr', 'old', 'legacy.mdx'), '# Vecchio\n');
  await writeFile(join(docs, 'node_modules', 'pkg.md'), '# no');
  await writeFile(join(docs, '.draft', 'secret.md'), '# no');
  await writeFile(join(docs, 'a', 'b', 'c', 'd', 'deep.md'), '# profondo');
  await writeFile(join(docs, 'a', 'b', 'c', 'd', 'e', 'too-deep.md'), '# troppo');
  await writeFile(join(dir, 'fuori.md'), 'segreto');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const base = {
  position: { x: 0, y: 0 },
  size: { width: 1, height: 1 },
  version: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function setup(connections: Connection[] = []) {
  let panels: Panel[] = [
    {
      ...base,
      id: 't1',
      title: 'Claude',
      type: 'terminal',
      mode: 'claude',
      cwd: '.',
      status: 'idle',
    },
    { ...base, id: 'dir', title: 'docs/', type: 'folder', dirPath: 'docs' },
    { ...base, id: 'md', title: 'AGENTS.md', type: 'markdown', filePath: 'docs/AGENTS.md' },
  ];
  const indexEvents: FolderIndexEvent[] = [];
  const fileEvents: FolderFileChangedEvent[] = [];
  const mdChanges: [string, MarkdownChange][] = [];
  const uses: ConnectionUse[] = [];
  const workspace = {
    root: () => root,
    panels: () => panels,
    bumpContentVersion: (id: string) => {
      let v = 0;
      panels = panels.map((p) => (p.id === id ? { ...p, version: (v = p.version + 1) } : p));
      return v;
    },
  };
  // eslint-disable-next-line prefer-const -- MarkdownService needs it lazily
  let folders: FolderService;
  const markdown = new MarkdownService({
    workspace,
    watch: () => undefined,
    onExternalChange: (id, change) => mdChanges.push([id, change]),
    tracks: (path) => folders.tracks(path),
    onPathChanged: (path, content, extra, origin) =>
      folders.pathChanged(path, content, extra, origin),
  });
  folders = new FolderService({
    workspace,
    markdown,
    watch: false,
    onIndex: (e) => indexEvents.push(e),
    onFileChanged: (e) => fileEvents.push(e),
  });
  const access = new AccessService({
    panels: () => panels,
    connections: () => connections,
    root: () => root,
    pathOf: (p) => markdown.pathOf(p),
    foldersAt: (path) => folders.foldersAt(path),
  });
  const tools = new PanelTools({
    access,
    markdown,
    architecture: new ArchitectureService({ workspace, onChange: () => undefined }),
    folders,
    log: new ConnectionLog((u) => uses.push(u)),
    panel: (id) => panels.find((p) => p.id === id),
  });
  return {
    markdown,
    folders,
    access,
    tools,
    indexEvents,
    fileEvents,
    mdChanges,
    uses,
    version: (id: string) => panels.find((p) => p.id === id)!.version,
    ready: async () => {
      await folders.sync();
      await markdown.sync();
    },
  };
}

const at = base.updatedAt;
const readArrow: Connection = { id: 'r', source: 'dir', target: 't1', createdAt: at };
const writeArrow: Connection = { id: 'w', source: 't1', target: 'dir', createdAt: at };

describe('which files a folder panel shows', () => {
  it('accepts markdown files up to four subfolders, nothing hidden or ignored', () => {
    expect(isFolderFile('AGENTS.md')).toBe(true);
    expect(isFolderFile('adr/old/legacy.mdx')).toBe(true);
    expect(isFolderFile('a/b/c/d/deep.md')).toBe(true);
    expect(isFolderFile('a/b/c/d/e/too-deep.md')).toBe(false);
    expect(isFolderFile('notes.txt')).toBe(false);
    expect(isFolderFile('node_modules/pkg.md')).toBe(false);
    expect(isFolderFile('.draft/secret.md')).toBe(false);
    expect(isFolderFile('../fuori.md')).toBe(false);
    expect(isFolderFile('/etc/passwd.md')).toBe(false);
  });

  it('takes the title from the first heading, or from the file name', () => {
    expect(fileTitle('intro\n# Regole del progetto #\n', 'AGENTS.md')).toBe('Regole del progetto');
    expect(fileTitle('niente titolo', 'adr/0002-auth.md')).toBe('0002-auth');
  });

  it('indexes the folder sorted by path, with titles and versions', async () => {
    const t = setup();
    await t.ready();
    expect(t.folders.index('dir').files.map((f) => [f.path, f.title, f.version])).toEqual([
      ['a/b/c/d/deep.md', 'profondo', 1],
      ['adr/0001-db.md', 'Scelta del database', 1],
      ['adr/old/legacy.mdx', 'Vecchio', 1],
      ['AGENTS.md', 'Regole', 1],
      ['PLAN.md', 'PLAN', 1],
    ]);
    expect(t.indexEvents.at(-1)?.id).toBe('dir');
  });

  it('marks a missing folder instead of failing', async () => {
    const t = setup();
    await rm(join(root, 'docs'), { recursive: true });
    await t.ready();
    expect(t.folders.index('dir')).toMatchObject({ exists: false, files: [] });
  });
});

describe('reading and writing files of a folder', () => {
  it('reads, saves with versions and refuses stale writes', async () => {
    const t = setup();
    await t.ready();
    const doc = await t.folders.read('dir', 'AGENTS.md');
    expect(doc).toMatchObject({
      version: 1,
      exists: true,
      content: '# Regole\n- usa sempre pnpm\n',
    });
    expect(await t.folders.write('dir', 'AGENTS.md', '# Regole\n- pnpm\n', 1)).toEqual({
      ok: true,
      version: 2,
    });
    expect(await readFile(join(root, 'docs/AGENTS.md'), 'utf8')).toBe('# Regole\n- pnpm\n');
    expect(t.version('dir')).toBe(2);
    const stale = await t.folders.write('dir', 'AGENTS.md', 'x', 1);
    expect(stale).toMatchObject({ ok: false, code: 'conflict', doc: { version: 2 } });
  });

  it('creates a new file with baseVersion 0 and lists it', async () => {
    const t = setup();
    await t.ready();
    expect(await t.folders.read('dir', 'adr/0002-cache.md')).toMatchObject({
      exists: false,
      version: 0,
    });
    expect(await t.folders.write('dir', 'adr/0002-cache.md', '# Cache\n', 0)).toEqual({
      ok: true,
      version: 1,
    });
    expect(t.folders.index('dir').files.map((f) => f.path)).toContain('adr/0002-cache.md');
  });

  it('rejects paths the panel does not show, also through symlinks', async () => {
    const t = setup();
    await symlink(join(dir, 'fuori.md'), join(root, 'docs', 'link.md'));
    await t.ready();
    for (const path of ['../fuori.md', 'notes.txt', 'node_modules/pkg.md', 'link.md']) {
      const result = await t.folders.write('dir', path, 'x', 0);
      expect(result, path).toMatchObject({ ok: false, code: 'error' });
    }
    expect(await readFile(join(dir, 'fuori.md'), 'utf8')).toBe('segreto');
  });

  it('shares a file with the markdown panel showing it: both are told, one undo history', async () => {
    const t = setup();
    await t.ready();
    await t.markdown.read('md');
    await t.folders.write('dir', 'AGENTS.md', '# Regole\n- yarn\n', 1, 't1');
    expect(t.mdChanges.at(-1)?.[1]).toMatchObject({
      author: 't1',
      doc: { content: '# Regole\n- yarn\n' },
    });
    expect(t.fileEvents.at(-1)).toMatchObject({
      id: 'dir',
      path: 'AGENTS.md',
      author: 't1',
      version: 2,
    });
    // Undo from the markdown panel restores it for the folder too.
    expect(await t.markdown.undo('md')).toMatchObject({ ok: true });
    expect((await t.folders.read('dir', 'AGENTS.md')).content).toBe(
      '# Regole\n- usa sempre pnpm\n',
    );
    expect(t.fileEvents.at(-1)).toMatchObject({ path: 'AGENTS.md', undone: true, version: 3 });
  });

  it('does not echo the folder panel its own save', async () => {
    const t = setup();
    await t.ready();
    await t.folders.write('dir', 'PLAN.md', '# Piano\n', 1);
    expect(t.fileEvents).toEqual([]);
    expect(t.folders.index('dir').files.find((f) => f.path === 'PLAN.md')).toMatchObject({
      title: 'Piano',
      version: 2,
    });
  });

  it('notices a change made outside the app', async () => {
    const t = setup();
    await t.ready();
    await t.folders.read('dir', 'PLAN.md');
    await writeFile(join(root, 'docs/PLAN.md'), '# Nuovo piano\n');
    await t.markdown.fileChanged(join(root, 'docs/PLAN.md'));
    expect(t.fileEvents.at(-1)).toMatchObject({ path: 'PLAN.md', version: 2, author: undefined });
    expect(t.version('dir')).toBe(2);
  });
});

describe('arrows on a folder (PreToolUse and MCP)', () => {
  const edit = (t: ReturnType<typeof setup>, file: string) =>
    t.access.checkFileWrite('t1', 'Write', { file_path: join(root, file) }, root);

  it('blocks every markdown file of the folder without a write arrow, new ones too', async () => {
    const t = setup([readArrow]);
    await t.ready();
    for (const file of ['docs/PLAN.md', 'docs/adr/0009-new.md']) {
      expect(await edit(t, file)).toMatchObject({
        decision: 'deny',
        reason: expect.stringContaining('sola lettura'),
      });
    }
    expect(await edit(t, 'docs/notes.txt')).toEqual({ decision: 'none' });
  });

  it('allows them with a write arrow, and the arrows add up with markdown panels', async () => {
    const t = setup([writeArrow]);
    await t.ready();
    expect(await edit(t, 'docs/adr/0009-new.md')).toMatchObject({ decision: 'allow' });
    // AGENTS.md is also a markdown panel without arrows: the folder's arrow is enough.
    expect(await edit(t, 'docs/AGENTS.md')).toMatchObject({
      decision: 'allow',
      panelIds: ['dir', 'md'],
    });
  });

  it('read_panel gives the index without path and a file with path', async () => {
    const t = setup([readArrow]);
    await t.ready();
    const index = await t.tools.readPanel('t1', 'dir');
    if (!index.ok) throw new Error(index.error);
    expect(index.text).toContain('cartella docs/ · 5 file .md');
    expect(index.text).toContain('- adr/0001-db.md "Scelta del database" · v1');
    const file = await t.tools.readPanel('t1', 'dir', 'adr/0001-db.md');
    expect(file).toMatchObject({ ok: true, text: expect.stringContaining('Postgres.') });
    expect(t.uses.map((u) => [u.kind, u.via])).toEqual([['read', 'read_panel']]);
  });

  it('write_panel needs the arrow and a path, creates and appends files', async () => {
    const readOnly = setup([readArrow]);
    await readOnly.ready();
    expect(await readOnly.tools.writePanel('t1', 'dir', 0, '# X', 'replace', 'X.md')).toMatchObject(
      { ok: false, error: expect.stringContaining('sola lettura') },
    );

    const t = setup([writeArrow]);
    await t.ready();
    expect(await t.tools.writePanel('t1', 'dir', 0, '# X')).toMatchObject({
      ok: false,
      error: expect.stringContaining('"path"'),
    });
    expect(
      await t.tools.writePanel('t1', 'dir', 0, '# ADR 3\n', 'replace', 'adr/0003.md'),
    ).toMatchObject({ ok: true, text: expect.stringContaining('Creato adr/0003.md') });
    expect(
      await t.tools.writePanel('t1', 'dir', 1, '- nuova riga', 'append', 'PLAN.md'),
    ).toMatchObject({ ok: true });
    expect(await readFile(join(root, 'docs/PLAN.md'), 'utf8')).toBe('senza titolo\n- nuova riga');
    expect(await t.tools.writePanel('t1', 'dir', 1, 'x', 'replace', 'PLAN.md')).toMatchObject({
      ok: false,
      error: expect.stringContaining('Conflitto di versione'),
    });
  });
});

describe('what Claude sees of a folder', () => {
  it('gets the index plus the smallest files within the budget', async () => {
    const t = setup();
    await writeFile(join(root, 'docs/BIG.md'), `# Grande\n${'x'.repeat(FOLDER_INLINE.file + 10)}`);
    await t.ready();
    const text = await t.folders.manifestContent({
      ...base,
      id: 'dir',
      title: 'docs/',
      type: 'folder',
      dirPath: 'docs',
    });
    expect(text).toContain('- BIG.md "Grande"');
    expect(text).toContain('--- AGENTS.md (v1) ---\n# Regole');
    expect(text).not.toContain('xxxxxxxxxx');
    expect(text).toContain('Gli altri 1 file si leggono con mcp__plancia__read_panel');
  });

  it('puts a file shown by two linked folders in the context once', async () => {
    const t = setup();
    await t.ready();
    const panel = { ...base, id: 'dir', title: 'docs/', type: 'folder' as const, dirPath: 'docs' };
    const inlined = new Set<string>();
    expect(await t.folders.manifestContent(panel, inlined)).toContain('--- AGENTS.md (v1) ---');
    // Another linked folder showing the same files adds its index, not the contents again.
    const again = await t.folders.manifestContent(panel, inlined);
    expect(again).not.toContain('--- AGENTS.md');
    expect(again).toContain('già riportati per intero');
  });

  it('describes which files changed between two messages', () => {
    const entry = (version: number, files: Record<string, number>): ManifestEntry => ({
      id: 'dir',
      type: 'folder',
      title: 'docs/',
      dirPath: 'docs',
      access: { read: true, write: false },
      version,
      files,
    });
    const before = manifestState([entry(3, { 'PLAN.md': 6, 'old.md': 1 })]);
    const after = manifestState([entry(5, { 'PLAN.md': 7, 'adr/0003.md': 1 })]);
    expect(describeChanges(before, after)).toEqual([
      'docs/: PLAN.md v6 → v7, nuovo adr/0003.md, rimosso old.md',
    ]);
  });
});

it('keeps the MarkdownDoc shape for folder files', async () => {
  const t = setup();
  await t.ready();
  const doc: MarkdownDoc = await t.folders.read('dir', 'AGENTS.md');
  expect(Object.keys(doc).sort()).toEqual(['canUndo', 'content', 'exists', 'version']);
});
