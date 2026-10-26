import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { TerminalDataEvent } from '@shared/ipc';
import { TERMINAL_FONT_SIZE, terminalOptions } from './xtermTheme';

/**
 * One xterm instance per terminal panel, kept outside React: the same terminal moves between
 * the canvas, focus mode and back without losing state. Output arrives with absolute offsets so
 * a late-created instance can replay the main-process buffer without duplicating anything.
 */
interface Entry {
  id: string;
  term: Terminal;
  fit: FitAddon;
  host: HTMLDivElement;
  opened: boolean;
  webgl: WebglAddon | null;
  /** Absolute offset of the last output character written. -1 until the replay arrives. */
  end: number;
  queue: TerminalDataEvent[];
  sent: { cols: number; rows: number } | null;
}

const entries = new Map<string, Entry>();
let focusedId: string | null = null;
let focusModeId: string | null = null;
let installed = false;
const fontReady = document.fonts.load(`${TERMINAL_FONT_SIZE}px "Geist Mono Variable"`);

function write(entry: Entry, event: TerminalDataEvent): void {
  const skip = entry.end - event.start;
  if (skip >= event.data.length) return;
  entry.term.write(skip > 0 ? event.data.slice(skip) : event.data);
  entry.end = event.start + event.data.length;
}

function install(): void {
  if (installed) return;
  installed = true;
  window.plancia.terminal.onData((event) => {
    const entry = entries.get(event.id);
    if (!entry) return;
    if (entry.end < 0) entry.queue.push(event);
    else write(entry, event);
  });
}

function create(id: string): Entry {
  install();
  const term = new Terminal(terminalOptions);
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(
    new WebLinksAddon((event, uri) => {
      event.preventDefault();
      void window.plancia.app.openExternal(uri);
    }),
  );
  const host = document.createElement('div');
  host.className = 'h-full w-full';
  const entry: Entry = {
    id,
    term,
    fit,
    host,
    opened: false,
    webgl: null,
    end: -1,
    queue: [],
    sent: null,
  };

  term.onData((data) => window.plancia.terminal.write(id, data));
  void window.plancia.terminal.snapshot(id).then((snapshot) => {
    if (snapshot) {
      term.write(snapshot.data);
      entry.end = snapshot.end;
    } else {
      entry.end = 0;
    }
    for (const event of entry.queue.splice(0)) write(entry, event);
  });
  entries.set(id, entry);
  return entry;
}

function get(id: string): Entry {
  return entries.get(id) ?? create(id);
}

function sendSize(entry: Entry): void {
  const { cols, rows } = entry.term;
  if (entry.sent?.cols === cols && entry.sent.rows === rows) return;
  entry.sent = { cols, rows };
  window.plancia.terminal.resize(entry.id, cols, rows);
}

// WebGL contexts are scarce in Chromium: only the focused terminal and the one in focus mode get one.
function applyRenderers(): void {
  for (const entry of entries.values()) {
    const wanted = entry.opened && (entry.id === focusedId || entry.id === focusModeId);
    if (wanted && !entry.webgl) {
      try {
        const addon = new WebglAddon();
        addon.onContextLoss(() => {
          addon.dispose();
          if (entry.webgl === addon) entry.webgl = null;
        });
        entry.term.loadAddon(addon);
        entry.webgl = addon;
      } catch {
        entry.webgl = null; // falls back to the DOM renderer
      }
    } else if (!wanted && entry.webgl) {
      entry.webgl.dispose();
      entry.webgl = null;
    }
  }
}

export const terminalRegistry = {
  /** Mounts the terminal into `container` (moving it from wherever it was). */
  async attach(id: string, container: HTMLElement): Promise<void> {
    const entry = get(id);
    await fontReady;
    if (!container.isConnected) return;
    container.appendChild(entry.host);
    if (!entry.opened) {
      entry.term.open(entry.host);
      entry.opened = true;
      entry.term.textarea?.addEventListener('focus', () => {
        focusedId = id;
        applyRenderers();
      });
      entry.term.textarea?.addEventListener('blur', () => {
        if (focusedId === id) focusedId = null;
        applyRenderers();
      });
    }
    this.fit(id);
    applyRenderers();
  },

  detach(id: string, container: HTMLElement): void {
    const entry = entries.get(id);
    if (entry && entry.host.parentElement === container) container.removeChild(entry.host);
  },

  fit(id: string): void {
    const entry = entries.get(id);
    if (!entry?.opened || !entry.host.isConnected) return;
    const dims = entry.fit.proposeDimensions();
    if (!dims || !Number.isFinite(dims.cols) || dims.cols < 2 || dims.rows < 1) return;
    entry.fit.fit();
    sendSize(entry);
  },

  /** Best current size estimate for starting a process. */
  size(id: string): { cols: number; rows: number } {
    const entry = entries.get(id);
    return entry?.opened
      ? { cols: entry.term.cols, rows: entry.term.rows }
      : { cols: 100, rows: 30 };
  },

  focus(id: string): void {
    entries.get(id)?.term.focus();
  },

  setFocusMode(id: string | null): void {
    focusModeId = id;
    applyRenderers();
  },

  /** Plain-text tail of the screen, for the low-zoom preview. */
  lastLines(id: string, count: number): string[] {
    const entry = entries.get(id);
    if (!entry) return [];
    const buffer = entry.term.buffer.active;
    const lines: string[] = [];
    for (let i = buffer.length - 1; i >= 0 && lines.length < count + 20; i--) {
      lines.unshift(buffer.getLine(i)?.translateToString(true) ?? '');
    }
    while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') lines.pop();
    return lines.slice(-count);
  },

  dispose(id: string): void {
    const entry = entries.get(id);
    if (!entry) return;
    entry.webgl?.dispose();
    entry.term.dispose();
    entry.host.remove();
    entries.delete(id);
    if (focusedId === id) focusedId = null;
  },

  /** Drops instances whose panel no longer exists. */
  retain(ids: Set<string>): void {
    for (const id of [...entries.keys()]) if (!ids.has(id)) this.dispose(id);
  },
};
