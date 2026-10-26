import { ArrowsOutIcon, MinusIcon, PlusIcon } from '@phosphor-icons/react';
import { useReactFlow, useViewport } from '@xyflow/react';

const ZOOM_STEP = 1.15;
const BUTTON =
  'grid size-[30px] place-items-center rounded-[7px] text-ink-2 hover:bg-hover-strong hover:text-ink';

export function ZoomControls() {
  const { zoom } = useViewport();
  const { zoomTo, fitView } = useReactFlow();

  return (
    <div className="absolute right-4 bottom-4 z-20 flex items-center gap-0.5 rounded-[10px] border border-line bg-chrome p-1">
      <button
        type="button"
        aria-label="Riduci"
        className={BUTTON}
        onClick={() => void zoomTo(zoom / ZOOM_STEP, { duration: 120 })}
      >
        <MinusIcon size={14} />
      </button>
      <span className="min-w-[46px] text-center font-mono text-xs text-ink-2">
        {Math.round(zoom * 100)}%
      </span>
      <button
        type="button"
        aria-label="Ingrandisci"
        className={BUTTON}
        onClick={() => void zoomTo(zoom * ZOOM_STEP, { duration: 120 })}
      >
        <PlusIcon size={14} />
      </button>
      <div className="mx-[3px] h-[18px] w-px bg-line" />
      <button
        type="button"
        aria-label="Adatta alla vista"
        title="Adatta (0)"
        className={BUTTON}
        onClick={() => void fitView({ duration: 200, maxZoom: 1 })}
      >
        <ArrowsOutIcon size={14} />
      </button>
    </div>
  );
}
