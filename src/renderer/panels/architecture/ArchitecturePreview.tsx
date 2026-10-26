import { memo } from 'react';
import {
  ARCH_NODE_SIZE,
  type ArchDiff,
  type ArchEdge,
  type ArchitectureDoc,
  type ArchNode,
} from '@shared/architecture';
import { ARCH_KIND_STYLE } from './archKinds';
import { borderPoint, edgeText } from './geometry';

type Point = { x: number; y: number };
const { width: W, height: H } = ARCH_NODE_SIZE;
const PAD = 36;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const centre = (p: Point): Point => ({ x: p.x + W / 2, y: p.y + H / 2 });

function EdgeLine({
  edge,
  from,
  to,
  stroke,
  className,
}: {
  edge: ArchEdge;
  from: Point;
  to: Point;
  stroke: string;
  className?: string | undefined;
}) {
  const a = borderPoint(from, centre(to));
  const b = borderPoint(to, centre(from));
  const text = edgeText(edge);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return (
    <g className={className}>
      <line
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        stroke={stroke}
        strokeWidth={1.5}
        markerEnd="url(#arch-arrow)"
      />
      {text && (
        <text
          x={mid.x}
          y={mid.y - 6}
          textAnchor="middle"
          className="fill-ink-4 font-mono text-[11px]"
          paintOrder="stroke"
          stroke="var(--color-panel)"
          strokeWidth={4}
        >
          {clip(text, 28)}
        </text>
      )}
    </g>
  );
}

function NodeBox({ node, className }: { node: ArchNode; className?: string | undefined }) {
  const { icon: Icon, color } = ARCH_KIND_STYLE[node.kind];
  const at = node.position ?? { x: 0, y: 0 };
  return (
    <g transform={`translate(${at.x} ${at.y})`} className={className}>
      <rect
        width={W}
        height={H}
        rx={10}
        fill="var(--color-panel-head)"
        stroke={color}
        strokeOpacity={0.55}
        strokeWidth={1.25}
      />
      <rect x={0} y={10} width={3} height={H - 20} rx={1.5} fill={color} />
      <Icon x={14} y={H / 2 - 10} size={20} color={color} />
      <text x={44} y={node.tech ? 28 : 37} className="fill-ink text-[13px] font-medium">
        {clip(node.label, 17)}
      </text>
      {node.tech && (
        <text x={44} y={46} className="fill-ink-4 font-mono text-[11px]">
          {clip(node.tech, 20)}
        </text>
      )}
    </g>
  );
}

/** Static SVG picture of an architecture (spec §8.3): what the panel shows on the board. */
export const ArchitecturePreview = memo(function ArchitecturePreview({
  doc,
  diff,
}: {
  doc: ArchitectureDoc;
  /** Claude's last change: added nodes glow, removed ones fade away. */
  diff?: ArchDiff | undefined;
}) {
  const ghosts = diff?.removedNodes ?? [];
  const all = [...doc.nodes, ...ghosts];
  if (all.length === 0) return null;
  const xs = all.map((n) => n.position?.x ?? 0);
  const ys = all.map((n) => n.position?.y ?? 0);
  const minX = Math.min(...xs) - PAD;
  const minY = Math.min(...ys) - PAD;
  const width = Math.max(...xs) + W + PAD - minX;
  const height = Math.max(...ys) + H + PAD - minY;
  const at = new Map(all.map((n) => [n.id, n.position ?? { x: 0, y: 0 }]));
  const added = new Set([...(diff?.addedNodes ?? []), ...(diff?.changedNodes ?? [])]);
  const addedEdges = new Set(diff?.addedEdges ?? []);
  const edges = (list: ArchEdge[], ghost: boolean) =>
    list.map((edge) => {
      const from = at.get(edge.from);
      const to = at.get(edge.to);
      if (!from || !to || edge.from === edge.to) return null;
      return (
        <EdgeLine
          key={`${ghost ? 'x' : 'e'}-${edge.id}`}
          edge={edge}
          from={from}
          to={to}
          className={ghost ? 'arch-removed' : undefined}
          stroke={
            ghost
              ? 'var(--color-ink-5)'
              : addedEdges.has(edge.id)
                ? 'var(--color-accent)'
                : 'var(--color-ink-6)'
          }
        />
      );
    });

  return (
    <svg
      viewBox={`${minX} ${minY} ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full"
      role="img"
      aria-label={`Diagramma: ${doc.nodes.length} nodi, ${doc.edges.length} relazioni`}
    >
      <defs>
        <marker
          id="arch-arrow"
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
      {edges(doc.edges, false)}
      {edges(diff?.removedEdges ?? [], true)}
      {doc.nodes.map((node) => (
        <NodeBox
          key={node.id}
          node={node}
          className={added.has(node.id) ? 'arch-new' : undefined}
        />
      ))}
      {ghosts.map((node) => (
        <NodeBox key={`x-${node.id}`} node={node} className="arch-removed" />
      ))}
    </svg>
  );
});
