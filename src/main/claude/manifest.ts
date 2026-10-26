import { accessLabel, connectedPanels, type Access } from '@shared/access';
import type { Connection, Panel, PanelType } from '@shared/types';

/**
 * The manifest tells Claude which panels are linked to its session (spec §7.4). It is written
 * as facts, not orders, and injected through hookSpecificOutput.additionalContext.
 */

/** additionalContext strings are capped at 10,000 characters: stay well below. */
export const MANIFEST_INLINE_LIMIT = 9000;

export interface ManifestEntry {
  id: string;
  type: PanelType;
  title: string;
  filePath?: string | undefined;
  access: Access;
  version: number;
  /** Text Claude may see inline: only for readable panels whose content can be inlined. */
  content?: string | undefined;
}

const TOOLS_LINE =
  'I contenuti si leggono con mcp__plancia__read_panel e si modificano con mcp__plancia__write_panel.';

function describePanel(entry: ManifestEntry): string {
  const kind = entry.filePath
    ? `${entry.type}, file ${entry.filePath}`
    : entry.type === 'architecture'
      ? 'architecture, JSON ArchitectureDoc'
      : entry.type;
  return `- ${entry.id} "${entry.title}" (${kind}) · accesso: ${accessLabel(entry.access)} · versione ${entry.version}`;
}

function contentSection(entry: ManifestEntry): string {
  return `=== ${entry.title} (versione ${entry.version}) ===\n${(entry.content ?? '').replace(/\s+$/, '')}`;
}

/** Inline contents go in by increasing size while the whole text stays under the limit. */
export function renderManifest(entries: ManifestEntry[], changes: string[] = []): string {
  const changeLine =
    changes.length > 0 ? `Modificato dall'ultimo messaggio: ${changes.join('; ')}\n\n` : '';
  if (entries.length === 0) {
    return changes.length > 0
      ? `${changeLine}OpenPlancia — nessun panel è collegato a questa sessione. I contenuti dei panel ricevuti in precedenza non sono più accessibili e possono non essere aggiornati.`
      : '';
  }

  const head = [
    'OpenPlancia — panel collegati a questa sessione:',
    ...entries.map(describePanel),
    TOOLS_LINE,
  ].join('\n');

  const readable = entries.filter((e) => e.access.read);
  const inlinable = readable
    .filter((e) => e.content !== undefined)
    .sort((a, b) => (a.content?.length ?? 0) - (b.content?.length ?? 0));

  const sections: string[] = [];
  const omitted: ManifestEntry[] = readable.filter((e) => e.content === undefined);
  let length = changeLine.length + head.length;
  const omittedLineReserve = 160;
  for (const entry of inlinable) {
    const section = contentSection(entry);
    if (length + 2 + section.length + omittedLineReserve <= MANIFEST_INLINE_LIMIT) {
      sections.push(section);
      length += 2 + section.length;
    } else {
      omitted.push(entry);
    }
  }

  const parts = [changeLine + head];
  if (omitted.length > 0) {
    const names = omitted.map((e) => `"${e.title}" (versione ${e.version})`).join(', ');
    parts.push(`Contenuti non inclusi qui, disponibili via mcp__plancia__read_panel: ${names}.`);
  }
  parts.push(...sections);
  return parts.join('\n\n');
}

/** What the last injected manifest said, per panel. */
export type ManifestState = Record<
  string,
  { title: string; version: number; read: boolean; write: boolean }
>;

export function manifestState(entries: ManifestEntry[]): ManifestState {
  return Object.fromEntries(
    entries.map((e) => [
      e.id,
      { title: e.title, version: e.version, read: e.access.read, write: e.access.write },
    ]),
  );
}

/** Differences that matter to Claude: arrows added/removed/changed, new versions of readable panels. */
export function describeChanges(previous: ManifestState, next: ManifestState): string[] {
  const changes: string[] = [];
  for (const [id, now] of Object.entries(next)) {
    const before = previous[id];
    if (!before) {
      changes.push(`nuova connessione: ${now.title} (${accessLabel(now)})`);
      continue;
    }
    if (before.read !== now.read || before.write !== now.write) {
      changes.push(`accesso a ${now.title}: ${accessLabel(before)} → ${accessLabel(now)}`);
    }
    if (now.read && before.version !== now.version) {
      changes.push(`${now.title} (v${before.version} → v${now.version})`);
    }
  }
  for (const [id, before] of Object.entries(previous)) {
    if (!next[id]) changes.push(`connessione rimossa: ${before.title}`);
  }
  return changes;
}

/**
 * Decides when to inject (spec §7.4): always at SessionStart when something is linked; at
 * UserPromptSubmit only if the arrows or a readable panel's version changed since last time.
 */
export class ManifestTracker {
  private readonly last = new Map<string, ManifestState>();

  sessionStart(terminalId: string, entries: ManifestEntry[]): string | null {
    this.last.set(terminalId, manifestState(entries));
    return entries.length > 0 ? renderManifest(entries) : null;
  }

  prompt(terminalId: string, entries: ManifestEntry[]): string | null {
    const next = manifestState(entries);
    const changes = describeChanges(this.last.get(terminalId) ?? {}, next);
    if (changes.length === 0) return null;
    this.last.set(terminalId, next);
    return renderManifest(entries, changes);
  }

  forget(terminalId: string): void {
    this.last.delete(terminalId);
  }
}

/** Builds the entries for a terminal from the board; `readContent` gives inline text (markdown). */
export async function collectManifestEntries(
  terminalId: string,
  panels: Panel[],
  connections: Connection[],
  readContent: (panel: Panel) => Promise<string | undefined>,
): Promise<ManifestEntry[]> {
  const linked = connectedPanels(terminalId, panels, connections);
  return Promise.all(
    linked.map(async ({ panel, access }) => ({
      id: panel.id,
      type: panel.type,
      title: panel.title,
      filePath: panel.type === 'markdown' ? panel.filePath : undefined,
      access,
      version: panel.version,
      content: access.read ? await readContent(panel).catch(() => undefined) : undefined,
    })),
  );
}
