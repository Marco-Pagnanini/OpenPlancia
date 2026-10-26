import { describe, expect, it, vi } from 'vitest';
import {
  BoardError,
  BoardStore,
  emptyPersistedBoard,
  fromPersisted,
  toPersisted,
} from '../src/main/board/BoardStore';
import { MIN_PANEL_SIZE } from '@shared/panels';
import { persistedBoardSchema } from '@shared/schemas';
import type { Board, TerminalPanel } from '@shared/types';

const NOW = new Date('2026-10-26T10:00:00.000Z');

function makeStore(board: Board = fromPersisted(emptyPersistedBoard()), hex: string[] = []) {
  let i = 0;
  return new BoardStore(board, {
    now: () => NOW,
    randomHex: () => hex[i++] ?? `${(i + 0xa000).toString(16)}`,
  });
}

const at = { x: 10, y: 20 };

describe('BoardStore', () => {
  it('creates panels of every type with prefixed ids and defaults', () => {
    const store = makeStore();
    store.apply({ type: 'createPanel', panelType: 'terminal', position: at });
    store.apply({ type: 'createPanel', panelType: 'terminal', position: at, mode: 'claude' });
    store.apply({ type: 'createPanel', panelType: 'markdown', position: at });
    store.apply({ type: 'createPanel', panelType: 'architecture', position: at });
    store.apply({ type: 'createPanel', panelType: 'code', position: at });

    const panels = store.getBoard().panels;
    expect(panels.map((p) => p.id.split('-')[0])).toEqual(['term', 'term', 'md', 'arch', 'code']);
    expect(panels.map((p) => p.title)).toEqual([
      'Terminale',
      'Claude',
      'AGENTS.md',
      'Architettura',
      'Codice',
    ]);
    expect(panels[0]).toMatchObject({ mode: 'shell', cwd: '.', status: 'not-started', version: 1 });
    expect(panels[1]).toMatchObject({ mode: 'claude' });
    expect(panels[4]).toMatchObject({ follow: 'all-agents' });
    expect(panels.every((p) => p.updatedAt === NOW.toISOString())).toBe(true);
  });

  it('numbers duplicate default titles', () => {
    const store = makeStore();
    for (let i = 0; i < 3; i++)
      store.apply({ type: 'createPanel', panelType: 'code', position: at });
    expect(store.getBoard().panels.map((p) => p.title)).toEqual(['Codice', 'Codice 2', 'Codice 3']);
  });

  it('retries id generation on collision', () => {
    const store = makeStore(undefined, ['aaaa', 'aaaa', 'bbbb']);
    store.apply({ type: 'createPanel', panelType: 'code', position: at });
    store.apply({ type: 'createPanel', panelType: 'code', position: at });
    expect(store.getBoard().panels.map((p) => p.id)).toEqual(['code-aaaa', 'code-bbbb']);
  });

  it('moves several panels without bumping the content version', () => {
    const store = makeStore();
    store.apply({ type: 'createPanel', panelType: 'code', position: at });
    store.apply({ type: 'createPanel', panelType: 'markdown', position: at });
    const [a, b] = store.getBoard().panels;
    store.apply({
      type: 'movePanels',
      moves: [
        { id: a!.id, position: { x: 100, y: 100 } },
        { id: b!.id, position: { x: -50, y: 0 } },
      ],
    });
    const moved = store.getBoard().panels;
    expect(moved.map((p) => p.position)).toEqual([
      { x: 100, y: 100 },
      { x: -50, y: 0 },
    ]);
    expect(moved.every((p) => p.version === 1)).toBe(true);
  });

  it('resizes with a minimum size', () => {
    const store = makeStore();
    store.apply({ type: 'createPanel', panelType: 'code', position: at });
    const id = store.getBoard().panels[0]!.id;
    store.apply({
      type: 'resizePanel',
      id,
      position: { x: 5, y: 6 },
      size: { width: 10, height: 900 },
    });
    expect(store.getBoard().panels[0]).toMatchObject({
      position: { x: 5, y: 6 },
      size: { width: MIN_PANEL_SIZE.width, height: 900 },
    });
  });

  it('renames, trimming whitespace', () => {
    const store = makeStore();
    store.apply({ type: 'createPanel', panelType: 'code', position: at });
    const id = store.getBoard().panels[0]!.id;
    store.apply({ type: 'renamePanel', id, title: '  Diff backend ' });
    expect(store.getBoard().panels[0]!.title).toBe('Diff backend');
  });

  it('duplicates a terminal without its Claude session', () => {
    const terminal: TerminalPanel = {
      id: 'term-0001',
      type: 'terminal',
      mode: 'claude',
      cwd: 'api',
      claudeSessionId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      status: 'working',
      title: 'Backend',
      position: { x: 0, y: 0 },
      size: { width: 600, height: 400 },
      version: 4,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const store = makeStore({ schemaVersion: 1, panels: [terminal], connections: [] });
    store.apply({ type: 'duplicatePanel', id: 'term-0001' });
    const copy = store.getBoard().panels[1] as TerminalPanel;
    expect(copy.id).not.toBe('term-0001');
    expect(copy).toMatchObject({
      title: 'Backend (copia)',
      mode: 'claude',
      cwd: 'api',
      status: 'not-started',
      version: 1,
      position: { x: 40, y: 40 },
      size: { width: 600, height: 400 },
    });
    expect(copy.claudeSessionId).toBeUndefined();
  });

  it('deletes panels together with their connections', () => {
    const board: Board = {
      schemaVersion: 1,
      panels: [],
      connections: [
        { id: 'c1', source: 'md-1', target: 'term-1', createdAt: NOW.toISOString() },
        { id: 'c2', source: 'term-1', target: 'arch-1', createdAt: NOW.toISOString() },
        { id: 'c3', source: 'md-2', target: 'term-2', createdAt: NOW.toISOString() },
      ],
    };
    const store = makeStore(board);
    store.apply({ type: 'deletePanels', ids: ['term-1', 'missing'] });
    expect(store.getBoard().connections.map((c) => c.id)).toEqual(['c3']);
  });

  it('rejects intents on unknown panels and leaves state untouched', () => {
    const store = makeStore();
    const before = store.getBoard();
    expect(() => store.apply({ type: 'renamePanel', id: 'nope', title: 'x' })).toThrow(BoardError);
    expect(() =>
      store.apply({ type: 'movePanels', moves: [{ id: 'nope', position: at }] }),
    ).toThrow(BoardError);
    expect(store.getBoard()).toBe(before);
  });

  it('notifies listeners with the new board and the intent', () => {
    const store = makeStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const intent = { type: 'setViewport', viewport: { x: 1, y: 2, zoom: 0.5 } } as const;
    store.apply(intent);
    expect(listener).toHaveBeenCalledWith(store.getBoard(), intent);
    unsubscribe();
    store.apply(intent);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('persistence mapping', () => {
  it('strips runtime status and round-trips through the schema', () => {
    const store = makeStore();
    store.apply({ type: 'createPanel', panelType: 'terminal', position: at, mode: 'claude' });
    const persisted = toPersisted(store.getBoard());
    expect(persisted.panels[0]).not.toHaveProperty('status');
    expect(persistedBoardSchema.parse(persisted)).toEqual(persisted);
    expect(fromPersisted(persisted)).toEqual(store.getBoard());
  });
});
