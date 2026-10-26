import { ArrowsLeftRightIcon, EyeIcon, PencilSimpleIcon } from '@phosphor-icons/react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import { memo } from 'react';
import { estimateTokens, useConnectionStore } from '../stores/connectionStore';
import { useUiStore } from '../stores/uiStore';
import type { WireEdge } from '../stores/workspaceStore';
import { WIRE_COLORS, WIRE_LABEL, wireKind } from './wireStyle';

function WireEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
  markerStart,
}: EdgeProps<WireEdge>) {
  const pair = data?.pair;
  const last = useConnectionStore((s) => (pair ? s.active[pair.key] : undefined));
  const setWire = useUiStore((s) => s.setWire);
  const recent = last !== undefined;
  if (!pair) return null;

  const kind = wireKind(pair);
  const color = WIRE_COLORS[kind];
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const Icon = kind === 'both' ? ArrowsLeftRightIcon : kind === 'read' ? EyeIcon : PencilSimpleIcon;
  const label =
    recent && last
      ? `${last.kind === 'read' ? 'letto' : 'scritto'} · ~${estimateTokens(last.chars)} token`
      : WIRE_LABEL[kind];

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={18}
        {...(markerEnd ? { markerEnd } : {})}
        {...(markerStart ? { markerStart } : {})}
        style={{
          stroke: color,
          strokeWidth: selected ? 2.5 : 1.75,
          opacity: selected || recent ? 1 : 0.85,
          strokeDasharray: recent ? '6 5' : undefined,
          animation: recent ? 'wire-dash 0.6s linear infinite' : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          onClick={() => setWire(pair.key)}
          title="Apri l'ispettore del collegamento"
          className="nodrag nopan absolute flex items-center gap-1.5 rounded-full border bg-chrome px-2 py-[3px] font-mono text-[11px] whitespace-nowrap hover:bg-hover"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
            borderColor: selected || recent ? color : 'var(--color-line-strong)',
            color: recent ? color : 'var(--color-ink-3)',
          }}
        >
          <Icon size={12} style={{ color }} />
          {label}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

export const WireEdgeComponent = memo(WireEdgeView);
