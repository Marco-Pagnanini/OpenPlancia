import { ArrowsLeftRightIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import {
  Background,
  BaseEdge,
  ConnectionMode,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useInternalNode,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
  type OnConnectEnd,
} from '@xyflow/react';
import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  ARCH_KIND_LABELS,
  ARCH_NODE_SIZE,
  freeArchId,
  type ArchDiff,
  type ArchEdge,
  type ArchitectureDoc,
  type ArchNode,
  type ArchNodeKind,
} from '@shared/architecture';
import { useArchitectureStore } from '../../stores/architectureStore';
import { ARCH_KIND_STYLE, ARCH_KINDS } from './archKinds';
import { borderPoint, edgeText } from './geometry';

const { width: W, height: H } = ARCH_NODE_SIZE;
/** Removed nodes fade out for this long before they leave the editor. */
const GHOST_MS = 1500;

type Point = { x: number; y: number };
interface NodeData extends Record<string, unknown> {
  node: ArchNode;
  highlight: boolean;
  ghost: boolean;
}
interface EdgeData extends Record<string, unknown> {
  edge: ArchEdge;
  highlight: boolean;
  ghost: boolean;
}
type ArchFlowNode = Node<NodeData, 'arch'>;
type ArchFlowEdge = Edge<EdgeData, 'arch'>;

const SIDES = [
  ['top', Position.Top],
  ['right', Position.Right],
  ['bottom', Position.Bottom],
  ['left', Position.Left],
] as const;

const HANDLE =
  '!size-2.5 !border-[1.5px] !border-panel !bg-ink-5 opacity-0 transition-opacity group-hover:opacity-100';

const ArchNodeView = memo(function ArchNodeView({ data, selected }: NodeProps<ArchFlowNode>) {
  const { node, highlight, ghost } = data;
  const { icon: Icon, color } = ARCH_KIND_STYLE[node.kind];
  return (
    <div
      style={{ width: W, height: H, borderColor: selected ? 'var(--color-accent)' : `${color}99` }}
      className={`group relative flex items-center gap-3 rounded-[10px] border bg-panel-head pr-3 pl-3.5 ${
        selected ? 'shadow-[0_0_0_1px_var(--color-accent)]' : ''
      } ${highlight ? 'arch-new' : ''} ${ghost ? 'arch-removed pointer-events-none' : ''}`}
      title={node.notes}
    >
      <span
        className="absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-full"
        style={{ background: color }}
      />
      <Icon size={20} color={color} className="shrink-0" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[13px] font-medium text-ink">{node.label}</span>
        {node.tech && (
          <span className="truncate font-mono text-[11px] text-ink-4">{node.tech}</span>
        )}
      </span>
      {SIDES.map(([id, position]) => (
        <Handle key={id} id={id} type="source" position={position} className={HANDLE} />
      ))}
    </div>
  );
});

/** A straight arrow between the borders of two nodes, wherever they are. */
function FloatingEdge({ id, source, target, data, selected }: EdgeProps<ArchFlowEdge>) {
  const from = useInternalNode(source);
  const to = useInternalNode(target);
  if (!from || !to || !data || source === target) return null;
  const centre = (p: Point) => ({ x: p.x + W / 2, y: p.y + H / 2 });
  const a = borderPoint(from.internals.positionAbsolute, centre(to.internals.positionAbsolute));
  const b = borderPoint(to.internals.positionAbsolute, centre(from.internals.positionAbsolute));
  const text = edgeText(data.edge);
  const stroke = selected
    ? 'var(--color-accent)'
    : data.highlight
      ? 'var(--color-accent-soft)'
      : 'var(--color-ink-6)';
  return (
    <>
      <BaseEdge
        id={id}
        path={`M${a.x},${a.y} L${b.x},${b.y}`}
        markerEnd="url(#arch-editor-arrow)"
        className={data.ghost ? 'arch-removed' : undefined}
        style={{ stroke, strokeWidth: selected ? 2 : 1.5 }}
      />
      {text && (
        <EdgeLabelRenderer>
          <div
            style={{
              transform: `translate(-50%, -100%) translate(${(a.x + b.x) / 2}px, ${(a.y + b.y) / 2 - 4}px)`,
            }}
            className={`pointer-events-none absolute rounded bg-panel px-1.5 py-px font-mono text-[11px] text-ink-3 ${
              data.ghost ? 'arch-removed' : ''
            }`}
          >
            {text}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { arch: ArchNodeView };
const edgeTypes = { arch: FloatingEdge };

/** Text field that only commits valid values and shows the saved one again on blur. */
function Field({
  label,
  value,
  onCommit,
  onDone,
  required,
  multiline,
  mono,
  placeholder,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  /** The user left the field. */
  onDone?: () => void;
  required?: boolean;
  multiline?: boolean;
  mono?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const update = (next: string) => {
    setDraft(next);
    if (!required || next.trim() !== '') onCommit(next);
  };
  const className = `w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink-6 focus:border-accent ${
    mono ? 'font-mono' : ''
  }`;
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-ink-4">{label}</span>
      {multiline ? (
        <textarea
          rows={4}
          value={shown}
          placeholder={placeholder}
          onChange={(e) => update(e.target.value)}
          onBlur={() => {
            setDraft(null);
            onDone?.();
          }}
          className={`${className} resize-none`}
        />
      ) : (
        <input
          value={shown}
          placeholder={placeholder}
          onChange={(e) => update(e.target.value)}
          onBlur={() => {
            setDraft(null);
            onDone?.();
          }}
          className={className}
        />
      )}
    </label>
  );
}

const SIDE_BUTTON =
  'flex h-7 items-center justify-center gap-1.5 rounded-md border border-line-strong bg-raised px-2.5 text-[12px] text-ink-2 hover:bg-line-soft hover:text-ink';

/** Sets an optional text field, dropping it when blank (the schema keeps no empty strings). */
function withText<T extends object>(item: T, key: keyof T & string, value: string): T {
  const rest = Object.fromEntries(Object.entries(item).filter(([k]) => k !== key));
  return (value.trim() === '' ? rest : { ...rest, [key]: value }) as T;
}

/**
 * A node added from the menu gets a placeholder id ("servizio-2"). Once the user names it,
 * the id follows the name, as long as no relation uses it yet: ids are what Claude refers to.
 */
function readableId(doc: ArchitectureDoc, node: ArchNode): string | null {
  const placeholder = freeArchId(ARCH_KIND_LABELS[node.kind], []);
  if (node.id !== placeholder && !node.id.startsWith(`${placeholder}-`)) return null;
  if (doc.edges.some((e) => e.from === node.id || e.to === node.id)) return null;
  const next = freeArchId(
    node.label,
    doc.nodes.filter((n) => n.id !== node.id).map((n) => n.id),
  );
  return next === node.id ? null : next;
}

function renameNode(doc: ArchitectureDoc, from: string, to: string): ArchitectureDoc {
  return { ...doc, nodes: doc.nodes.map((n) => (n.id === from ? { ...n, id: to } : n)) };
}

/** First free cell around `centre`, ring by ring, so new nodes stay in view. */
function freeSpot(doc: ArchitectureDoc, centre: Point): Point {
  const stepX = W + 40;
  const stepY = H + 32;
  const taken = (p: Point) =>
    doc.nodes.some(
      (n) =>
        n.position &&
        Math.abs(n.position.x - p.x) < W + 16 &&
        Math.abs(n.position.y - p.y) < H + 16,
    );
  for (let ring = 0; ring < 12; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const p = { x: Math.round(centre.x + dx * stepX), y: Math.round(centre.y + dy * stepY) };
        if (!taken(p)) return p;
      }
    }
  }
  return centre;
}

function Inspector({
  doc,
  node,
  edge,
  update,
  remove,
  renamed,
}: {
  doc: ArchitectureDoc;
  node: ArchNode | undefined;
  edge: ArchEdge | undefined;
  update: (fn: (doc: ArchitectureDoc) => ArchitectureDoc) => void;
  remove: () => void;
  /** A node got a new id: the selection follows it. */
  renamed: (id: string) => void;
}) {
  const setNode = (patch: (n: ArchNode) => ArchNode) => {
    if (node) {
      update((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === node.id ? patch(n) : n)) }));
    }
  };
  const setEdge = (patch: (e: ArchEdge) => ArchEdge) => {
    if (edge) {
      update((d) => ({ ...d, edges: d.edges.map((e) => (e.id === edge.id ? patch(e) : e)) }));
    }
  };
  const labelOf = (id: string) => doc.nodes.find((n) => n.id === id)?.label ?? id;

  return (
    <aside className="flex w-[264px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-line-soft bg-chrome p-3.5">
      {node ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12.5px] font-semibold text-ink">Nodo</span>
            <span
              className="truncate font-mono text-[11px] text-ink-5"
              title="Id stabile, usato da Claude"
            >
              {node.id}
            </span>
          </div>
          <Field
            key={`label-${node.id}`}
            label="Nome"
            value={node.label}
            required
            onCommit={(v) => setNode((n) => ({ ...n, label: v }))}
            onDone={() => {
              const next = node && readableId(doc, node);
              if (next) {
                update((d) => renameNode(d, node.id, next));
                renamed(next);
              }
            }}
          />
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-4">Tipo</span>
            <select
              value={node.kind}
              onChange={(e) => setNode((n) => ({ ...n, kind: e.target.value as ArchNodeKind }))}
              className="rounded-md border border-line bg-canvas px-2 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent"
            >
              {ARCH_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {ARCH_KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </label>
          <Field
            key={`tech-${node.id}`}
            label="Tecnologia"
            value={node.tech ?? ''}
            mono
            placeholder="es. Go, Postgres"
            onCommit={(v) => setNode((n) => withText(n, 'tech', v))}
          />
          <Field
            key={`notes-${node.id}`}
            label="Note"
            value={node.notes ?? ''}
            multiline
            onCommit={(v) => setNode((n) => withText(n, 'notes', v))}
          />
          <button type="button" className={`${SIDE_BUTTON} mt-1 !text-danger`} onClick={remove}>
            <TrashIcon size={13} />
            Elimina nodo
          </button>
        </>
      ) : edge ? (
        <>
          <span className="text-[12.5px] font-semibold text-ink">Relazione</span>
          <span className="text-[12px] text-ink-3">
            {labelOf(edge.from)} → {labelOf(edge.to)}
          </span>
          <Field
            key={`elabel-${edge.id}`}
            label="Etichetta"
            value={edge.label ?? ''}
            placeholder="es. verifica JWT"
            onCommit={(v) => setEdge((e) => withText(e, 'label', v))}
          />
          <Field
            key={`proto-${edge.id}`}
            label="Protocollo"
            value={edge.protocol ?? ''}
            mono
            placeholder="es. HTTP, gRPC, AMQP"
            onCommit={(v) => setEdge((e) => withText(e, 'protocol', v))}
          />
          <button
            type="button"
            className={SIDE_BUTTON}
            onClick={() => setEdge((e) => ({ ...e, from: e.to, to: e.from }))}
          >
            <ArrowsLeftRightIcon size={13} />
            Inverti direzione
          </button>
          <button type="button" className={`${SIDE_BUTTON} !text-danger`} onClick={remove}>
            <TrashIcon size={13} />
            Elimina relazione
          </button>
        </>
      ) : (
        <>
          <Field
            key="title"
            label="Titolo del diagramma"
            value={doc.title}
            onCommit={(v) => update((d) => ({ ...d, title: v }))}
          />
          <p className="text-[12px] text-pretty text-ink-4">
            Aggiungi un nodo dal pulsante in alto. Per collegare due nodi trascina da un pallino del
            primo al secondo. <kbd className="font-mono text-ink-3">Canc</kbd> elimina la selezione.
          </p>
          <p className="text-[12px] text-pretty text-ink-5">
            Seleziona un nodo o una relazione per modificarne i dettagli.
          </p>
        </>
      )}
    </aside>
  );
}

function AddNodeMenu({ onAdd }: { onAdd: (kind: ArchNodeKind) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-chrome px-3 text-[12.5px] font-medium text-ink shadow-[0_8px_24px_rgba(0,0,0,.35)] hover:bg-raised"
      >
        <PlusIcon size={14} />
        Aggiungi nodo
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-9 left-0 z-10 w-44 rounded-[10px] border border-line-strong bg-chrome p-1 shadow-[0_24px_60px_rgba(0,0,0,.55)]"
        >
          {ARCH_KINDS.map((kind) => {
            const { icon: Icon, color } = ARCH_KIND_STYLE[kind];
            return (
              <button
                key={kind}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onAdd(kind);
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-ink-2 hover:bg-hover hover:text-ink"
              >
                <Icon size={15} color={color} />
                {ARCH_KIND_LABELS[kind]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function isField(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function toggle(list: string[], id: string, on: boolean): string[] {
  const rest = list.filter((x) => x !== id);
  return on ? [...rest, id] : rest;
}

function EditorCanvas({ panelId }: { panelId: string }) {
  const doc = useArchitectureStore((s) => s.docs[panelId]);
  const claudeEdit = useArchitectureStore((s) => s.claudeEdits[panelId]);
  const change = useArchitectureStore((s) => s.change);
  const { screenToFlowPosition } = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const [selectedEdges, setSelectedEdges] = useState<string[]>([]);
  const [dragging, setDragging] = useState<Record<string, Point>>({});
  const [settledAt, setSettledAt] = useState<number | null>(null);

  // Removed nodes fade out, then leave.
  useEffect(() => {
    if (!claudeEdit) return;
    const at = claudeEdit.at;
    const timer = setTimeout(() => setSettledAt(at), GHOST_MS);
    return () => clearTimeout(timer);
  }, [claudeEdit]);

  const diff: ArchDiff | undefined = claudeEdit?.diff;
  const showGhosts = claudeEdit !== undefined && settledAt !== claudeEdit.at;

  const nodes = useMemo<ArchFlowNode[]>(() => {
    if (!doc) return [];
    const highlighted = new Set([...(diff?.addedNodes ?? []), ...(diff?.changedNodes ?? [])]);
    const live: ArchFlowNode[] = doc.nodes.map((node) => ({
      id: node.id,
      type: 'arch',
      position: dragging[node.id] ?? node.position ?? { x: 0, y: 0 },
      width: W,
      height: H,
      selected: selectedNodes.includes(node.id),
      data: { node, highlight: highlighted.has(node.id), ghost: false },
    }));
    const ghosts: ArchFlowNode[] = showGhosts
      ? (diff?.removedNodes ?? []).map((node) => ({
          id: `ghost:${node.id}`,
          type: 'arch',
          position: node.position ?? { x: 0, y: 0 },
          width: W,
          height: H,
          selectable: false,
          draggable: false,
          connectable: false,
          data: { node, highlight: false, ghost: true },
        }))
      : [];
    return [...live, ...ghosts];
  }, [doc, diff, dragging, selectedNodes, showGhosts]);

  const edges = useMemo<ArchFlowEdge[]>(() => {
    if (!doc) return [];
    const highlighted = new Set(diff?.addedEdges ?? []);
    const live: ArchFlowEdge[] = doc.edges.map((edge) => ({
      id: edge.id,
      type: 'arch',
      source: edge.from,
      target: edge.to,
      selected: selectedEdges.includes(edge.id),
      data: { edge, highlight: highlighted.has(edge.id), ghost: false },
    }));
    const removedIds = new Set((diff?.removedNodes ?? []).map((n) => n.id));
    const ghosts: ArchFlowEdge[] = showGhosts
      ? (diff?.removedEdges ?? []).map((edge) => ({
          id: `ghost:${edge.id}`,
          type: 'arch',
          source: removedIds.has(edge.from) ? `ghost:${edge.from}` : edge.from,
          target: removedIds.has(edge.to) ? `ghost:${edge.to}` : edge.to,
          selectable: false,
          data: { edge, highlight: false, ghost: true },
        }))
      : [];
    return [...live, ...ghosts];
  }, [doc, diff, selectedEdges, showGhosts]);

  if (!doc) return null;
  const update = (fn: (d: ArchitectureDoc) => ArchitectureDoc) => change(panelId, fn);

  const onNodesChange = (changes: NodeChange<ArchFlowNode>[]) => {
    const moves: Record<string, Point> = {};
    let selection = selectedNodes;
    for (const c of changes) {
      if (c.type === 'position' && c.position) moves[c.id] = c.position;
      if (c.type === 'select') selection = toggle(selection, c.id, c.selected);
    }
    if (Object.keys(moves).length > 0) setDragging((d) => ({ ...d, ...moves }));
    if (selection !== selectedNodes) setSelectedNodes(selection);
  };

  const onEdgesChange = (changes: EdgeChange<ArchFlowEdge>[]) => {
    let selection = selectedEdges;
    for (const c of changes) {
      if (c.type === 'select') selection = toggle(selection, c.id, c.selected);
    }
    if (selection !== selectedEdges) setSelectedEdges(selection);
  };

  const commitDrag = () => {
    const moved = dragging;
    if (Object.keys(moved).length === 0) return;
    update((d) => ({
      ...d,
      nodes: d.nodes.map((n) => {
        const p = moved[n.id];
        return p ? { ...n, position: { x: Math.round(p.x), y: Math.round(p.y) } } : n;
      }),
    }));
    setDragging({});
  };

  const link = (source: string, target: string) => {
    if (source === target) return;
    update((d) => {
      if (d.edges.some((e) => e.from === source && e.to === target)) return d;
      const id = freeArchId(
        `${source}-${target}`,
        d.edges.map((e) => e.id),
      );
      return { ...d, edges: [...d.edges, { id, from: source, to: target }] };
    });
  };

  const onConnect = (c: Connection) => {
    if (c.source && c.target) link(c.source, c.target);
  };

  // Dropping on the body of a node (not only on one of its dots) links it too.
  const onConnectEnd: OnConnectEnd = (event, state) => {
    if (state.isValid || !state.fromNode) return;
    const point = 'changedTouches' in event ? event.changedTouches[0] : event;
    if (!point) return;
    const target = document
      .elementFromPoint(point.clientX, point.clientY)
      ?.closest<HTMLElement>('.react-flow__node')?.dataset['id'];
    if (target && !target.startsWith('ghost:')) link(state.fromNode.id, target);
  };

  const addNode = (kind: ArchNodeKind) => {
    const box = wrapper.current?.getBoundingClientRect();
    const centre = box
      ? screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 })
      : { x: 0, y: 0 };
    const spot = freeSpot(doc, { x: centre.x - W / 2, y: centre.y - H / 2 });
    const label = ARCH_KIND_LABELS[kind];
    const id = freeArchId(
      label,
      doc.nodes.map((n) => n.id),
    );
    update((d) => ({ ...d, nodes: [...d.nodes, { id, kind, label, position: spot }] }));
    setSelectedNodes([id]);
    setSelectedEdges([]);
  };

  const removeSelected = () => {
    if (selectedNodes.length === 0 && selectedEdges.length === 0) return;
    const nodeIds = new Set(selectedNodes);
    const edgeIds = new Set(selectedEdges);
    update((d) => ({
      ...d,
      nodes: d.nodes.filter((n) => !nodeIds.has(n.id)),
      edges: d.edges.filter(
        (e) => !edgeIds.has(e.id) && !nodeIds.has(e.from) && !nodeIds.has(e.to),
      ),
    }));
    setSelectedNodes([]);
    setSelectedEdges([]);
  };

  // The editor lives inside `.nokey` (focus mode): React Flow ignores keys there, so do it here.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.key === 'Backspace' || e.key === 'Delete') && !isField(e.target)) {
      e.preventDefault();
      removeSelected();
    }
  };

  const single = selectedNodes.length + selectedEdges.length === 1;
  const node = single ? doc.nodes.find((n) => n.id === selectedNodes[0]) : undefined;
  const edge = single ? doc.edges.find((e) => e.id === selectedEdges[0]) : undefined;

  return (
    <div className="flex h-full min-h-0" onKeyDown={onKeyDown}>
      <div ref={wrapper} className="relative min-w-0 flex-1">
        <svg className="absolute size-0" aria-hidden>
          <defs>
            <marker
              id="arch-editor-arrow"
              viewBox="0 0 10 10"
              refX={9}
              refY={5}
              markerWidth={7}
              markerHeight={7}
              orient="auto-start-reverse"
            >
              <path d="M0 0 L10 5 L0 10 z" fill="context-stroke" />
            </marker>
          </defs>
        </svg>
        <ReactFlow<ArchFlowNode, ArchFlowEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={commitDrag}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          connectionMode={ConnectionMode.Loose}
          deleteKeyCode={null}
          fitView
          fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} size={1.2} color="var(--color-line-strong)" />
        </ReactFlow>
        <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
          <AddNodeMenu onAdd={addNode} />
        </div>
        {doc.nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="max-w-[40ch] text-center text-[13px] text-pretty text-ink-4">
              Il diagramma è vuoto. Aggiungi servizi, database e code, poi collegali: Claude li
              riceve come JSON quando colleghi questo panel.
            </span>
          </div>
        )}
      </div>
      <Inspector
        doc={doc}
        node={node}
        edge={edge}
        update={update}
        remove={removeSelected}
        renamed={(id) => setSelectedNodes([id])}
      />
    </div>
  );
}

/** Focus-mode editor of an Architecture panel (spec §8.3): its own React Flow instance. */
export default function ArchitectureEditor({ panelId }: { panelId: string }) {
  return (
    <ReactFlowProvider>
      <EditorCanvas panelId={panelId} />
    </ReactFlowProvider>
  );
}
