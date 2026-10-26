import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ArchitectureChangedEvent, ConnectionUse, MarkdownDoc } from '@shared/ipc';
import type { Connection, Panel } from '@shared/types';
import { AccessService, PLANCIA_DIR_DENIED } from '../src/main/access/AccessService';
import { ConnectionLog } from '../src/main/access/ConnectionLog';
import { PanelTools } from '../src/main/access/panelTools';
import { ArchitectureService } from '../src/main/architecture/ArchitectureService';
import { MarkdownService, type MarkdownChange } from '../src/main/files/MarkdownService';

let dir: string;
let root: string;
beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'plancia-acc-')));
  root = join(dir, 'repo');
  await mkdir(join(root, '.plancia'), { recursive: true });
  await writeFile(join(root, 'AGENTS.md'), '# Regole\n- usa sempre pnpm\n');
  await writeFile(join(root, 'README.md'), 'readme');
  await writeFile(join(dir, 'fuori.md'), 'segreto');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const base = {
  position: { x: 0, y: 0 },
  size: { width: 1, height: 1 },
  version: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function setup(connections: Connection[], extraPanels: Panel[] = []) {
  let panels: Panel[] = [
    {
      ...base,
      id: 't1',
      title: 'claude · backend',
      type: 'terminal',
      mode: 'claude',
      cwd: '.',
      status: 'idle',
    },
    { ...base, id: 'md', title: 'AGENTS.md', type: 'markdown', filePath: 'AGENTS.md' },
    { ...base, id: 'arch', title: 'Backend v1', type: 'architecture' },
    ...extraPanels,
  ];
  let conns = connections;
  const changes: [string, MarkdownChange][] = [];
  const uses: ConnectionUse[] = [];
  const archEvents: ArchitectureChangedEvent[] = [];
  const workspace = {
    root: () => root,
    panels: () => panels,
    bumpContentVersion: (id: string) => {
      let v = 0;
      panels = panels.map((p) => (p.id === id ? { ...p, version: (v = p.version + 1) } : p));
      return v;
    },
  };
  const architecture = new ArchitectureService({
    workspace,
    onChange: (event) => archEvents.push(event),
  });
  const markdown = new MarkdownService({
    workspace,
    watch: () => undefined,
    onExternalChange: (id, change) => changes.push([id, change]),
  });
  const access = new AccessService({
    panels: () => panels,
    connections: () => conns,
    root: () => root,
    pathOf: (p) => markdown.pathOf(p),
  });
  const log = new ConnectionLog((u) => uses.push(u));
  const tools = new PanelTools({
    access,
    markdown,
    architecture,
    log,
    panel: (id) => panels.find((p) => p.id === id),
  });
  return {
    markdown,
    architecture,
    archEvents,
    access,
    tools,
    log,
    changes,
    uses,
    version: (id: string) => panels.find((p) => p.id === id)!.version,
    setConnections: (c: Connection[]) => (conns = c),
  };
}

const read: Connection = { id: 'r', source: 'md', target: 't1', createdAt: base.updatedAt };
const write: Connection = { id: 'w', source: 't1', target: 'md', createdAt: base.updatedAt };

describe('PreToolUse protection (AccessService.checkFileWrite)', () => {
  it('denies Edit/Write on a panel file connected read-only, with the spec message', async () => {
    const t = setup([read]);
    await t.markdown.sync();
    const decision = await t.access.checkFileWrite(
      't1',
      'Edit',
      { file_path: join(root, 'AGENTS.md') },
      root,
    );
    expect(decision).toEqual({
      decision: 'deny',
      reason:
        "Accesso negato: il panel 'AGENTS.md' è collegato a questo terminale in sola lettura. L'utente deve aggiungere una freccia Terminale → Panel per consentire la scrittura.",
    });
  });

  it('denies a panel file that is not connected at all', async () => {
    const t = setup([]);
    const decision = await t.access.checkFileWrite('t1', 'Write', { file_path: 'AGENTS.md' }, root);
    expect(decision).toMatchObject({
      decision: 'deny',
      reason: expect.stringContaining('non è collegato'),
    });
  });

  it('allows it with a write arrow and reports the panels on that file', async () => {
    const t = setup([write]);
    const decision = await t.access.checkFileWrite(
      't1',
      'MultiEdit',
      { file_path: './AGENTS.md' },
      root,
    );
    expect(decision).toEqual({
      decision: 'allow',
      path: join(root, 'AGENTS.md'),
      panelIds: ['md'],
    });
  });

  it('denies any write inside .plancia/', async () => {
    const t = setup([write]);
    for (const file of ['.plancia/board.json', '.plancia/panels/arch.arch.json']) {
      expect(
        await t.access.checkFileWrite('t1', 'Write', { file_path: join(root, file) }, root),
      ).toEqual({
        decision: 'deny',
        reason: PLANCIA_DIR_DENIED,
      });
    }
  });

  it('leaves other files and other tools alone', async () => {
    const t = setup([]);
    expect(
      await t.access.checkFileWrite('t1', 'Edit', { file_path: join(root, 'README.md') }, root),
    ).toEqual({
      decision: 'none',
    });
    expect(
      await t.access.checkFileWrite('t1', 'Read', { file_path: join(root, 'AGENTS.md') }, root),
    ).toEqual({
      decision: 'none',
    });
    expect(
      await t.access.checkFileWrite('t1', 'Bash', { command: 'echo x > AGENTS.md' }, root),
    ).toEqual({
      decision: 'none',
    });
  });

  it('sees through symlinks to the panel file', async () => {
    await symlink(join(root, 'AGENTS.md'), join(root, 'alias.md'));
    const t = setup([read]);
    const decision = await t.access.checkFileWrite(
      't1',
      'Edit',
      { file_path: join(root, 'alias.md') },
      root,
    );
    expect(decision).toMatchObject({ decision: 'deny' });
  });
});

describe('MCP tools (PanelTools)', () => {
  it('list_panels shows only linked panels with their access', () => {
    const t = setup([read]);
    const res = t.tools.listPanels('t1');
    expect(res).toMatchObject({
      ok: true,
      data: {
        panels: [
          {
            id: 'md',
            type: 'markdown',
            title: 'AGENTS.md',
            access: { read: true, write: false, label: 'lettura' },
            version: 1,
            filePath: 'AGENTS.md',
          },
        ],
      },
    });
  });

  it('read_panel needs a read arrow', async () => {
    const t = setup([write]);
    expect(await t.tools.readPanel('t1', 'md')).toEqual({
      ok: false,
      error:
        "Accesso negato: il panel 'AGENTS.md' non è collegato a questo terminale in lettura. L'utente deve aggiungere una freccia Panel → Terminale per consentire la lettura.",
    });
    t.setConnections([read]);
    expect(await t.tools.readPanel('t1', 'md')).toMatchObject({
      ok: true,
      data: { version: 1, content: '# Regole\n- usa sempre pnpm\n' },
    });
    expect(t.uses).toMatchObject([{ kind: 'read', via: 'read_panel', panelId: 'md', chars: 27 }]);
  });

  it('write_panel needs a write arrow and explains the read-only case', async () => {
    const t = setup([read]);
    expect(await t.tools.writePanel('t1', 'md', 1, 'x')).toMatchObject({
      ok: false,
      error: expect.stringContaining('in sola lettura'),
    });
    expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toContain('pnpm');
  });

  it('write_panel replaces or appends, bumps the version and keeps undo', async () => {
    const t = setup([read, write]);
    await t.markdown.sync();
    expect(await t.tools.writePanel('t1', 'md', 1, '- niente console.log', 'append')).toMatchObject(
      {
        ok: true,
        text: "Scritto 'AGENTS.md' (AGENTS.md): versione 1 → 2.",
      },
    );
    expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toBe(
      '# Regole\n- usa sempre pnpm\n- niente console.log',
    );
    const [id, change] = t.changes.at(-1)!;
    expect(id).toBe('md');
    expect(change).toMatchObject({ author: 't1', doc: { version: 2, canUndo: true } });
    expect(t.uses.at(-1)).toMatchObject({ kind: 'write', via: 'write_panel', version: 2 });

    expect(await t.tools.writePanel('t1', 'md', 2, '# Nuovo')).toMatchObject({ ok: true });
    expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toBe('# Nuovo');
  });

  it('write_panel refuses a stale baseVersion with a readable conflict', async () => {
    const t = setup([write]);
    await t.markdown.sync();
    await t.tools.writePanel('t1', 'md', 1, 'prima');
    expect(await t.tools.writePanel('t1', 'md', 1, 'seconda')).toEqual({
      ok: false,
      error:
        "Conflitto di versione: il panel 'AGENTS.md' è alla versione 2, la scrittura partiva dalla 1. Rileggi con mcp__plancia__read_panel e riprova.",
    });
    expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toBe('prima');
  });

  it('never reads or writes a panel file outside the workspace', async () => {
    const outside: Panel = {
      ...base,
      id: 'out',
      title: 'fuori.md',
      type: 'markdown',
      filePath: '../fuori.md',
    };
    const t = setup(
      [
        { id: 'a', source: 'out', target: 't1', createdAt: base.updatedAt },
        { id: 'b', source: 't1', target: 'out', createdAt: base.updatedAt },
      ],
      [outside],
    );
    expect(await t.tools.readPanel('t1', 'out')).toMatchObject({
      ok: false,
      error: expect.stringContaining('fuori dalla cartella'),
    });
    expect(await t.tools.writePanel('t1', 'out', 1, 'x')).toMatchObject({ ok: false });
    expect(await readFile(join(dir, 'fuori.md'), 'utf8')).toBe('segreto');
  });

  it('rejects unknown panels and wrong content types', async () => {
    const t = setup([write]);
    expect(await t.tools.readPanel('t1', 'nope')).toMatchObject({
      ok: false,
      error: expect.stringContaining('inesistente'),
    });
    expect(await t.tools.writePanel('t1', 'md', 1, { not: 'text' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('deve essere testo'),
    });
  });
});

describe('MCP tools on an Architecture panel', () => {
  const archRead: Connection = {
    id: 'ar',
    source: 'arch',
    target: 't1',
    createdAt: base.updatedAt,
  };
  const archWrite: Connection = {
    id: 'aw',
    source: 't1',
    target: 'arch',
    createdAt: base.updatedAt,
  };
  const doc = {
    schemaVersion: 1,
    title: 'Backend v1',
    nodes: [
      { id: 'api', kind: 'api', label: 'API' },
      { id: 'db', kind: 'database', label: 'Postgres', tech: 'Postgres 17' },
    ],
    edges: [{ id: 'api-db', from: 'api', to: 'db', protocol: 'SQL' }],
  };

  it('read_panel returns the document as JSON without positions, and logs the read', async () => {
    const t = setup([archRead, archWrite]);
    expect(await t.tools.writePanel('t1', 'arch', 1, doc)).toMatchObject({ ok: true });
    const result = await t.tools.readPanel('t1', 'arch');
    if (!result.ok) throw new Error(result.error);
    expect(result.text).toContain('versione 2');
    expect(result.text).toContain(
      '{"id":"db","kind":"database","label":"Postgres","tech":"Postgres 17"}',
    );
    expect(result.text).not.toContain('position');
    expect(t.uses.map((u) => [u.kind, u.via])).toEqual([
      ['write', 'write_panel'],
      ['read', 'read_panel'],
    ]);
  });

  it('write_panel needs a write arrow', async () => {
    const t = setup([archRead]);
    expect(await t.tools.writePanel('t1', 'arch', 1, doc)).toMatchObject({
      ok: false,
      error: expect.stringContaining('sola lettura'),
    });
  });

  it('write_panel accepts an object or a JSON string, places new nodes and keeps undo', async () => {
    const t = setup([archWrite]);
    expect(await t.tools.writePanel('t1', 'arch', 1, JSON.stringify(doc))).toMatchObject({
      ok: true,
      text: expect.stringContaining('2 nodi, 1 relazioni'),
    });
    const saved = JSON.parse(await readFile(join(root, '.plancia/panels/arch.arch.json'), 'utf8'));
    expect(saved.nodes.every((n: { position?: unknown }) => n.position)).toBe(true);
    expect(t.archEvents).toHaveLength(1);
    expect(t.archEvents[0]).toMatchObject({ id: 'arch', author: 't1', canUndo: true });
    expect(t.archEvents[0]!.diff?.addedNodes).toEqual(['api', 'db']);
  });

  it('refuses an invalid document with readable errors and writes nothing', async () => {
    const t = setup([archWrite]);
    const bad = { ...doc, edges: [{ id: 'x', from: 'api', to: 'worker' }] };
    const result = await t.tools.writePanel('t1', 'arch', 1, bad);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.error).toContain('ArchitectureDoc non valido');
    expect(result.error).toContain('il nodo "worker" non esiste');
    expect(result.error).toContain('get_panel_schema');
    expect(t.version('arch')).toBe(1);
    expect(await t.tools.writePanel('t1', 'arch', 1, '{not json')).toMatchObject({
      ok: false,
      error: expect.stringContaining('Non è JSON valido'),
    });
  });

  it('refuses a stale baseVersion and the append mode', async () => {
    const t = setup([archWrite]);
    expect(await t.tools.writePanel('t1', 'arch', 7, doc)).toMatchObject({
      ok: false,
      error: expect.stringContaining('Conflitto di versione'),
    });
    expect(await t.tools.writePanel('t1', 'arch', 1, doc, 'append')).toMatchObject({
      ok: false,
      error: expect.stringContaining('append'),
    });
  });

  it('get_panel_schema gives the JSON Schema of an ArchitectureDoc', () => {
    const t = setup([]);
    const result = t.tools.panelSchema('architecture');
    if (!result.ok) throw new Error(result.error);
    expect(result.text).toContain('"kind"');
    expect(result.text).toContain('"service"');
    expect(t.tools.panelSchema('markdown')).toMatchObject({ ok: false });
  });
});

describe('undo and attribution (MarkdownService)', () => {
  it('undoes Claude writes one at a time, last 20 kept', async () => {
    const t = setup([write]);
    await t.markdown.sync();
    await t.tools.writePanel('t1', 'md', 1, 'v2');
    await t.tools.writePanel('t1', 'md', 2, 'v3');
    expect(await t.markdown.undo('md')).toEqual({ ok: true, version: 4 });
    expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toBe('v2');
    expect(t.changes.at(-1)![1]).toMatchObject({
      undone: true,
      doc: { content: 'v2', canUndo: true },
    });
    await t.markdown.undo('md');
    expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toBe('# Regole\n- usa sempre pnpm\n');
    expect(await t.markdown.undo('md')).toEqual({ ok: false, message: 'Niente da annullare' });
  });

  it('attributes a file change to Claude after an allowed Edit, and makes it undoable', async () => {
    const t = setup([write]);
    await t.markdown.sync();
    await t.markdown.read('md');
    const decision = await t.access.checkFileWrite(
      't1',
      'Edit',
      { file_path: join(root, 'AGENTS.md') },
      root,
    );
    expect(decision.decision).toBe('allow');
    if (decision.decision === 'allow') t.markdown.expectClaudeWrite(decision.path, 't1');
    await writeFile(join(root, 'AGENTS.md'), 'modificato da Edit');
    await t.markdown.fileChanged(join(root, 'AGENTS.md'));
    expect(t.changes.at(-1)).toEqual([
      'md',
      {
        author: 't1',
        viaTool: true,
        doc: { content: 'modificato da Edit', version: 2, exists: true, canUndo: true },
      },
    ]);
    await t.markdown.undo('md');
    expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toContain('pnpm');
  });

  it('does not attribute changes nobody announced', async () => {
    const t = setup([write]);
    await t.markdown.sync();
    await t.markdown.read('md');
    await writeFile(join(root, 'AGENTS.md'), 'editor esterno');
    await t.markdown.fileChanged(join(root, 'AGENTS.md'));
    const doc: MarkdownDoc = t.changes.at(-1)![1].doc;
    expect(t.changes.at(-1)![1].author).toBeUndefined();
    expect(doc.canUndo).toBe(false);
  });
});
