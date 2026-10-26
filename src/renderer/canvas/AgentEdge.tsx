import { ChatsCircleIcon } from '@phosphor-icons/react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import { memo } from 'react';
import { estimateTokens, useConnectionStore } from '../stores/connectionStore';
import { useUiStore } from '../stores/uiStore';
import type { AgentEdge } from '../stores/workspaceStore';
import { AGENT_COLOR } from './wireStyle';

/** Wire between two Claude terminals (M8): animates when one messages the other. */
function AgentEdgeView({
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
}: EdgeProps<AgentEdge>) {
  const agents = data?.agents;
  const recent = useConnectionStore((s) => (agents ? s.activeMessages[agents.key] : undefined));
  const setWire = useUiStore((s) => s.setWire);
  if (!agents) return null;

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const both = agents.aToB && agents.bToA;
  const label = recent
    ? `messaggio · ~${estimateTokens(recent.chars)} token`
    : both
      ? 'si scrivono'
      : 'può scrivere';

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={18}
        {...(markerEnd ? { markerEnd } : {})}
        {...(markerStart ? { markerStart } : {})}
        style={{
          stroke: AGENT_COLOR,
          strokeWidth: selected ? 2.5 : 1.75,
          opacity: selected || recent ? 1 : 0.85,
          strokeDasharray: recent ? '6 5' : undefined,
          animation: recent ? 'wire-dash 0.6s linear infinite' : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          onClick={() => setWire(agents.key)}
          title="Apri i messaggi tra questi agenti"
          className="nodrag nopan absolute flex items-center gap-1.5 rounded-full border bg-chrome px-2 py-[3px] font-mono text-[11px] whitespace-nowrap hover:bg-hover"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
            borderColor: selected || recent ? AGENT_COLOR : 'var(--color-line-strong)',
            color: recent ? AGENT_COLOR : 'var(--color-ink-3)',
          }}
        >
          <ChatsCircleIcon size={12} style={{ color: AGENT_COLOR }} />
          {label}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

export const AgentEdgeComponent = memo(AgentEdgeView);
