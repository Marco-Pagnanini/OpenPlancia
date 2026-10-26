import { useArchitectureStore } from './architectureStore';
import { useCodeStore } from './codeStore';
import { useFolderStore } from './folderStore';
import { useMarkdownStore } from './markdownStore';
import { useWorkspaceStore } from './workspaceStore';

/**
 * "Sync" in the top bar: the main process reloads folders and files, sends the board again and
 * gives every agent its whole context at its next prompt or tool call; then every panel here
 * reloads what it shows. Unsaved edits are left alone. Returns the running agents.
 */
export async function resyncBoard(): Promise<number> {
  const { agents } = await window.plancia.workspace.sync();
  const panels = new Set(useWorkspaceStore.getState().snapshot?.board.panels.map((p) => p.id));
  const onBoard = (key: string) => panels.has(key.split('::')[0] ?? key);

  const markdown = useMarkdownStore.getState();
  for (const key of Object.keys(markdown.docs)) {
    if (onBoard(key) && markdown.drafts[key] === undefined) void markdown.load(key);
  }
  const architecture = useArchitectureStore.getState();
  for (const id of Object.keys(architecture.docs)) {
    if (panels.has(id) && !architecture.pending[id]) void architecture.load(id);
  }
  const folders = useFolderStore.getState();
  for (const id of Object.keys(folders.indexes)) if (panels.has(id)) void folders.load(id);
  const code = useCodeStore.getState();
  useCodeStore.setState({ feed: await window.plancia.code.feed() });
  for (const path of Object.keys(code.files)) void code.load(path);
  return agents;
}
