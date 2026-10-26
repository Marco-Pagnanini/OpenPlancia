import { randomBytes } from 'node:crypto';
import { BOARD_SCHEMA_VERSION } from '@shared/schemas';
import { DEFAULT_PANEL_SIZES, MIN_PANEL_SIZE, defaultPanelTitle } from '@shared/panels';
import type {
  AgentStatus,
  Board,
  BoardIntent,
  Panel,
  PanelType,
  PersistedBoard,
  PersistedPanel,
  Position,
  Size,
  TerminalMode,
  TerminalPanel,
  TerminalRuntime,
} from '@shared/types';

export class BoardError extends Error {}

export interface BoardStoreOptions {
  now?: () => Date;
  /** Returns 4 hex chars; injectable for deterministic tests. */
  randomHex?: () => string;
}

/** Changes made by the main process itself, not requested by the renderer. */
export type InternalChange =
  /** Runtime-only terminal state: broadcast but never persisted. */
  { type: 'terminalRuntime'; id: string } | { type: 'claudeSession'; id: string };

export type BoardChange = BoardIntent | InternalChange;

export type BoardListener = (board: Board, change: BoardChange) => void;

const ID_PREFIX: Record<PanelType, string> = {
  terminal: 'term',
  markdown: 'md',
  architecture: 'arch',
  code: 'code',
};

const DUPLICATE_OFFSET = 40;

export function emptyPersistedBoard(): PersistedBoard {
  return { schemaVersion: BOARD_SCHEMA_VERSION, panels: [], connections: [] };
}

export function fromPersisted(persisted: PersistedBoard): Board {
  return {
    ...persisted,
    panels: persisted.panels.map((p) =>
      p.type === 'terminal' ? { ...p, status: 'not-started' as const } : p,
    ),
  };
}

export function toPersisted(board: Board): PersistedBoard {
  return {
    ...board,
    panels: board.panels.map((p): PersistedPanel => {
      if (p.type !== 'terminal') return p;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { status, currentTool, ...rest } = p;
      return rest;
    }),
  };
}

function clampSize(size: Size): Size {
  return {
    width: Math.max(MIN_PANEL_SIZE.width, size.width),
    height: Math.max(MIN_PANEL_SIZE.height, size.height),
  };
}

/**
 * In-memory source of truth for panels and connections of the open workspace.
 * State is replaced immutably on every intent so snapshots can be shared safely.
 */
export class BoardStore {
  private board: Board;
  private readonly listeners = new Set<BoardListener>();
  private readonly now: () => Date;
  private readonly randomHex: () => string;

  constructor(board: Board, options: BoardStoreOptions = {}) {
    this.board = board;
    this.now = options.now ?? (() => new Date());
    this.randomHex = options.randomHex ?? (() => randomBytes(2).toString('hex'));
  }

  getBoard(): Board {
    return this.board;
  }

  subscribe(listener: BoardListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  apply(intent: BoardIntent): void {
    this.commit(this.reduce(this.board, intent), intent);
  }

  setTerminalStatus(id: string, status: AgentStatus): void {
    this.setTerminalRuntime(id, { status });
  }

  /** `currentTool: undefined` clears the current tool. */
  setTerminalRuntime(id: string, patch: Partial<TerminalRuntime>): void {
    const panel = this.requireTerminal(this.board, id);
    const next: TerminalPanel = { ...panel, ...patch };
    if (next.currentTool === undefined) delete next.currentTool;
    if (next.status === panel.status && next.currentTool === panel.currentTool) return;
    this.commit(this.replacePanel(this.board, next), { type: 'terminalRuntime', id });
  }

  setClaudeSessionId(id: string, sessionId: string): void {
    const panel = this.requireTerminal(this.board, id);
    this.commit(this.replacePanel(this.board, { ...panel, claudeSessionId: sessionId }), {
      type: 'claudeSession',
      id,
    });
  }

  private commit(board: Board, change: BoardChange): void {
    this.board = board;
    for (const listener of this.listeners) listener(this.board, change);
  }

  private requireTerminal(board: Board, id: string): TerminalPanel {
    const panel = this.requirePanel(board, id);
    if (panel.type !== 'terminal') throw new BoardError(`Il panel ${id} non è un terminale`);
    return panel;
  }

  private replacePanel(board: Board, panel: Panel): Board {
    return { ...board, panels: board.panels.map((p) => (p.id === panel.id ? panel : p)) };
  }

  private reduce(board: Board, intent: BoardIntent): Board {
    switch (intent.type) {
      case 'createPanel': {
        const panel = this.newPanel(board, intent.panelType, intent.position, intent.mode);
        return { ...board, panels: [...board.panels, panel] };
      }
      case 'movePanels': {
        const moves = new Map(intent.moves.map((m) => [m.id, m.position]));
        for (const id of moves.keys()) this.requirePanel(board, id);
        return {
          ...board,
          panels: board.panels.map((p) => {
            const position = moves.get(p.id);
            return position ? { ...p, position } : p;
          }),
        };
      }
      case 'resizePanel':
        return this.updatePanel(board, intent.id, (p) => ({
          ...p,
          position: intent.position,
          size: clampSize(intent.size),
        }));
      case 'renamePanel':
        return this.updatePanel(board, intent.id, (p) => ({ ...p, title: intent.title.trim() }));
      case 'duplicatePanel': {
        const source = this.requirePanel(board, intent.id);
        const copy = this.duplicate(board, source);
        return { ...board, panels: [...board.panels, copy] };
      }
      case 'deletePanels': {
        const ids = new Set(intent.ids);
        return {
          ...board,
          panels: board.panels.filter((p) => !ids.has(p.id)),
          connections: board.connections.filter((c) => !ids.has(c.source) && !ids.has(c.target)),
        };
      }
      case 'setViewport':
        return { ...board, viewport: intent.viewport };
      case 'setTerminalMode': {
        const terminal = this.requireTerminal(board, intent.id);
        if (terminal.mode === intent.mode) return board;
        // A different program starts from scratch: no session to resume.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { claudeSessionId, ...rest } = terminal;
        return this.replacePanel(board, { ...rest, mode: intent.mode, status: 'not-started' });
      }
    }
  }

  private requirePanel(board: Board, id: string): Panel {
    const panel = board.panels.find((p) => p.id === id);
    if (!panel) throw new BoardError(`Panel inesistente: ${id}`);
    return panel;
  }

  private updatePanel(board: Board, id: string, update: (p: Panel) => Panel): Board {
    this.requirePanel(board, id);
    return { ...board, panels: board.panels.map((p) => (p.id === id ? update(p) : p)) };
  }

  private newId(board: Board, type: PanelType): string {
    const taken = new Set(board.panels.map((p) => p.id));
    for (let attempt = 0; attempt < 100; attempt++) {
      const id = `${ID_PREFIX[type]}-${this.randomHex()}`;
      if (!taken.has(id)) return id;
    }
    throw new BoardError('Impossibile generare un id univoco per il panel');
  }

  private uniqueTitle(board: Board, base: string): string {
    const titles = new Set(board.panels.map((p) => p.title));
    if (!titles.has(base)) return base;
    let n = 2;
    while (titles.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  }

  private newPanel(
    board: Board,
    type: PanelType,
    position: Position,
    mode: TerminalMode = 'shell',
  ): Panel {
    const base = {
      id: this.newId(board, type),
      title: this.uniqueTitle(board, defaultPanelTitle(type, mode)),
      position,
      size: DEFAULT_PANEL_SIZES[type],
      version: 1,
      updatedAt: this.now().toISOString(),
    };
    switch (type) {
      case 'terminal':
        return { ...base, type, mode, cwd: '.', status: 'not-started' };
      case 'markdown':
        // Placeholder until M4 lets the user pick or create the file.
        return { ...base, type, filePath: 'AGENTS.md' };
      case 'architecture':
        return { ...base, type };
      case 'code':
        return { ...base, type, follow: 'all-agents' };
    }
  }

  private duplicate(board: Board, source: Panel): Panel {
    const common = {
      id: this.newId(board, source.type),
      title: this.uniqueTitle(board, `${source.title} (copia)`),
      position: {
        x: source.position.x + DUPLICATE_OFFSET,
        y: source.position.y + DUPLICATE_OFFSET,
      },
      version: 1,
      updatedAt: this.now().toISOString(),
    };
    if (source.type === 'terminal') {
      // A copy never inherits the Claude session: it starts its own.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { claudeSessionId, ...rest } = source;
      return { ...rest, ...common, status: 'not-started' };
    }
    return { ...source, ...common };
  }
}
