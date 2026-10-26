import type { ITerminalOptions } from '@xterm/xterm';

// Nerd Font fallbacks so prompt themes (powerlevel10k, starship…) show their icons.
export const TERMINAL_FONT =
  '"Geist Mono Variable", "MesloLGS NF", "Symbols Nerd Font Mono", "JetBrainsMono Nerd Font", "Hack Nerd Font", ui-monospace, Menlo, monospace';
export const TERMINAL_FONT_SIZE = 12.5;

/** Warm palette matching the app theme (index.css). */
export const terminalOptions: ITerminalOptions = {
  fontFamily: TERMINAL_FONT,
  fontSize: TERMINAL_FONT_SIZE,
  lineHeight: 1.2,
  cursorBlink: true,
  scrollback: 5000,
  // Option stays a normal modifier: Italian layouts need it for @ # [ ].
  macOptionIsMeta: false,
  allowProposedApi: false,
  theme: {
    background: '#181817',
    foreground: '#e4e2da',
    cursor: '#d97757',
    cursorAccent: '#181817',
    selectionBackground: 'rgba(217, 119, 87, 0.32)',
    black: '#2a2a27',
    red: '#e0786a',
    green: '#a9c49b',
    yellow: '#e0b97e',
    blue: '#8fa9c9',
    magenta: '#c49ac0',
    cyan: '#8fc3b8',
    white: '#d4d2ca',
    brightBlack: '#6f6e68',
    brightRed: '#eb9283',
    brightGreen: '#bcd6ae',
    brightYellow: '#ecc994',
    brightBlue: '#a7c0dc',
    brightMagenta: '#d6afd2',
    brightCyan: '#a6d4ca',
    brightWhite: '#ecebe6',
  },
};
