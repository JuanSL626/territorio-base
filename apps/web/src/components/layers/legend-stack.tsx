import { useState } from 'react';

import { describeResolvedLegend, resolveLegend, type LegendPresence } from './legend-model';

import type { LayerDef } from '~/layers/types';

import { ChevronDown, ChevronRight } from '~/components/ui/icons';
import { getLayer } from '~/layers/registry';
import { cn } from '~/lib/cn';

export type LegendStackProps = {
  /** Ids visibles, en el orden en que el usuario los ve en el panel. */
  visibleLayers: readonly string[];
  /**
   * Ids que el mapa está pintando de verdad. Una capa prendida cuyo dato no
   * existe (todavía, o nunca) NO aporta leyenda: una entrada de leyenda sin
   * píxeles debajo es una mentira, y es justo el error que la regresión #4
   * dejaba a la vista (un color en la leyenda que no coincidía con el mapa).
   */
  renderedLayers?: readonly string[];
  presence: LegendPresence;
  /** Móvil: la leyenda arranca colapsada para no comerse el mapa (§9). */
  compact?: boolean;
  className?: string;
};

/**
 * Leyendas apiladas sobre el mapa (§5 de la tarea, §2 del brief).
 *
 * El legacy las apilaba **calculando un offset por leyenda**, y bastaba una
 * capa con una clase de más para que dos se superpusieran. Acá el apilado es
 * una columna flex con `gap` y `overflow-y`: no hay ninguna posición
 * calculada, así que no hay nada que se pueda desincronizar. La altura está
 * topeada contra el viewport y el bloque scrollea adentro — nunca crece por
 * encima del mapa ni tapa la toolbar.
 *
 * Sólo entran capas VISIBLES, y sólo con las clases que el AOI tiene de verdad
 * adentro (WorldCover es disperso — ver `legend-model.ts`).
 */
export function LegendStack({
  visibleLayers,
  renderedLayers,
  presence,
  compact = false,
  className,
}: LegendStackProps) {
  const [open, setOpen] = useState(!compact);

  /*
    `renderedLayers` es la lista de capas que el mapa está pintando de verdad.
    Cuando llega, MANDA: una capa prendida cuyo dato todavía no existe (o no
    existió nunca) no aporta leyenda. Dibujarla igual era la regresión #4 — un
    color en la leyenda sin un solo píxel de ese color en el mapa.
  */
  const painted = renderedLayers === undefined ? null : new Set(renderedLayers);

  const blocks = visibleLayers
    .filter((id) => painted === null || painted.has(id))
    .map((id) => getLayer(id))
    .filter((layer): layer is LayerDef => layer !== undefined)
    .map((layer) => ({ layer, resolved: resolveLegend(layer, presence[layer.id]) }))
    .filter(
      (entry): entry is { layer: LayerDef; resolved: NonNullable<typeof entry.resolved> } =>
        entry.resolved !== null,
    );

  if (blocks.length === 0) return null;

  return (
    <div
      className={cn(
        'rounded-panel border-border-base bg-surface/95 shadow-popover pointer-events-auto',
        'flex max-h-[min(52vh,420px)] w-60 flex-col border backdrop-blur-sm',
        className,
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="text-11 text-fg-muted hover:text-fg flex h-7 shrink-0 items-center gap-1 px-3 font-semibold tracking-wide uppercase"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Leyenda
      </button>

      {open ? (
        <ul className="flex min-h-0 flex-col gap-3 overflow-y-auto px-3 pb-3">
          {blocks.map(({ layer, resolved }) => (
            <li key={layer.id}>
              <p className="text-11 text-fg mb-1 font-semibold" title={layer.label}>
                {layer.label}
              </p>
              <span className="sr-only">{describeResolvedLegend(resolved)}</span>

              {resolved.kind === 'classes' ? (
                <ul aria-hidden="true" className="flex flex-col gap-1">
                  {resolved.classes.map((item) => (
                    <li key={item.label} className="flex items-start gap-2">
                      <span
                        className="border-border-base mt-0.5 block h-3 w-3 shrink-0 rounded-[2px] border"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="text-11 text-fg-muted leading-tight">{item.label}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {resolved.kind === 'ramp' ? (
                <div aria-hidden="true" className="flex flex-col gap-1">
                  <span
                    className="block h-2 w-full rounded-[2px]"
                    style={{
                      backgroundImage: `linear-gradient(to right, ${resolved.colors.join(', ')})`,
                    }}
                  />
                  <span className="tabular text-11 text-fg-muted flex justify-between">
                    <span>{resolved.minLabel}</span>
                    <span>{resolved.maxLabel}</span>
                  </span>
                </div>
              ) : null}

              {resolved.kind === 'swatch' ? (
                <div aria-hidden="true" className="flex items-center gap-2">
                  <span
                    className="block h-3 w-3 shrink-0 rounded-[2px] border-2"
                    style={{ borderColor: resolved.color, backgroundColor: resolved.color }}
                  />
                  <span className="text-11 text-fg-muted">{resolved.label}</span>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
