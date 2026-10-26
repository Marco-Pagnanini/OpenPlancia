import { z } from 'zod';

// The content of an Architecture panel (spec §5, "Documento Architettura"). Stored in
// .plancia/panels/<id>.arch.json and exchanged with Claude as JSON.

export const ARCH_SCHEMA_VERSION = 1;

/** Size of a node on the diagram, shared by the editor, the preview and the auto-layout. */
export const ARCH_NODE_SIZE = { width: 184, height: 64 } as const;

export const ARCH_LIMITS = { nodes: 200, edges: 400, text: 200, notes: 2000 } as const;

export const archNodeKindSchema = z.enum([
  'service',
  'database',
  'queue',
  'api',
  'client',
  'external',
  'storage',
  'other',
]);

const archIdSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/,
    'id: lettere, numeri, "-", "_" o ".", massimo 64 caratteri (es. "auth")',
  );
const finite = z.number().refine(Number.isFinite, 'Numero non finito');
const shortText = z.string().max(ARCH_LIMITS.text);

export const archNodeSchema = z.strictObject({
  id: archIdSchema,
  kind: archNodeKindSchema,
  label: shortText.trim().min(1, 'label: non può essere vuota'),
  tech: shortText.optional(),
  notes: z.string().max(ARCH_LIMITS.notes).optional(),
  position: z.strictObject({ x: finite, y: finite }).optional(),
});

export const archEdgeSchema = z.strictObject({
  id: archIdSchema,
  from: z.string(),
  to: z.string(),
  label: shortText.optional(),
  protocol: shortText.optional(),
});

export const architectureDocSchema = z
  .strictObject({
    schemaVersion: z.literal(ARCH_SCHEMA_VERSION),
    title: shortText,
    nodes: z.array(archNodeSchema).max(ARCH_LIMITS.nodes),
    edges: z.array(archEdgeSchema).max(ARCH_LIMITS.edges),
  })
  .superRefine((doc, ctx) => {
    const nodeIds = new Set<string>();
    doc.nodes.forEach((node, i) => {
      if (nodeIds.has(node.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', i, 'id'],
          message: `id del nodo ripetuto: "${node.id}"`,
        });
      }
      nodeIds.add(node.id);
    });
    const edgeIds = new Set<string>();
    doc.edges.forEach((edge, i) => {
      if (edgeIds.has(edge.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['edges', i, 'id'],
          message: `id della relazione ripetuto: "${edge.id}"`,
        });
      }
      edgeIds.add(edge.id);
      for (const end of ['from', 'to'] as const) {
        if (!nodeIds.has(edge[end])) {
          ctx.addIssue({
            code: 'custom',
            path: ['edges', i, end],
            message: `${end}: il nodo "${edge[end]}" non esiste`,
          });
        }
      }
    });
  });

export type ArchNodeKind = z.infer<typeof archNodeKindSchema>;
export type ArchNode = z.infer<typeof archNodeSchema>;
export type ArchEdge = z.infer<typeof archEdgeSchema>;
export type ArchitectureDoc = z.infer<typeof architectureDocSchema>;

export const ARCH_KIND_LABELS: Record<ArchNodeKind, string> = {
  service: 'Servizio',
  database: 'Database',
  queue: 'Coda',
  api: 'API',
  client: 'Client',
  external: 'Esterno',
  storage: 'Storage',
  other: 'Altro',
};

export function emptyArchitectureDoc(title: string): ArchitectureDoc {
  return { schemaVersion: ARCH_SCHEMA_VERSION, title, nodes: [], edges: [] };
}

export type ArchParseResult = { ok: true; doc: ArchitectureDoc } | { ok: false; error: string };

/** Validates a document from Claude or from disk; errors are readable, one per line. */
export function parseArchitectureDoc(input: unknown): ArchParseResult {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch (err) {
      return {
        ok: false,
        error: `Non è JSON valido: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
  const parsed = architectureDocSchema.safeParse(value);
  return parsed.success
    ? { ok: true, doc: parsed.data }
    : { ok: false, error: z.prettifyError(parsed.error) };
}

/** Positions are noise for Claude (spec §5): they are removed from what it reads. */
export function withoutPositions(doc: ArchitectureDoc): ArchitectureDoc {
  return {
    ...doc,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    nodes: doc.nodes.map(({ position, ...node }) => node),
  };
}

/**
 * The document exactly as Claude receives it: valid JSON without positions, one node or
 * relation per line. Readable like indented JSON, without paying tokens for indentation.
 */
export function formatArchitectureForClaude(doc: ArchitectureDoc): string {
  const { schemaVersion, title, nodes, edges } = withoutPositions(doc);
  const list = (items: unknown[]) =>
    items.length === 0 ? '[]' : `[\n${items.map((item) => JSON.stringify(item)).join(',\n')}\n]`;
  return `{"schemaVersion":${schemaVersion},"title":${JSON.stringify(title)},\n"nodes":${list(nodes)},\n"edges":${list(edges)}}`;
}

export interface ArchDiff {
  addedNodes: string[];
  removedNodes: ArchNode[];
  changedNodes: string[];
  addedEdges: string[];
  removedEdges: ArchEdge[];
}

const sameNode = (a: ArchNode, b: ArchNode) =>
  a.kind === b.kind &&
  a.label === b.label &&
  (a.tech ?? '') === (b.tech ?? '') &&
  (a.notes ?? '') === (b.notes ?? '');

const sameEdge = (a: ArchEdge, b: ArchEdge) =>
  a.from === b.from &&
  a.to === b.to &&
  (a.label ?? '') === (b.label ?? '') &&
  (a.protocol ?? '') === (b.protocol ?? '');

/** What changed between two versions, ignoring positions: used to highlight Claude's edits. */
export function diffArchitecture(before: ArchitectureDoc, after: ArchitectureDoc): ArchDiff {
  const oldNodes = new Map(before.nodes.map((n) => [n.id, n]));
  const newNodes = new Map(after.nodes.map((n) => [n.id, n]));
  const oldEdges = new Map(before.edges.map((e) => [e.id, e]));
  const newEdges = new Map(after.edges.map((e) => [e.id, e]));
  return {
    addedNodes: after.nodes.filter((n) => !oldNodes.has(n.id)).map((n) => n.id),
    removedNodes: before.nodes.filter((n) => !newNodes.has(n.id)),
    changedNodes: after.nodes
      .filter((n) => {
        const old = oldNodes.get(n.id);
        return old !== undefined && !sameNode(old, n);
      })
      .map((n) => n.id),
    addedEdges: after.edges
      .filter((e) => {
        const old = oldEdges.get(e.id);
        return old === undefined || !sameEdge(old, e);
      })
      .map((e) => e.id),
    removedEdges: before.edges.filter((e) => !newEdges.has(e.id)),
  };
}

export function isEmptyDiff(diff: ArchDiff): boolean {
  return (
    diff.addedNodes.length +
      diff.removedNodes.length +
      diff.changedNodes.length +
      diff.addedEdges.length +
      diff.removedEdges.length ===
    0
  );
}

/** A free id for a new node or relation, based on a readable stem ("api", "api-2", …). */
export function freeArchId(stem: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    stem
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'nodo';
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}
