import { describe, expect, it } from 'vitest';
import {
  accessFor,
  accessLabel,
  agentLinks,
  agentPairs,
  checkConnection,
  connectedPanels,
  isConnectable,
  wirePairs,
} from '@shared/access';
import type { Connection, Panel } from '@shared/types';

const base = {
  position: { x: 0, y: 0 },
  size: { width: 100, height: 100 },
  version: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const claude = (id: string): Panel => ({
  ...base,
  id,
  title: id,
  type: 'terminal',
  mode: 'claude',
  cwd: '.',
  status: 'idle',
});
const shell: Panel = {
  ...base,
  id: 'sh',
  title: 'sh',
  type: 'terminal',
  mode: 'shell',
  cwd: '.',
  status: 'idle',
};
const md: Panel = {
  ...base,
  id: 'md',
  title: 'AGENTS.md',
  type: 'markdown',
  filePath: 'AGENTS.md',
};
const md2: Panel = { ...base, id: 'md2', title: 'NOTE.md', type: 'markdown', filePath: 'NOTE.md' };
const arch: Panel = { ...base, id: 'arch', title: 'Backend', type: 'architecture' };
const code: Panel = { ...base, id: 'code', title: 'Codice', type: 'code', follow: 'all-agents' };
const c1 = claude('c1');
const c2 = claude('c2');

const conn = (source: string, target: string, id = `${source}>${target}`): Connection => ({
  id,
  source,
  target,
  createdAt: base.updatedAt,
});

describe('checkConnection (spec §6 table)', () => {
  const cases: [string, Panel | undefined, Panel | undefined, true | string][] = [
    ['markdown → Claude (read)', md, c1, true],
    ['Claude → markdown (write)', c1, md, true],
    ['architecture → Claude (read)', arch, c1, true],
    ['Claude → architecture (write)', c1, arch, true],
    ['anything → code', c1, code, 'code-panel'],
    ['code → anything', code, c1, 'code-panel'],
    ['markdown → shell', md, shell, 'shell-terminal'],
    ['shell → markdown', shell, md, 'shell-terminal'],
    ['Claude → shell', c1, shell, 'shell-terminal'],
    ['Claude → Claude (M8: may message)', c1, c2, true],
    ['markdown → architecture', md, arch, 'data-to-data'],
    ['markdown → markdown', md, md2, 'data-to-data'],
    ['panel → itself', c1, c1, 'same-panel'],
    ['unknown panel', md, undefined, 'unknown-panel'],
  ];
  it.each(cases)('%s', (_name, source, target, expected) => {
    const result = checkConnection(source, target, []);
    if (expected === true) expect(result).toEqual({ ok: true });
    else expect(result).toMatchObject({ ok: false, reason: expected });
  });

  it('refuses duplicates but allows the opposite direction', () => {
    const existing = [conn('md', 'c1')];
    expect(checkConnection(md, c1, existing)).toMatchObject({ ok: false, reason: 'duplicate' });
    expect(checkConnection(c1, md, existing)).toEqual({ ok: true });
  });
});

describe('arrows between agents (M8)', () => {
  const c3 = claude('c3');
  const panels = [c1, c2, c3, md];
  const connections = [conn('c1', 'c2'), conn('c2', 'c1'), conn('c3', 'c1'), conn('md', 'c1')];

  it('groups them per pair of terminals, apart from the panel wires', () => {
    expect(agentPairs(panels, connections)).toEqual([
      {
        key: 'agents:c1|c2',
        a: 'c1',
        b: 'c2',
        aToB: true,
        bToA: true,
        connectionIds: ['c1>c2', 'c2>c1'],
      },
      { key: 'agents:c1|c3', a: 'c1', b: 'c3', aToB: false, bToA: true, connectionIds: ['c3>c1'] },
    ]);
    expect(wirePairs(panels, connections).map((p) => p.key)).toEqual(['c1|md']);
  });

  it('tells each agent whom it may write to and who may write to it', () => {
    const links = agentLinks('c1', panels, connections);
    expect(links.to.map((p) => p.id)).toEqual(['c2']);
    expect(links.from.map((p) => p.id)).toEqual(['c2', 'c3']);
    expect(agentLinks('md', panels, connections)).toEqual({ to: [], from: [] });
  });
});

describe('accessFor', () => {
  it('derives read and write from the arrow direction', () => {
    expect(accessFor('c1', 'md', [])).toEqual({ read: false, write: false });
    expect(accessFor('c1', 'md', [conn('md', 'c1')])).toEqual({ read: true, write: false });
    expect(accessFor('c1', 'md', [conn('c1', 'md')])).toEqual({ read: false, write: true });
    expect(accessFor('c1', 'md', [conn('md', 'c1'), conn('c1', 'md')])).toEqual({
      read: true,
      write: true,
    });
  });

  it('is per terminal', () => {
    expect(accessFor('c2', 'md', [conn('md', 'c1')])).toEqual({ read: false, write: false });
  });
});

describe('wirePairs', () => {
  it('merges read + write between the same pair into one wire', () => {
    const pairs = wirePairs(
      [c1, c2, md, arch],
      [conn('md', 'c1', 'a'), conn('c1', 'md', 'b'), conn('c2', 'arch', 'c')],
    );
    expect(pairs).toEqual([
      {
        key: 'c1|md',
        terminalId: 'c1',
        panelId: 'md',
        read: true,
        write: true,
        connectionIds: ['a', 'b'],
      },
      {
        key: 'c2|arch',
        terminalId: 'c2',
        panelId: 'arch',
        read: false,
        write: true,
        connectionIds: ['c'],
      },
    ]);
  });

  it('ignores connections whose panels are gone or not Claude terminals', () => {
    expect(wirePairs([md], [conn('md', 'c1')])).toEqual([]);
  });
});

describe('connectedPanels', () => {
  it('lists data panels linked to a terminal with their access', () => {
    const list = connectedPanels('c1', [c1, md, md2, arch], [conn('md', 'c1'), conn('c1', 'arch')]);
    expect(list.map(({ panel, access }) => [panel.id, accessLabel(access)])).toEqual([
      ['md', 'lettura'],
      ['arch', 'scrittura'],
    ]);
  });
});

describe('isConnectable', () => {
  it('shows ports only on Claude terminals and data panels', () => {
    expect([c1, md, arch, shell, code].map(isConnectable)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });
});
