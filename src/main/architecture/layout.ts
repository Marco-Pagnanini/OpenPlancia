import dagre from '@dagrejs/dagre';
import { ARCH_NODE_SIZE, type ArchitectureDoc, type ArchNode } from '@shared/architecture';

type Point = { x: number; y: number };

const GAP = 48;
const { width: W, height: H } = ARCH_NODE_SIZE;

/** Ideal top-left positions for every node, from a left-to-right dagre layout. */
function idealPositions(doc: ArchitectureDoc): Map<string, Point> {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: 'LR', nodesep: GAP, ranksep: GAP * 2, marginx: 0, marginy: 0 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of doc.nodes) graph.setNode(node.id, { width: W, height: H });
  for (const edge of doc.edges) {
    if (edge.from !== edge.to) graph.setEdge(edge.from, edge.to);
  }
  dagre.layout(graph);
  const positions = new Map<string, Point>();
  for (const node of doc.nodes) {
    const { x, y } = graph.node(node.id);
    positions.set(node.id, { x: x - W / 2, y: y - H / 2 });
  }
  return positions;
}

function overlaps(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < W + GAP / 2 && Math.abs(a.y - b.y) < H + GAP / 2;
}

function mean(points: Point[]): Point {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/**
 * Gives a position to every node that lacks one (spec §5): where dagre would put it relative
 * to the nodes it is linked to, then moved down until it does not cover another node. Nodes
 * that already have a position never move.
 */
export function placeNewNodes(doc: ArchitectureDoc): ArchitectureDoc {
  const missing = doc.nodes.filter((n) => !n.position);
  if (missing.length === 0) return doc;
  const ideal = idealPositions(doc);
  const placed = doc.nodes.filter(
    (n): n is ArchNode & { position: Point } => n.position !== undefined,
  );
  if (placed.length === 0) {
    return {
      ...doc,
      nodes: doc.nodes.map((n) => ({ ...n, position: ideal.get(n.id) ?? { x: 0, y: 0 } })),
    };
  }

  // Shift between dagre's picture and the real one, per placed node.
  const shift = new Map<string, Point>();
  for (const node of placed) {
    const at = ideal.get(node.id) ?? node.position;
    shift.set(node.id, { x: node.position.x - at.x, y: node.position.y - at.y });
  }
  const globalShift = mean([...shift.values()]);
  const neighbours = (id: string) =>
    doc.edges.flatMap((e) => (e.from === id ? [e.to] : e.to === id ? [e.from] : []));

  const occupied: Point[] = placed.map((n) => n.position);
  const positions = new Map<string, Point>();
  for (const node of missing) {
    const anchors = neighbours(node.id)
      .map((id) => shift.get(id))
      .filter((s): s is Point => s !== undefined);
    const offset = anchors.length > 0 ? mean(anchors) : globalShift;
    const at = ideal.get(node.id) ?? { x: 0, y: 0 };
    const spot = { x: Math.round(at.x + offset.x), y: Math.round(at.y + offset.y) };
    while (occupied.some((p) => overlaps(p, spot))) spot.y += H + GAP / 2;
    occupied.push(spot);
    positions.set(node.id, spot);
  }
  return {
    ...doc,
    nodes: doc.nodes.map((n) =>
      n.position ? n : { ...n, position: positions.get(n.id) ?? { x: 0, y: 0 } },
    ),
  };
}
