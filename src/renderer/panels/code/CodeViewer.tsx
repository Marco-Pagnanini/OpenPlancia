import Editor, { DiffEditor } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { useEffect, useRef } from 'react';
import { EDITOR_OPTIONS } from '../../editor/monaco';

/**
 * The app ships only Monaco's generic worker. Colouring needs no worker; hovers, diagnostics and
 * the like would ask for the language workers, so they are off: this viewer is read-only.
 */
const workerFeaturesOff = {
  completionItems: false,
  hovers: false,
  documentSymbols: false,
  documentHighlights: false,
  rename: false,
  diagnostics: false,
  documentRangeFormattingEdits: false,
} as const;
monaco.typescript.typescriptDefaults.setModeConfiguration({
  ...workerFeaturesOff,
  definitions: false,
  references: false,
  signatureHelp: false,
  onTypeFormattingEdits: false,
  codeActions: false,
  inlayHints: false,
});
monaco.typescript.javascriptDefaults.setModeConfiguration({
  ...workerFeaturesOff,
  definitions: false,
  references: false,
  signatureHelp: false,
  onTypeFormattingEdits: false,
  codeActions: false,
  inlayHints: false,
});
for (const defaults of [monaco.css.cssDefaults, monaco.css.scssDefaults, monaco.css.lessDefaults]) {
  defaults.setModeConfiguration({
    ...workerFeaturesOff,
    definitions: false,
    references: false,
    colors: false,
    foldingRanges: false,
    selectionRanges: false,
    documentFormattingEdits: false,
  });
}
monaco.html.htmlDefaults.setModeConfiguration({
  ...workerFeaturesOff,
  links: false,
  colors: false,
  foldingRanges: false,
  selectionRanges: false,
  documentFormattingEdits: false,
});
monaco.json.jsonDefaults.setModeConfiguration({
  completionItems: false,
  hovers: false,
  documentSymbols: false,
  diagnostics: false,
  documentFormattingEdits: false,
  documentRangeFormattingEdits: false,
  colors: false,
  foldingRanges: false,
  selectionRanges: false,
  tokens: true,
});

/** Monaco language for a file, from its extension or name (plaintext otherwise). */
function languageOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : '';
  const match = monaco.languages
    .getLanguages()
    .find((l) => (ext && l.extensions?.includes(ext)) || l.filenames?.includes(name));
  return match?.id ?? 'plaintext';
}

const VIEW_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  ...EDITOR_OPTIONS,
  readOnly: true,
  domReadOnly: true,
  wordWrap: 'off',
  renderValidationDecorations: 'off',
};

/** Read-only file, or its diff against git HEAD (spec §8.4). Loaded lazily. */
export default function CodeViewer({
  path,
  content,
  head,
  mode,
}: {
  path: string;
  content: string;
  head: string | null;
  mode: 'file' | 'diff';
}) {
  const language = languageOf(path);
  const loading = <span className="text-xs text-ink-4">Caricamento editor…</span>;
  // @monaco-editor/react disposes the diff models while the widget still holds them ("TextModel
  // got disposed before DiffEditorWidget model got reset"). This cleanup runs before the
  // library's (parent before child): detach the models here, dispose them right after.
  const diffEditor = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  useEffect(
    () => () => {
      const editor = diffEditor.current;
      const models = editor?.getModel();
      if (!editor || !models) return;
      editor.setModel(null);
      setTimeout(() => {
        models.original.dispose();
        models.modified.dispose();
      }, 0);
    },
    [],
  );
  if (mode === 'diff') {
    return (
      <DiffEditor
        keepCurrentOriginalModel
        keepCurrentModifiedModel
        onMount={(editor) => {
          diffEditor.current = editor;
        }}
        original={head ?? ''}
        modified={content}
        language={language}
        theme="plancia-dark"
        loading={loading}
        options={{
          ...VIEW_OPTIONS,
          originalEditable: false,
          renderOverviewRuler: false,
          useInlineViewWhenSpaceIsLimited: true,
          hideUnchangedRegions: { enabled: true },
        }}
      />
    );
  }
  return (
    <Editor
      value={content}
      language={language}
      theme="plancia-dark"
      loading={loading}
      options={VIEW_OPTIONS}
    />
  );
}
