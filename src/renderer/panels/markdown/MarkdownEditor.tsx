import Editor from '@monaco-editor/react';
import { EDITOR_OPTIONS } from '../../editor/monaco';
import * as monaco from 'monaco-editor';

/** Monaco for markdown. Loaded lazily: the editor bundle is large. */
export default function MarkdownEditor({
  value,
  onChange,
  onSave,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <Editor
      language="markdown"
      theme="plancia-dark"
      value={value}
      options={EDITOR_OPTIONS}
      onChange={(next) => onChange(next ?? '')}
      onMount={(editor) => {
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, onSave);
        editor.focus();
      }}
      loading={<span className="text-xs text-ink-4">Caricamento editor…</span>}
    />
  );
}
