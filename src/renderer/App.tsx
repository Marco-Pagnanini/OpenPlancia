import { ReactFlowProvider } from '@xyflow/react';
import { useEffect } from 'react';
import { Canvas } from './canvas/Canvas';
import { EmptyState } from './components/EmptyState';
import { ErrorToast } from './components/ErrorToast';
import { useActivityStore } from './stores/activityStore';
import { useConnectionStore } from './stores/connectionStore';
import { useMarkdownStore } from './stores/markdownStore';
import { useTerminalStore } from './stores/terminalStore';
import { useWorkspaceStore } from './stores/workspaceStore';

export function App() {
  const loaded = useWorkspaceStore((s) => s.loaded);
  const root = useWorkspaceStore((s) => s.snapshot?.root);
  const init = useWorkspaceStore((s) => s.init);

  useEffect(() => init(), [init]);
  useEffect(() => useTerminalStore.getState().init(), []);
  useEffect(() => useActivityStore.getState().init(), []);
  useEffect(() => useMarkdownStore.getState().init(), []);
  useEffect(() => useConnectionStore.getState().init(), []);

  if (!loaded) return null;

  return (
    <>
      {root ? (
        // Remount per workspace so the saved viewport is applied as the initial one.
        <ReactFlowProvider key={root}>
          <Canvas />
        </ReactFlowProvider>
      ) : (
        <EmptyState />
      )}
      <ErrorToast />
    </>
  );
}
