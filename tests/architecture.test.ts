import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ARCH_NODE_SIZE,
  diffArchitecture,
  formatArchitectureForClaude,
  freeArchId,
  parseArchitectureDoc,
  type ArchitectureDoc,
} from '@shared/architecture';
import type { ArchitectureChangedEvent } from '@shared/ipc';
import type { Panel } from '@shared/types';
import { ArchitectureService } from '../src/main/architecture/ArchitectureService';
import { placeNewNodes } from '../src/main/architecture/layout';

const doc: ArchitectureDoc = {
  schemaVersion: 1,
  title: 'Shop',
  nodes: [
    { id: 'web', kind: 'client', label: 'Web', position: { x: 0, y: 0 } },
    { id: 'api', kind: 'api', label: 'API', tech: 'Go', position: { x: 300, y: 0 } },
    { id: 'db', kind: 'database', label: 'Postgres', position: { x: 600, y: 0 } },
  ],
  edges: [
    { id: 'web-api', from: 'web', to: 'api', protocol: 'HTTP' },
    { id: 'api-db', from: 'api', to: 'db', label: 'query' },
  ],
};

describe('ArchitectureDoc validation', () => {
  it('accepts a valid document, from an object or a JSON string', () => {
    expect(parseArchitectureDoc(doc)).toEqual({ ok: true, doc });
    expect(parseArchitectureDoc(JSON.stringify(doc))).toEqual({ ok: true, doc });
  });

  it('explains every problem in readable lines', () => {
    const bad = {
      ...doc,
      nodes: [...doc.nodes, { id: 'api', kind: 'robot', label: '' }],
      edges: [{ id: 'x', from: 'api', to: 'worker' }],
      extra: true,
    };
    const result = parseArchitectureDoc(bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('extra');
    expect(result.error).toContain('kind');
    expect(result.error).toContain('label: non può essere vuota');
  });

  it('checks unique ids and that relations point to existing nodes', () => {
    const result = parseArchitectureDoc({
      ...doc,
      nodes: [...doc.nodes, { id: 'api', kind: 'service', label: 'Doppio' }],
      edges: [{ id: 'x', from: 'api', to: 'worker' }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('id del nodo ripetuto: "api"');
    expect(result.error).toContain('to: il nodo "worker" non esiste');
  });

  it('rejects ids that are not slugs and broken JSON', () => {
    const result = parseArchitectureDoc({
      ...doc,
      nodes: [{ id: '../x', kind: 'service', label: 'X' }],
      edges: [],
    });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('id:') });
    expect(parseArchitectureDoc('{')).toMatchObject({
      ok: false,
      error: expect.stringContaining('Non è JSON valido'),
    });
  });
});

describe('what Claude receives', () => {
  it('is valid JSON without positions, one node or relation per line', () => {
    const text = formatArchitectureForClaude(doc);
    expect(text).not.toContain('position');
    const parsed = JSON.parse(text) as ArchitectureDoc;
    expect(parsed.nodes.map((n) => n.id)).toEqual(['web', 'api', 'db']);
    expect(text.split('\n')).toContain('{"id":"api","kind":"api","label":"API","tech":"Go"},');
    expect(text.length).toBeLessThan(JSON.stringify(doc, null, 2).length / 2);
  });

  it('handles an empty document', () => {
    const empty = formatArchitectureForClaude({ ...doc, nodes: [], edges: [] });
    expect(JSON.parse(empty)).toEqual({ schemaVersion: 1, title: 'Shop', nodes: [], edges: [] });
  });
});

describe('diffArchitecture and freeArchId', () => {
  it('lists added, removed and changed nodes and relations, ignoring positions', () => {
    const next: ArchitectureDoc = {
      ...doc,
      nodes: [
        { ...doc.nodes[0]!, position: { x: 50, y: 50 } },
        { ...doc.nodes[1]!, tech: 'Rust' },
        { id: 'queue', kind: 'queue', label: 'Coda' },
      ],
      edges: [doc.edges[0]!, { id: 'api-queue', from: 'api', to: 'queue' }],
    };
    const diff = diffArchitecture(doc, next);
    expect(diff.addedNodes).toEqual(['queue']);
    expect(diff.removedNodes.map((n) => n.id)).toEqual(['db']);
    expect(diff.changedNodes).toEqual(['api']);
    expect(diff.addedEdges).toEqual(['api-queue']);
    expect(diff.removedEdges.map((e) => e.id)).toEqual(['api-db']);
  });

  it('builds readable free ids', () => {
    expect(freeArchId('Servizio Ordini', [])).toBe('servizio-ordini');
    expect(freeArchId('API', ['api', 'api-2'])).toBe('api-3');
    expect(freeArchId('!!!', [])).toBe('nodo');
  });
});

describe('placeNewNodes', () => {
  const overlap = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.abs(a.x - b.x) < ARCH_NODE_SIZE.width && Math.abs(a.y - b.y) < ARCH_NODE_SIZE.height;

  it('lays out a document with no positions at all', () => {
    const placed = placeNewNodes({
      ...doc,
      nodes: doc.nodes.map(({ id, kind, label }) => ({ id, kind, label })),
    });
    const [web, api, db] = placed.nodes.map((n) => n.position!);
    expect(web!.x).toBeLessThan(api!.x);
    expect(api!.x).toBeLessThan(db!.x);
  });

  it('never moves existing nodes and puts new ones near their neighbours, not on top', () => {
    const next: ArchitectureDoc = {
      ...doc,
      nodes: [
        ...doc.nodes,
        { id: 'worker', kind: 'service', label: 'Worker' },
        { id: 'queue', kind: 'queue', label: 'Coda' },
      ],
      edges: [
        ...doc.edges,
        { id: 'api-queue', from: 'api', to: 'queue' },
        { id: 'queue-worker', from: 'queue', to: 'worker' },
      ],
    };
    const placed = placeNewNodes(next);
    for (const node of doc.nodes) {
      expect(placed.nodes.find((n) => n.id === node.id)!.position).toEqual(node.position);
    }
    const positions = placed.nodes.map((n) => n.position!);
    positions.forEach((a, i) =>
      positions.slice(i + 1).forEach((b) => expect(overlap(a, b)).toBe(false)),
    );
    const api = positions[1]!;
    const queue = placed.nodes.find((n) => n.id === 'queue')!.position!;
    expect(Math.hypot(queue.x - api.x, queue.y - api.y)).toBeLessThan(800);
    const worker = placed.nodes.find((n) => n.id === 'worker')!.position!;
    expect(worker.x).toBeGreaterThan(queue.x);
  });
});

describe('ArchitectureService', () => {
  let dir: string;
  let panels: Panel[];
  let events: ArchitectureChangedEvent[];
  const panelBase = {
    position: { x: 0, y: 0 },
    size: { width: 1, height: 1 },
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const archPanel = (id: string, title = 'Backend'): Panel => ({
    ...panelBase,
    id,
    title,
    type: 'architecture',
  });

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'plancia-arch-')));
    await mkdir(join(dir, '.plancia'), { recursive: true });
    panels = [];
    events = [];
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  function service() {
    return new ArchitectureService({
      workspace: {
        root: () => dir,
        panels: () => panels,
        bumpContentVersion: (id) => {
          let v = 0;
          panels = panels.map((p) => (p.id === id ? { ...p, version: (v = p.version + 1) } : p));
          return v;
        },
      },
      onChange: (e) => events.push(e),
    });
  }
  const file = (id: string) => join(dir, '.plancia/panels', `${id}.arch.json`);
  const exists = (path: string) =>
    stat(path).then(
      () => true,
      () => false,
    );

  it('creates, duplicates and deletes the document together with the panel', async () => {
    const s = service();
    s.sync(panels);
    panels = [archPanel('arch-1', 'Backend')];
    await s.boardChanged(
      { type: 'createPanel', panelType: 'architecture', position: { x: 0, y: 0 } },
      panels,
    );
    expect(JSON.parse(await readFile(file('arch-1'), 'utf8'))).toEqual({
      schemaVersion: 1,
      title: 'Backend',
      nodes: [],
      edges: [],
    });
    await s.write('arch-1', doc, 1);
    panels = [...panels, archPanel('arch-2', 'Backend (copia)')];
    await s.boardChanged({ type: 'duplicatePanel', id: 'arch-1' }, panels);
    expect((await s.read('arch-2')).doc.nodes).toHaveLength(3);
    panels = panels.filter((p) => p.id !== 'arch-1');
    await s.boardChanged({ type: 'deletePanels', ids: ['arch-1'] }, panels);
    expect(await exists(file('arch-1'))).toBe(false);
    expect(await exists(file('arch-2'))).toBe(true);
  });

  it('reads a missing file as an empty document and an invalid one as an error', async () => {
    panels = [archPanel('arch-1', 'Vuota')];
    const s = service();
    expect((await s.read('arch-1')).doc).toEqual({
      schemaVersion: 1,
      title: 'Vuota',
      nodes: [],
      edges: [],
    });
    await mkdir(join(dir, '.plancia/panels'), { recursive: true });
    await writeFile(file('arch-1'), '{"schemaVersion":1}');
    await expect(s.read('arch-1')).rejects.toThrow('non è valido');
  });

  it('saves the user edits as they are, without telling the panel back', async () => {
    panels = [archPanel('arch-1')];
    const s = service();
    const moved = {
      ...doc,
      nodes: doc.nodes.map((n) => ({ ...n, position: { x: 7, y: n.position!.x } })),
    };
    expect(await s.write('arch-1', moved, 1)).toMatchObject({ ok: true, version: 2 });
    expect((await s.read('arch-1')).doc).toEqual(moved);
    expect(events).toEqual([]);
    expect(await s.write('arch-1', moved, 1)).toMatchObject({ ok: false, code: 'conflict' });
  });

  it("keeps positions on Claude's writes and undoes them one at a time", async () => {
    panels = [archPanel('arch-1')];
    const s = service();
    await s.write('arch-1', doc, 1);
    const fromClaude = {
      ...doc,
      nodes: [
        ...doc.nodes.map(({ id, kind, label, tech }) => ({ id, kind, label, tech })),
        { id: 'queue', kind: 'queue', label: 'Coda' },
      ],
      edges: [...doc.edges, { id: 'api-queue', from: 'api', to: 'queue' }],
    };
    const result = await s.write('arch-1', JSON.parse(JSON.stringify(fromClaude)), 2, 't1');
    expect(result).toMatchObject({ ok: true, version: 3 });
    const state = await s.read('arch-1');
    expect(state.doc.nodes.find((n) => n.id === 'api')!.position).toEqual({ x: 300, y: 0 });
    expect(state.doc.nodes.find((n) => n.id === 'queue')!.position).toBeDefined();
    expect(state.canUndo).toBe(true);
    expect(events[0]).toMatchObject({ author: 't1', diff: { addedNodes: ['queue'] } });

    expect(await s.undo('arch-1')).toEqual({ ok: true, version: 4 });
    expect((await s.read('arch-1')).doc).toEqual(doc);
    expect(events[1]).toMatchObject({ undone: true, canUndo: false });
    expect(await s.undo('arch-1')).toEqual({ ok: false, message: 'Niente da annullare' });
  });
});
