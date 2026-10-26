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
  /** Folder panels: the folder, relative to the root. */
  dirPath?: string | undefined;
  access: Access;
  version: number;
  /** Text Claude may see inline: only for readable panels whose content can be inlined. */
  content?: string | undefined;
  /** Folder panels: version of each file, to tell which ones changed. */
  files?: Record<string, number> | undefined;
}

/** Agents this session may message, and the ones that may message it (M8), by name. */
export interface AgentLinkNames {
  to: string[];
  from: string[];
}

const NO_AGENTS: AgentLinkNames = { to: [], from: [] };

function renderAgents({ to, from }: AgentLinkNames): string {
  if (to.length === 0 && from.length === 0) return '';
  const list = (names: string[]) => names.map((n) => `"${n}"`).join(', ');
  return [
    'OpenPlancia — agenti collegati a questa sessione (messaggi tra sessioni di Claude Code):',
    ...(to.length > 0 ? [`- puoi scrivere con SendMessage a: ${list(to)}`] : []),
    ...(from.length > 0 ? [`- possono scriverti: ${list(from)}`] : []),
    'I messaggi verso altre sessioni sono bloccati da OpenPlancia; i tuoi subagent restano raggiungibili.',
  ].join('\n');
}

const TOOLS_LINE =
  'I contenuti si leggono con mcp__plancia__read_panel e si modificano con mcp__plancia__write_panel.';

function describePanel(entry: ManifestEntry): string {
  const kind = entry.filePath
    ? `${entry.type}, file ${entry.filePath}`
    : entry.dirPath
      ? `folder, cartella ${entry.dirPath === '.' ? 'del progetto' : `${entry.dirPath}/`}, file .md`
      : entry.type === 'architecture'
        ? 'architecture, JSON ArchitectureDoc'
        : entry.type;
  return `- ${entry.id} "${entry.title}" (${kind}) · accesso: ${accessLabel(entry.access)} · versione ${entry.version}`;
}

function contentSection(entry: ManifestEntry): string {
  return `=== ${entry.title} (versione ${entry.version}) ===\n${(entry.content ?? '').replace(/\s+$/, '')}`;
}

/** Inline contents go in by increasing size while the whole text stays under the limit. */
export function renderManifest(
  entries: ManifestEntry[],
  changes: string[] = [],
  agents: AgentLinkNames = NO_AGENTS,
): string {
  const changeLine =
    changes.length > 0 ? `Modificato dall'ultimo messaggio: ${changes.join('; ')}\n\n` : '';
  const agentBlock = renderAgents(agents);
  if (entries.length === 0) {
    if (agentBlock) return changeLine + agentBlock;
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
  let length = changeLine.length + head.length + (agentBlock ? agentBlock.length + 2 : 0);
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
  if (agentBlock) parts.push(agentBlock);
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
  {
    title: string;
    version: number;
    read: boolean;
    write: boolean;
    files?: Record<string, number> | undefined;
  }
>;

export function manifestState(entries: ManifestEntry[]): ManifestState {
  return Object.fromEntries(
    entries.map((e) => [
      e.id,
      {
        title: e.title,
        version: e.version,
        read: e.access.read,
        write: e.access.write,
        files: e.files,
      },
    ]),
  );
}

/** "PLAN.md v6 → v7, nuovo adr/0003.md, rimosso old.md": what changed inside a folder. */
function describeFiles(before: Record<string, number>, after: Record<string, number>): string[] {
  const changes: string[] = [];
  for (const [path, version] of Object.entries(after)) {
    const old = before[path];
    if (old === undefined) changes.push(`nuovo ${path}`);
    else if (old !== version) changes.push(`${path} v${old} → v${version}`);
  }
  for (const path of Object.keys(before)) if (!(path in after)) changes.push(`rimosso ${path}`);
  return changes;
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
      const files = before.files && now.files ? describeFiles(before.files, now.files) : [];
      changes.push(
        files.length > 0
          ? `${now.title}: ${files.join(', ')}`
          : `${now.title} (v${before.version} → v${now.version})`,
      );
    }
  }
  for (const [id, before] of Object.entries(previous)) {
    if (!next[id]) changes.push(`connessione rimossa: ${before.title}`);
  }
  return changes;
}

/** "ora puoi scrivere a "Claude 2""; arrows between agents that appeared or went away. */
export function describeAgentChanges(before: AgentLinkNames, after: AgentLinkNames): string[] {
  const changes: string[] = [];
  const diff = (a: string[], b: string[]) => a.filter((x) => !b.includes(x));
  for (const n of diff(after.to, before.to)) changes.push(`ora puoi scrivere a "${n}"`);
  for (const n of diff(before.to, after.to)) changes.push(`non puoi più scrivere a "${n}"`);
  for (const n of diff(after.from, before.from)) changes.push(`"${n}" ora può scriverti`);
  for (const n of diff(before.from, after.from)) changes.push(`"${n}" non può più scriverti`);
  return changes;
}

/**
 * Decides when to inject (spec §7.4): always at SessionStart when something is linked; at
 * UserPromptSubmit only if the arrows or a readable panel's version changed since last time.
 */
export class ManifestTracker {
  private readonly last = new Map<string, { state: ManifestState; agents: AgentLinkNames }>();

  sessionStart(
    terminalId: string,
    entries: ManifestEntry[],
    agents: AgentLinkNames = NO_AGENTS,
  ): string | null {
    this.last.set(terminalId, { state: manifestState(entries), agents });
    const text = renderManifest(entries, [], agents);
    return text === '' ? null : text;
  }

  prompt(
    terminalId: string,
    entries: ManifestEntry[],
    agents: AgentLinkNames = NO_AGENTS,
  ): string | null {
    const next = manifestState(entries);
    const previous = this.last.get(terminalId) ?? { state: {}, agents: NO_AGENTS };
    const changes = [
      ...describeChanges(previous.state, next),
      ...describeAgentChanges(previous.agents, agents),
    ];
    if (changes.length === 0) return null;
    this.last.set(terminalId, { state: next, agents });
    return renderManifest(entries, changes, agents);
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
  fileVersions?: (panel: Panel) => Record<string, number> | undefined,
): Promise<ManifestEntry[]> {
  const linked = connectedPanels(terminalId, panels, connections);
  return Promise.all(
    linked.map(async ({ panel, access }) => ({
      id: panel.id,
      type: panel.type,
      title: panel.title,
      filePath: panel.type === 'markdown' ? panel.filePath : undefined,
      dirPath: panel.type === 'folder' ? panel.dirPath : undefined,
      access,
      version: panel.version,
      content: access.read ? await readContent(panel).catch(() => undefined) : undefined,
      files: panel.type === 'folder' ? fileVersions?.(panel) : undefined,
    })),
  );
}
