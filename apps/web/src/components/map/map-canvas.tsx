import type { BasemapId } from '~/layers/vistas';
import type { Bbox, Selection } from '~/lib/search-params';

import { ATTRIBUTION_LINE } from '~/layers/sources';

/*
  ╔══════════════════════════════════════════════════════════════════════════╗
  ║  PLACEHOLDER — la implementación MapLibre GL es de la fase siguiente.    ║
  ║  Lo único estable acá es `MapCanvasProps`: el shell ya pasa exactamente  ║
  ║  estos props, así que el reemplazo es borrar el cuerpo, no recablear.    ║
  ║                                                                          ║
  ║  Al implementarlo, respetar sí o sí:                                     ║
  ║   · un handler POR CAPA (`map.on('click', layerId, …)`), nunca un        ║
  ║     hit-test global que infiera la capa después (§12.6, §13).            ║
  ║   · `fitBounds` con el padding que llega por props, para que el AOI no   ║
  ║     quede debajo de un panel (§2).                                       ║
  ║   · la orientación del raster verificada contra la convención de bounds  ║
  ║     (regresión #1 del inventario: `np.flipud` espejaba norte-sur).       ║
  ║   · estilo explícito por capa para los puntos MEPyD, nunca pines default ║
  ║     (regresión #5), y captura de variables por iteración con cuidado     ║
  ║     (regresión #4, bug de closure tardío).                              ║
  ╚══════════════════════════════════════════════════════════════════════════╝
*/

export type MapPadding = { top: number; right: number; bottom: number; left: number };

/** Geometría mínima del AOI. `@territorio/geo` es dueño del tipo completo. */
export type PolygonGeometry = { type: 'Polygon'; coordinates: number[][][] };

export type MapCanvasProps = {
  basemap: BasemapId;
  visibleLayers: readonly string[];
  opacity: Readonly<Record<string, number>>;
  /** Id del AOI del servidor; `undefined` mientras no haya zona de estudio. */
  aoiId: string | undefined;
  bbox: Bbox | null;
  selection: Selection | null;
  padding: MapPadding;
  drawing: boolean;
  onSelect: (selection: Selection | null) => void;
  onBboxChange: (bbox: Bbox) => void;
  onAoiDrawn: (geometry: PolygonGeometry) => void;
};

export function MapCanvas({ basemap, visibleLayers, drawing }: MapCanvasProps) {
  return (
    <div
      role="application"
      aria-label="Mapa"
      className="bg-surface-3 relative flex h-full w-full items-center justify-center"
    >
      <div className="pointer-events-none flex max-w-sm flex-col items-center gap-2 text-center">
        <span className="rounded-chip bg-surface text-11 text-fg-muted px-2 py-1 font-semibold tracking-wide uppercase">
          Mapa — pendiente de la fase MapLibre
        </span>
        <p className="text-12 text-fg-muted">
          Basemap «{basemap}» · {visibleLayers.length} capa(s) visible(s)
          {drawing ? ' · modo dibujo activo' : ''}
        </p>
      </div>

      <p className="text-11 text-fg-subtle absolute bottom-3 left-3">{ATTRIBUTION_LINE}</p>
    </div>
  );
}
