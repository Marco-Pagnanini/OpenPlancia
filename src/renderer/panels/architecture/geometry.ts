import { ARCH_NODE_SIZE, type ArchEdge } from '@shared/architecture';

type Point = { x: number; y: number };
const { width: W, height: H } = ARCH_NODE_SIZE;

/** Where the line from the centre of a node towards `towards` leaves its box. */
export function borderPoint(topLeft: Point, towards: Point): Point {
  const cx = topLeft.x + W / 2;
  const cy = topLeft.y + H / 2;
  const dx = towards.x - cx;
  const dy = towards.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scale = Math.min(
    dx === 0 ? Infinity : W / 2 / Math.abs(dx),
    dy === 0 ? Infinity : H / 2 / Math.abs(dy),
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}

/** "label · protocol", or whichever is set. */
export function edgeText(edge: Pick<ArchEdge, 'label' | 'protocol'>): string {
  return [edge.label, edge.protocol].filter(Boolean).join(' · ');
}
