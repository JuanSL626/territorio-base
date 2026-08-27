/*
  ═══════════════════════════════════════════════════════════════════════════
  REGRESIÓN #1 DEL INVENTARIO — ORIENTACIÓN NORTE-SUR. NO BORRAR.
  ═══════════════════════════════════════════════════════════════════════════
  El bug histórico: el legacy aplicaba `np.flipud` a arrays que YA venían con
  la fila 0 = norte, y el overlay salía espejado respecto de sus bounds. El
  inventario lo marca como "trivial de reintroducir con otra librería", y ESTA
  es la otra librería.

  La convención, escrita una sola vez para que nadie la re-derive:

      · La fila 0 de un PNG se dibuja ARRIBA.
      · `X-Bounds` llega como `[west, south, east, north]`.
      · `ImageSource.coordinates` de MapLibre quiere las 4 esquinas en el orden
        SUPERIOR-IZQUIERDA, SUPERIOR-DERECHA, INFERIOR-DERECHA, INFERIOR-IZQUIERDA.
      · Por lo tanto la superior-izquierda es `[west, north]` — NORTE arriba.

  `services/api/render/overlay.py` ya verifica el signo del eje `y` del raster
  contra esta misma convención y publica las esquinas listas en el sidecar y en
  `X-Overlay-Coordinates`. Este módulo las usa TAL CUAL y NO VOLTEA NADA en
  ninguna dirección. La única derivación permitida es `coordinatesFromBounds`,
  abajo, que es la fórmula de arriba escrita una vez y con un test que la fija
  (`overlays.test.ts`). Si algún día el overlay aparece espejado, el bug está
  del lado del servicio o en los bounds — no se arregla metiendo un `reverse()`
  acá.

  ── VERIFICADO CONTRA UN ANÁLISIS REAL (no sólo contra el test unitario) ──
  AOI de 460 ha en la Cordillera Central (-70.93/18.90 a -70.91/18.92), 685 m de
  desnivel real (1 290–1 975 m). Se comparó el `raster/dem.tif` reproyectado a
  EPSG:4326 contra el `overlay/dem.png`, invirtiendo la rampa `terrain` color a
  color para reconstruir la elevación de cada píxel:

      correlación DEM ↔ PNG, tal cual              : +1,0000
      correlación con el PNG espejado norte-sur    : -0,5443
      coordinatesFromBounds(X-Bounds) == X-Overlay-Coordinates : true

  LA TRAMPA, anotada para el próximo que verifique esto: NO alcanza con
  comparar la LUMINANCIA de la primera fila contra la de la última. La rampa
  `terrain` de matplotlib no es monótona en luminancia (azul → verde →
  amarillo → marrón → blanco), así que ese atajo da un signo arbitrario y
  "detecta" un espejado que no existe. Sobre un AOI plano — el primer job de
  prueba tenía 0,1 m de rango — es directamente ruido. La comparación válida es
  reconstruir el valor invirtiendo la rampa y correlacionar el campo completo.
*/

import {
  overlayMetadataSchema,
  type OverlayMetadata,
  type RasterLayer,
  type LayerAvailability,
} from '@territorio/api-client';

import type { Bounds2D } from '@territorio/geo/geojson';
import type { TerritorioAnalysis } from '~/lib/analysis-contract';

/** Las 4 esquinas en el orden de `ImageSource`: TL, TR, BR, BL. */
export type ImageCoordinates = [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
];

/**
 * `[west, south, east, north]` → esquinas TL, TR, BR, BL.
 *
 * ÚNICO lugar del front donde se traduce bounds a esquinas. Ver el bloque de
 * arriba antes de tocar una línea de esta función.
 */
export function coordinatesFromBounds(bounds: Bounds2D): ImageCoordinates {
  const [west, south, east, north] = bounds;
  return [
    [west, north], // superior-izquierda: NORTE arriba
    [east, north],
    [east, south],
    [west, south],
  ];
}

/**
 * Normaliza lo que llega del servicio. El sidecar publica `coordinates` como
 * `number[][]` (el tipo generado no puede expresar "4 pares"), así que se
 * valida la forma antes de creerle; si no cumple, se derivan de los bounds con
 * la fórmula de arriba en vez de pasarle a MapLibre una lista mal formada.
 */
export function coordinatesOf(metadata: OverlayMetadata): ImageCoordinates {
  const raw = metadata.coordinates;
  if (raw.length === 4) {
    const corners = raw.map((pair) => {
      const lon = pair[0];
      const lat = pair[1];
      return lon !== undefined && lat !== undefined ? ([lon, lat] as [number, number]) : null;
    });
    const [a, b, c, d] = corners;
    if (a != null && b != null && c != null && d != null) return [a, b, c, d];
  }
  return coordinatesFromBounds(metadata.bounds);
}

/* -------------------------------------------------------------------------- */
/* Resolución de URLs                                                          */
/* -------------------------------------------------------------------------- */

/**
 * El servicio devuelve rutas relativas (`/analysis/{id}/overlay/dem.png`) y el
 * browser necesita una URL absoluta.
 *
 * `base` la provee quien renderiza el mapa. `lib/api.ts` documenta el caso en
 * el que NO hay base pública: si el servicio raster exige `API_TOKEN`, una URL
 * desnuda daría 401 y hay que proxear por una ruta del servidor. Cuando no hay
 * base, esta función devuelve `null` y la capa reporta su estado en la fila del
 * panel — nunca una imagen rota en silencio (§8, "Layer load error").
 */
export function resolveOverlayUrl(
  url: string | null | undefined,
  base: string | undefined,
): string | null {
  if (url == null || url.length === 0) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (base === undefined || base.length === 0) return null;
  return `${base.replace(/\/+$/, '')}${url.startsWith('/') ? '' : '/'}${url}`;
}

/* -------------------------------------------------------------------------- */
/* Puente registro ↔ servicio raster                                           */
/* -------------------------------------------------------------------------- */

/**
 * Id del registro → nombre de capa del servicio raster.
 *
 * Es un puente de NOMBRES, no un catálogo: el catálogo sigue siendo
 * `~/layers/registry`. Existe porque el servicio usa `ndvi_density` y
 * `coastal` donde el registro usa `ndvi-density` y `aqueduct`, y adivinar la
 * traducción con un `replace` dejaría el caso `aqueduct` roto en silencio.
 */
export const RASTER_LAYER_BY_ID: Record<string, RasterLayer> = {
  dem: 'dem',
  slope: 'slope',
  aspect: 'aspect',
  ndvi: 'ndvi',
  'ndvi-density': 'ndvi_density',
  worldcover: 'worldcover',
  aqueduct: 'coastal',
};

export function rasterLayerFor(layerId: string): RasterLayer | undefined {
  return RASTER_LAYER_BY_ID[layerId];
}

export type RasterOverlayRef = {
  layerId: string;
  rasterLayer: RasterLayer;
  /** URL absoluta del PNG, o `null` si no se puede armar. */
  pngUrl: string | null;
  /** URL absoluta del sidecar JSON (bounds + leyenda), o `null`. */
  metadataUrl: string | null;
  available: boolean;
};

/**
 * Overlays que ESTA corrida produjo de verdad (`analysis.layers`), más el
 * costero, que llega aparte porque se pide bajo demanda (§4, `coastal`).
 *
 * No se listan capas que el análisis no produjo: el menú de descarga y el mapa
 * salen de lo que el backend hizo, nunca de una lista estática (§12.13).
 */
export function overlayRefs(
  analysis: TerritorioAnalysis | null,
  base: string | undefined,
): ReadonlyMap<string, RasterOverlayRef> {
  const refs = new Map<string, RasterOverlayRef>();
  if (analysis === null) return refs;

  const byRasterLayer = new Map<RasterLayer, LayerAvailability>(
    analysis.layers.map((entry) => [entry.layer, entry]),
  );

  for (const [layerId, rasterLayer] of Object.entries(RASTER_LAYER_BY_ID)) {
    const entry = byRasterLayer.get(rasterLayer);
    if (entry === undefined) continue;
    refs.set(layerId, {
      layerId,
      rasterLayer,
      pngUrl: resolveOverlayUrl(entry.overlay_url, base),
      metadataUrl: resolveOverlayUrl(entry.overlay_metadata_url, base),
      available: entry.available,
    });
  }

  const coastal = analysis.coastal;
  if (coastal?.available === true) {
    refs.set('aqueduct', {
      layerId: 'aqueduct',
      rasterLayer: 'coastal',
      // El costero ya viene absolutizado por `analysis-server.ts`.
      pngUrl: resolveOverlayUrl(coastal.overlay_url, base),
      metadataUrl: null,
      available: true,
    });
  }

  return refs;
}

/* -------------------------------------------------------------------------- */
/* Lectura del sidecar                                                         */
/* -------------------------------------------------------------------------- */

export type OverlayPlacement = {
  coordinates: ImageCoordinates;
  metadata: OverlayMetadata | null;
};

/**
 * Trae bounds y leyenda del overlay.
 *
 * Se prefiere el sidecar JSON al header `X-Bounds` por una razón concreta del
 * §5 de la tarea: la leyenda de WorldCover es DINÁMICA (sólo las clases
 * presentes en el AOI) y esa lista sólo viaja en el sidecar. El header queda
 * como respaldo cuando no hay sidecar (el overlay costero).
 */
export async function fetchOverlayPlacement(
  ref: RasterOverlayRef,
  signal: AbortSignal,
): Promise<OverlayPlacement | null> {
  if (ref.metadataUrl !== null) {
    const response = await fetch(ref.metadataUrl, { signal });
    if (!response.ok) return null;
    const parsed = overlayMetadataSchema.safeParse(await response.json());
    if (!parsed.success) return null;
    return { coordinates: coordinatesOf(parsed.data), metadata: parsed.data };
  }

  if (ref.pngUrl === null) return null;

  const response = await fetch(ref.pngUrl, { method: 'GET', signal });
  if (!response.ok) return null;
  const bounds = parseBoundsHeader(response.headers.get('x-bounds'));
  if (bounds === null) return null;
  return { coordinates: coordinatesFromBounds(bounds), metadata: null };
}

/** `X-Bounds: [west, south, east, north]`, serializado como JSON por el servicio. */
export function parseBoundsHeader(header: string | null): Bounds2D | null {
  if (header === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(header);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 4) return null;
  const numbers = parsed.map((value) => (typeof value === 'number' ? value : Number.NaN));
  if (numbers.some((value) => !Number.isFinite(value))) return null;
  const [west, south, east, north] = numbers as Bounds2D;
  return [west, south, east, north];
}
