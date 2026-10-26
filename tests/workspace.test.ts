import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceSnapshot } from '@shared/types';
import { loadSettings } from '../src/main/settings/AppSettings';
import { BoardFileError, boardFilePath, readBoardFile } from '../src/main/workspace/boardFile';
import { WorkspaceService } from '../src/main/workspace/WorkspaceService';

let dir: string;
let project: string;
let settingsFile: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'plancia-test-'));
  project = join(dir, 'progetto');
  await mkdir(project);
  settingsFile = join(dir, 'userData', 'settings.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeService(onState = vi.fn<(s: WorkspaceSnapshot | null) => void>()) {
  return { service: new WorkspaceService({ settingsFile, onState, saveDelayMs: 10 }), onState };
}

describe('readBoardFile', () => {
  it('returns an empty board when the file is missing', async () => {
    await expect(readBoardFile(project)).resolves.toEqual({
      schemaVersion: 1,
      panels: [],
      connections: [],
    });
  });

  it('rejects invalid JSON with a readable message', async () => {
    await mkdir(join(project, '.plancia'));
    await writeFile(boardFilePath(project), '{ nope');
    await expect(readBoardFile(project)).rejects.toThrow(/non è JSON valido/);
  });

  it('rejects boards that do not match the schema', async () => {
    await mkdir(join(project, '.plancia'));
    await writeFile(
      boardFilePath(project),
      JSON.stringify({ schemaVersion: 1, panels: [{ id: 'x', type: 'nope' }], connections: [] }),
    );
    await expect(readBoardFile(project)).rejects.toBeInstanceOf(BoardFileError);
  });

  it('rejects boards from a newer schema version', async () => {
    await mkdir(join(project, '.plancia'));
    await writeFile(
      boardFilePath(project),
      JSON.stringify({ schemaVersion: 99, panels: [], connections: [] }),
    );
    await expect(readBoardFile(project)).rejects.toThrow(/più recente/);
  });
});

describe('WorkspaceService', () => {
  it('saves the layout and restores it on the next launch (M1 acceptance)', async () => {
    const first = makeService();
    await first.service.open(project);
    for (const panelType of ['terminal', 'markdown', 'architecture'] as const) {
      expect(
        first.service.dispatch({
          type: 'createPanel',
          panelType,
          position: { x: 0, y: 0 },
          ...(panelType === 'markdown' ? { filePath: 'AGENTS.md' } : {}),
        }),
      ).toEqual({ ok: true });
    }
    const [, md] = first.service.snapshot()!.board.panels;
    first.service.dispatch({
      type: 'movePanels',
      moves: [{ id: md!.id, position: { x: 700, y: 50 } }],
    });
    first.service.dispatch({ type: 'setViewport', viewport: { x: -10, y: 20, zoom: 0.75 } });
    await first.service.close();
    const saved = first.service.snapshot();
    expect(saved).toBeNull();

    // "Restart": a new service only knows the settings file.
    const second = makeService();
    const restored = await second.service.restoreLast();
    expect(restored?.name).toBe('progetto');
    const panels = restored!.board.panels;
    expect(panels.map((p) => p.type)).toEqual(['terminal', 'markdown', 'architecture']);
    expect(panels[1]!.position).toEqual({ x: 700, y: 50 });
    expect(restored!.board.viewport).toEqual({ x: -10, y: 20, zoom: 0.75 });
    expect(panels[0]).toMatchObject({ status: 'not-started' });

    const onDisk = JSON.parse(await readFile(boardFilePath(project), 'utf8'));
    expect(onDisk.panels[0]).not.toHaveProperty('status');
  });

  it('debounces saves', async () => {
    const { service } = makeService();
    await service.open(project);
    service.dispatch({ type: 'createPanel', panelType: 'code', position: { x: 0, y: 0 } });
    await expect(readFile(boardFilePath(project), 'utf8')).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 50));
    const onDisk = JSON.parse(await readFile(boardFilePath(project), 'utf8'));
    expect(onDisk.panels).toHaveLength(1);
  });

  it('broadcasts snapshots except for viewport changes', async () => {
    const { service, onState } = makeService();
    await service.open(project);
    expect(onState).toHaveBeenCalledTimes(1);
    service.dispatch({ type: 'createPanel', panelType: 'code', position: { x: 0, y: 0 } });
    expect(onState).toHaveBeenCalledTimes(2);
    service.dispatch({ type: 'setViewport', viewport: { x: 0, y: 0, zoom: 1 } });
    expect(onState).toHaveBeenCalledTimes(2);
    await service.close({ notify: false });
  });

  it('validates intents coming from the renderer', async () => {
    const { service } = makeService();
    expect(service.dispatch({ type: 'createPanel' })).toMatchObject({ ok: false });
    await service.open(project);
    expect(service.dispatch({ type: 'createPanel', panelType: 'bogus' })).toMatchObject({
      ok: false,
    });
    expect(service.dispatch({ type: 'renamePanel', id: 'nope', title: 'x' })).toEqual({
      ok: false,
      error: 'Panel inesistente: nope',
    });
    await service.close({ notify: false });
  });

  it('refuses to open a folder with a corrupt board and keeps the previous one open', async () => {
    const { service } = makeService();
    await service.open(project);
    const broken = join(dir, 'rotto');
    await mkdir(join(broken, '.plancia'), { recursive: true });
    await writeFile(boardFilePath(broken), 'xx');
    await expect(service.open(broken)).rejects.toBeInstanceOf(BoardFileError);
    expect(service.snapshot()?.name).toBe('progetto');
    await service.close({ notify: false });
  });

  it('lists recent folders, goes home and reopens only known folders', async () => {
    const other = join(dir, 'altro');
    await mkdir(other);
    const { service, onState } = makeService();
    await service.open(project);
    await service.open(other);
    await service.open(project);
    expect((await service.recent()).map((r) => [r.name, r.exists])).toEqual([
      ['progetto', true],
      ['altro', true],
    ]);

    await service.goHome();
    expect(service.snapshot()).toBeNull();
    expect(onState).toHaveBeenLastCalledWith(null);
    expect((await loadSettings(settingsFile)).lastWorkspace).toBeUndefined();
    await expect(makeService().service.restoreLast()).resolves.toBeNull();

    const [, altro] = await service.recent();
    await expect(service.openRecent(altro!.path)).resolves.toMatchObject({ name: 'altro' });
    await expect(service.openRecent('/etc')).rejects.toThrow('non presente tra le recenti');
    await service.close({ notify: false });
  });

  it('forgets nothing when the last folder disappeared', async () => {
    const { service } = makeService();
    await service.open(project);
    await service.close();
    await rm(project, { recursive: true });
    await expect(makeService().service.restoreLast()).resolves.toBeNull();
    expect((await loadSettings(settingsFile)).lastWorkspace).toContain('progetto');
  });
});
