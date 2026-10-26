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
    store.apply({
      type: 'createPanel',
      panelType: 'markdown',
      position: at,
      filePath: 'AGENTS.md',
    });
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

  it('creates folder panels named after the folder, and only with a folder', () => {
    const store = makeStore();
    store.apply({ type: 'createPanel', panelType: 'folder', position: at, dirPath: 'docs/adr' });
    store.apply({ type: 'createPanel', panelType: 'folder', position: at, dirPath: '.' });
    expect(store.getBoard().panels.map((p) => [p.id.split('-')[0], p.title])).toEqual([
      ['dir', 'adr/'],
      ['dir', 'Progetto/'],
    ]);
    expect(store.getBoard().panels[0]).toMatchObject({ type: 'folder', dirPath: 'docs/adr' });
    expect(() => store.apply({ type: 'createPanel', panelType: 'folder', position: at })).toThrow(
      BoardError,
    );
    expect(persistedBoardSchema.safeParse(toPersisted(store.getBoard())).success).toBe(true);
  });

  it('sets what a Code panel follows and the file opened by hand', () => {
    const store = makeStore();
    store.apply({ type: 'createPanel', panelType: 'code', position: at });
    store.apply({ type: 'createPanel', panelType: 'terminal', position: at, mode: 'claude' });
    const [code, term] = store.getBoard().panels;
    store.apply({ type: 'setCodeFollow', id: code!.id, follow: { terminalId: term!.id } });
    store.apply({ type: 'setCodePinned', id: code!.id, pinnedFile: 'src/main.ts' });
    expect(store.getBoard().panels[0]).toMatchObject({
      follow: { terminalId: term!.id },
      pinnedFile: 'src/main.ts',
    });
    store.apply({ type: 'setCodePinned', id: code!.id, pinnedFile: null });
    expect(store.getBoard().panels[0]).not.toHaveProperty('pinnedFile');
    expect(() =>
      store.apply({ type: 'setCodeFollow', id: term!.id, follow: 'all-agents' }),
    ).toThrow(BoardError);
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
    store.apply({
      type: 'createPanel',
      panelType: 'markdown',
      position: at,
      filePath: 'AGENTS.md',
    });
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

describe('markdown panels', () => {
  it('need a file and take its name as title', () => {
    const store = makeStore();
    expect(() => store.apply({ type: 'createPanel', panelType: 'markdown', position: at })).toThrow(
      BoardError,
    );
    store.apply({
      type: 'createPanel',
      panelType: 'markdown',
      position: at,
      filePath: 'docs/NOTE.md',
    });
    store.apply({ type: 'createPanel', panelType: 'markdown', position: at, filePath: 'NOTE.md' });
    expect(
      store.getBoard().panels.map((p) => [p.title, p.type === 'markdown' && p.filePath]),
    ).toEqual([
      ['NOTE.md', 'docs/NOTE.md'],
      ['NOTE.md 2', 'NOTE.md'],
    ]);
  });

  it('bumps the content version as a persisted change', () => {
    const store = makeStore();
    store.apply({ type: 'createPanel', panelType: 'markdown', position: at, filePath: 'A.md' });
    const id = store.getBoard().panels[0]!.id;
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.bumpVersion(id)).toBe(2);
    expect(store.bumpVersion(id)).toBe(3);
    expect(store.getBoard().panels[0]!.version).toBe(3);
    expect(listener.mock.calls[1]![1]).toEqual({ type: 'contentVersion', id, version: 3 });
  });
});

describe('connections', () => {
  function board() {
    const store = makeStore(undefined, ['0001', '0002', '0003', '0004', 'c001', 'c002', 'c003']);
    store.apply({ type: 'createPanel', panelType: 'terminal', mode: 'claude', position: at });
    store.apply({
      type: 'createPanel',
      panelType: 'markdown',
      filePath: 'AGENTS.md',
      position: at,
    });
    store.apply({ type: 'createPanel', panelType: 'terminal', mode: 'shell', position: at });
    store.apply({ type: 'createPanel', panelType: 'terminal', mode: 'claude', position: at });
    return store;
  }

  it('adds arrows that follow the rules, with ids and timestamps', () => {
    const store = board();
    store.apply({ type: 'connect', source: 'md-0002', target: 'term-0001' });
    store.apply({ type: 'connect', source: 'term-0001', target: 'md-0002' });
    expect(store.getBoard().connections).toEqual([
      { id: 'conn-c001', source: 'md-0002', target: 'term-0001', createdAt: NOW.toISOString() },
      { id: 'conn-c002', source: 'term-0001', target: 'md-0002', createdAt: NOW.toISOString() },
    ]);
  });

  it('rejects arrows the rules forbid, leaving the board untouched', () => {
    const store = board();
    store.apply({ type: 'connect', source: 'md-0002', target: 'term-0001' });
    const before = store.getBoard();
    for (const [source, target, message] of [
      ['md-0002', 'term-0001', 'Questo collegamento esiste già'],
      ['md-0002', 'term-0003', 'Solo i terminali Claude si possono collegare'],
      ['md-0002', 'nope', 'Panel inesistente'],
    ] as const) {
      expect(() => store.apply({ type: 'connect', source, target })).toThrow(message);
    }
    expect(store.getBoard()).toBe(before);
  });

  it('disconnects by id', () => {
    const store = board();
    store.apply({ type: 'connect', source: 'md-0002', target: 'term-0001' });
    store.apply({ type: 'disconnect', ids: ['conn-c001', 'missing'] });
    expect(store.getBoard().connections).toEqual([]);
  });
});

describe('terminal runtime state', () => {
  function withTerminal() {
    const store = makeStore();
    store.apply({ type: 'createPanel', panelType: 'terminal', position: at });
    return { store, id: store.getBoard().panels[0]!.id };
  }

  it('updates status as a runtime change and skips no-ops', () => {
    const { store, id } = withTerminal();
    const listener = vi.fn();
    store.subscribe(listener);
    store.setTerminalStatus(id, 'idle');
    store.setTerminalStatus(id, 'idle');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![1]).toEqual({ type: 'terminalRuntime', id });
  });

  it('switches a shell to claude dropping any previous session', () => {
    const { store, id } = withTerminal();
    store.setClaudeSessionId(id, '7c9e6679-7425-40de-944b-e07fc1f90ae7');
    store.setTerminalStatus(id, 'exited');
    store.apply({ type: 'setTerminalMode', id, mode: 'claude' });
    const panel = store.getBoard().panels[0] as TerminalPanel;
    expect(panel).toMatchObject({ mode: 'claude', status: 'not-started' });
    expect(panel.claudeSessionId).toBeUndefined();
  });

  it('refuses terminal operations on other panels', () => {
    const store = makeStore();
    store.apply({ type: 'createPanel', panelType: 'code', position: at });
    const id = store.getBoard().panels[0]!.id;
    expect(() => store.setTerminalStatus(id, 'idle')).toThrow(BoardError);
    expect(() => store.apply({ type: 'setTerminalMode', id, mode: 'claude' })).toThrow(BoardError);
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
