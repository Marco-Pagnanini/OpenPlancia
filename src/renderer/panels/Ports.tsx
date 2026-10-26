import { Handle, Position } from '@xyflow/react';
import { isConnectable } from '@shared/access';
import type { Panel } from '@shared/types';

/**
 * Connection ports on both sides of panels that can be linked (Claude terminals, markdown,
 * architecture). In loose mode any port can start or end an arrow; the drag direction is the
 * arrow direction.
 */
export function Ports({ panel, linked }: { panel: Panel; linked: boolean }) {
  if (!isConnectable(panel)) return null;
  // Above the resize lines of a selected panel, which run along the same edges.
  const className = `!z-20 !size-3.5 !rounded-full !border-2 transition-colors hover:!border-accent ${
    linked ? '!border-accent !bg-accent' : '!border-[#45443f] !bg-panel'
  }`;
  return (
    <>
      <Handle
        id="l"
        type="source"
        position={Position.Left}
        className={className}
        title="Trascina per collegare"
      />
      <Handle
        id="r"
        type="source"
        position={Position.Right}
        className={className}
        title="Trascina per collegare"
      />
    </>
  );
}
