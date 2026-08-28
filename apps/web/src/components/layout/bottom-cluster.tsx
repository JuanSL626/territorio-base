import { useState } from 'react';

import type { LayerDef } from '~/layers/types';

import { LegendDetail } from '~/components/layers/legend-swatch';
import { getLayer } from '~/layers/registry';
import { ATTRIBUTION_LINE } from '~/layers/sources';

export type BottomClusterProps = {
  visibleLayers: readonly string[];
  scaleLabel: string;
};

export function BottomCluster({ visibleLayers, scaleLabel }: BottomClusterProps) {
  const [open, setOpen] = useState(false);
  const layers = visibleLayers
    .map((id) => getLayer(id))
    .filter((layer): layer is LayerDef => layer !== undefined && layer.alwaysOn !== true);

  return (
    <div className="pointer-events-auto absolute bottom-3 left-3 z-20 flex flex-col gap-2">
      {open ? (
        <div className="rounded-panel border-border-base bg-surface shadow-popover w-64 border p-3">
          {layers.length === 0 ? (
            <p className="text-11 text-fg-muted">No hay capas de datos visibles.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {layers.map((layer) => (
                <li key={layer.id}>
                  <p className="text-11 text-fg mb-1 font-semibold">{layer.label}</p>
                  <LegendDetail legend={layer.legend} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="border-border-base bg-surface text-11 text-fg shadow-popover flex h-7 items-center rounded-full border px-3 font-medium"
      >
        Leyenda compacta
      </button>

      <div className="text-11 text-fg-subtle flex flex-col gap-0.5">
        <span className="tabular">{scaleLabel}</span>
        <span>{ATTRIBUTION_LINE}</span>
      </div>
    </div>
  );
}
