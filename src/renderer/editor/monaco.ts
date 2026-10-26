import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';

/**
 * Monaco is bundled with the app (no CDN: the CSP forbids it and the app must work offline).
 * Markdown needs no language worker; the generic editor worker covers every label.
 */
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

monaco.editor.defineTheme('plancia-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'keyword', foreground: 'd98a6b' },
    { token: 'string', foreground: 'a9c49b' },
    { token: 'number', foreground: 'e0a27e' },
    { token: 'comment', foreground: '6f6e68', fontStyle: 'italic' },
    { token: 'strong', fontStyle: 'bold' },
    { token: 'emphasis', fontStyle: 'italic' },
    { token: 'variable', foreground: 'eba58b' },
  ],
  colors: {
    'editor.background': '#181817',
    'editor.foreground': '#e4e2da',
    'editorLineNumber.foreground': '#5a5953',
    'editorLineNumber.activeForeground': '#a3a29b',
    'editorCursor.foreground': '#d97757',
    'editor.selectionBackground': '#d9775744',
    'editor.inactiveSelectionBackground': '#d9775722',
    'editor.lineHighlightBackground': '#1f1f1d',
    'editorIndentGuide.background1': '#2a2a27',
    'editorWidget.background': '#1a1a19',
    'editorWidget.border': '#34342f',
    'input.background': '#111110',
    focusBorder: '#d9775799',
    'scrollbarSlider.background': '#34342f88',
    'scrollbarSlider.hoverBackground': '#45443faa',
    // Diffs of the Code panel: the theme's green and red, not the default neon.
    'diffEditor.insertedLineBackground': '#7fb59b14',
    'diffEditor.insertedTextBackground': '#7fb59b33',
    'diffEditor.removedLineBackground': '#e39a8714',
    'diffEditor.removedTextBackground': '#e39a8738',
    'diffEditor.diagonalFill': '#2c2c2966',
    'diffEditorGutter.insertedLineBackground': '#7fb59b22',
    'diffEditorGutter.removedLineBackground': '#e39a8722',
  },
});

loader.config({ monaco });

export const EDITOR_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  fontFamily: '"Geist Mono Variable", ui-monospace, Menlo, monospace',
  fontSize: 13,
  lineHeight: 20,
  minimap: { enabled: false },
  wordWrap: 'on',
  scrollBeyondLastLine: false,
  automaticLayout: true,
  padding: { top: 12, bottom: 12 },
  renderLineHighlight: 'line',
  lineNumbersMinChars: 3,
  overviewRulerLanes: 0,
  scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
  fixedOverflowWidgets: true,
};
