import { StaticMap, StaticMapLegend, type StaticMapGeometries  } from './static-map';

import type { ReportMapState } from './report-model';


import { Skeleton } from '~/components/ui/skeleton';
import { getLayer } from '~/layers/registry';
import { isRasterLayer } from '~/layers/types';
import { cn } from '~/lib/cn';

/**
 * El panel de mapa del sidecar (§6.1): pegajoso en escritorio, en línea en
 * móvil. Recibe un ESTADO COMPLETO por paso y lo dibuja; no recibe órdenes.
 *
 * El `fly` del estado gobierna la transición: con `prefers-reduced-motion` el
 * cambio de paso es un corte seco (sin `transition`), no un vuelo. Es la única
 * diferencia visible entre las dos preferencias, y es deliberada: el resto de
 * la coreografía (qué capas se prenden, a qué extensión se encuadra) es
 * idéntica, porque no es animación, es contenido.
 */

export type ReportMapPanelProps = {
  state: ReportMapState;
  geometries: StaticMapGeometries | null;
  /** `true` mientras se descargan las geometrías para el mapa. */
  loading: boolean;
  sticky: boolean;
  className?: string;
};

/**
 * Capas raster activas en este paso. El SVG no las dibuja (son PNG del servicio
 * raster), así que se nombran explícitamente con su leyenda en vez de dejar un
 * mapa que "le falta algo" sin decir qué.
 */
function rasterLayersOf(state: ReportMapState): string[] {
  return state.layers
    .map((id) => getLayer(id))
    .filter((layer) => layer !== undefined)
    .filter((layer) => isRasterLayer(layer))
    .map((layer) => layer.label);
}

export function ReportMapPanel({
  state,
  geometries,
  loading,
  sticky,
  className,
}: ReportMapPanelProps) {
  const rasters = rasterLayersOf(state);

  return (
    <aside
      aria-label="Mapa del reporte"
      data-testid={sticky ? 'report-map-sticky' : 'report-map-inline'}
      className={cn(
        'bg-surface-2 border-border-base flex flex-col',
        sticky ? 'sticky top-0 h-dvh border-l' : 'rounded-panel overflow-hidden border',
        className,
      )}
    >
      <div
        className={cn(
          'relative min-h-0 flex-1',
          // Sin `fly` no hay transición: el paso cambia de golpe.
          state.fly ? 'transition-opacity duration-300' : null,
        )}
      >
        {loading || geometries === null ? (
          <div className="flex h-full w-full items-center justify-center p-6">
            <div className="w-full max-w-md">
              <Skeleton className="h-64 w-full" />
              <p className="text-12 text-fg-muted mt-3 text-center">
                Cargando las geometrías del análisis…
              </p>
            </div>
          </div>
        ) : (
          <StaticMap
            key={state.fly ? undefined : state.caption}
            state={state}
            geometries={geometries}
            title={state.caption}
            className="h-full w-full"
          />
        )}
      </div>

      <div className="border-border-base bg-surface shrink-0 border-t p-3">
        <p className="text-12 text-fg font-medium">{state.caption}</p>
        <div className="mt-2">
          <StaticMapLegend state={state} />
        </div>
        {rasters.length === 0 ? null : (
          <p className="text-11 text-fg-subtle mt-2">
            Capas raster de este paso: {rasters.join(', ')}. Se dibujan como superposición en el
            mapa interactivo; acá se muestran sus valores agregados en las tarjetas.
          </p>
        )}
      </div>
    </aside>
  );
}
