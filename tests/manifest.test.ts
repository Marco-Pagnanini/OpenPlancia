import { describe, expect, it } from 'vitest';
import type { Connection, Panel } from '@shared/types';
import {
  collectManifestEntries,
  describeChanges,
  manifestState,
  ManifestTracker,
  MANIFEST_INLINE_LIMIT,
  renderManifest,
  type ManifestEntry,
} from '../src/main/claude/manifest';

const agents: ManifestEntry = {
  id: 'md-3f2a',
  type: 'markdown',
  title: 'AGENTS.md',
  filePath: 'AGENTS.md',
  access: { read: true, write: false },
  version: 7,
  content: '# Regole\n- usa sempre pnpm\n',
};
const backend: ManifestEntry = {
  id: 'arch-91c0',
  type: 'architecture',
  title: 'Backend v1',
  access: { read: true, write: true },
  version: 3,
};

describe('renderManifest', () => {
  it('follows the spec format, with readable content inline', () => {
    expect(renderManifest([agents, backend])).toBe(
      [
        'OpenPlancia — panel collegati a questa sessione:',
        '- md-3f2a "AGENTS.md" (markdown, file AGENTS.md) · accesso: lettura · versione 7',
        '- arch-91c0 "Backend v1" (architecture, JSON ArchitectureDoc) · accesso: lettura e scrittura · versione 3',
        'I contenuti si leggono con mcp__plancia__read_panel e si modificano con mcp__plancia__write_panel.',
        '',
        'Contenuti non inclusi qui, disponibili via mcp__plancia__read_panel: "Backend v1" (versione 3).',
        '',
        '=== AGENTS.md (versione 7) ===',
        '# Regole',
        '- usa sempre pnpm',
      ].join('\n'),
    );
  });

  it('inlines an architecture as the JSON Claude receives', () => {
    const json = '{"schemaVersion":1,"title":"Backend v1",\n"nodes":[],\n"edges":[]}';
    const text = renderManifest([{ ...backend, content: json }]);
    expect(text).toContain(`=== Backend v1 (versione 3) ===\n${json}`);
  });

  it('never inlines write-only panels', () => {
    const text = renderManifest([{ ...agents, access: { read: false, write: true } }]);
    expect(text).toContain('accesso: scrittura');
    expect(text).not.toContain('usa sempre pnpm');
  });

  it('stays under the limit, inlining smaller panels first', () => {
    const big = (id: string, size: number): ManifestEntry => ({
      ...agents,
      id,
      title: `${id}.md`,
      filePath: `${id}.md`,
      content: 'x'.repeat(size),
    });
    const text = renderManifest([big('grande', 6000), big('piccolo', 1000), big('medio', 3000)]);
    expect(text.length).toBeLessThanOrEqual(MANIFEST_INLINE_LIMIT);
    expect(text).toContain('=== piccolo.md');
    expect(text).toContain('=== medio.md');
    expect(text).not.toContain('=== grande.md');
    expect(text).toContain('disponibili via mcp__plancia__read_panel: "grande.md" (versione 7)');
  });

  it('opens with what changed when given changes', () => {
    expect(renderManifest([agents], ['AGENTS.md (v6 → v7)'])).toMatch(
      /^Modificato dall'ultimo messaggio: AGENTS\.md \(v6 → v7\)\n\nOpenPlancia — panel collegati/,
    );
  });

  it('says plainly when nothing is linked anymore', () => {
    expect(renderManifest([])).toBe('');
    expect(renderManifest([], ['connessione rimossa: AGENTS.md'])).toContain(
      'nessun panel è collegato a questa sessione',
    );
  });
});

describe('describeChanges', () => {
  const state = (entries: ManifestEntry[]) => manifestState(entries);

  it('reports new, removed and changed arrows and new versions of readable panels', () => {
    expect(
      describeChanges(
        state([agents, backend]),
        state([
          { ...agents, version: 8 },
          { ...backend, access: { read: true, write: false }, version: 4 },
        ]),
      ),
    ).toEqual([
      'AGENTS.md (v7 → v8)',
      'accesso a Backend v1: lettura e scrittura → lettura',
      'Backend v1 (v3 → v4)',
    ]);
    expect(describeChanges(state([agents]), state([backend]))).toEqual([
      'nuova connessione: Backend v1 (lettura e scrittura)',
      'connessione rimossa: AGENTS.md',
    ]);
  });

  it('ignores version changes of write-only panels', () => {
    const writeOnly = { ...agents, access: { read: false, write: true } };
    expect(describeChanges(state([writeOnly]), state([{ ...writeOnly, version: 9 }]))).toEqual([]);
  });
});

describe('ManifestTracker (injection only on change)', () => {
  it('injects at session start, then only when something changed', () => {
    const tracker = new ManifestTracker();
    expect(tracker.sessionStart('t1', [agents])).toContain('=== AGENTS.md (versione 7) ===');
    expect(tracker.prompt('t1', [agents])).toBeNull();
    const next = tracker.prompt('t1', [{ ...agents, version: 8 }]);
    expect(next).toMatch(/^Modificato dall'ultimo messaggio: AGENTS\.md \(v7 → v8\)/);
    expect(tracker.prompt('t1', [{ ...agents, version: 8 }])).toBeNull();
  });

  it('injects nothing at start when no panel is linked', () => {
    const tracker = new ManifestTracker();
    expect(tracker.sessionStart('t1', [])).toBeNull();
    expect(tracker.prompt('t1', [])).toBeNull();
  });

  it('tells Claude when the last arrow is removed', () => {
    const tracker = new ManifestTracker();
    tracker.sessionStart('t1', [agents]);
    expect(tracker.prompt('t1', [])).toContain('connessione rimossa: AGENTS.md');
    expect(tracker.prompt('t1', [])).toBeNull();
  });

  it('treats a terminal it never saw start (OpenPlancia restarted) as starting from nothing', () => {
    const tracker = new ManifestTracker();
    expect(tracker.prompt('t1', [agents])).toContain('nuova connessione: AGENTS.md (lettura)');
  });
});

describe('collectManifestEntries', () => {
  const base = {
    position: { x: 0, y: 0 },
    size: { width: 1, height: 1 },
    version: 2,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const panels: Panel[] = [
    {
      ...base,
      id: 't1',
      title: 'Claude',
      type: 'terminal',
      mode: 'claude',
      cwd: '.',
      status: 'idle',
    },
    { ...base, id: 'md', title: 'AGENTS.md', type: 'markdown', filePath: 'AGENTS.md' },
    { ...base, id: 'out', title: 'OUT.md', type: 'markdown', filePath: 'OUT.md' },
    { ...base, id: 'free', title: 'FREE.md', type: 'markdown', filePath: 'FREE.md' },
  ];
  const connections: Connection[] = [
    { id: 'a', source: 'md', target: 't1', createdAt: base.updatedAt },
    { id: 'b', source: 't1', target: 'out', createdAt: base.updatedAt },
  ];

  it('reads content only for panels Claude may read', async () => {
    const read: string[] = [];
    const entries = await collectManifestEntries('t1', panels, connections, async (p) => {
      read.push(p.id);
      return `contenuto di ${p.id}`;
    });
    expect(read).toEqual(['md']);
    expect(entries.map((e) => [e.id, e.content])).toEqual([
      ['md', 'contenuto di md'],
      ['out', undefined],
    ]);
  });
});
