/*
  LayerDef → capas de estilo MapLibre. Módulo PURO: sin `maplibregl`, sin DOM,
  sin React. Todo lo que decide cómo se ve un dato está acá y se puede testear.

  ───────────────────────────────────────────────────────────────────────────
  LAS TRES REGRESIONES DEL INVENTARIO §9 QUE VIVEN EN ESTE ARCHIVO
  ───────────────────────────────────────────────────────────────────────────
  #4  Polígonos de amenaza apilados: con relleno ~0,34 tres capas superpuestas
      se mezclaban en un blob que no coincidía con NINGUNA entrada de leyenda.
      Acá el relleno sale de `legend.fillFactor` (0,12 para MEPyD, 0,5 para
      WDPA) y el borde se dibuja SIEMPRE en una capa aparte, opaco y grueso.
      El mismo bug traía un *late closure*: en el loop de folium las variables
      por iteración no se capturaban y todas las capas del grupo salían con el
      estilo de la última. Acá no puede pasar: no hay loop que capture nada —
      cada capa se construye desde su propio `LayerDef`, pasado por argumento.

  #5  Puntos como pines default. `CircleLayer` con radio explícito por capa,
      nunca `symbol` ni marcador DOM: 1 600 puntos de "Infraestructura de
      salud" tienen que seguir siendo un mapa legible y fluido.

  #7  Un color por CAPA (no por grupo). El color llega desde el registro
      (`palettes.mepydColor(indice_aplanado)`), este módulo sólo lo lee.

  Y la regla del §11: agregar la capa 40 no toca este archivo.
*/

import type {
  CircleLayerSpecification,
  DataDrivenPropertyValueSpecification,
  ExpressionSpecification,
  FillLayerSpecification,
  LineLayerSpecification,
  RasterLayerSpecification,
} from 'maplibre-gl';
import type { LayerDef, LegendSpec, PopupField } from '~/layers/types';

/** Rol de la capa de estilo. Una capa del registro puede generar varias. */
export type MapLayerRole = 'fill' | 'outline' | 'line' | 'point' | 'raster';

export type StyledLayer =
  | { id: string; role: 'fill'; spec: FillLayerSpecification }
  | { id: string; role: 'outline'; spec: LineLayerSpecification }
  | { id: string; role: 'line'; spec: LineLayerSpecification }
  | { id: string; role: 'point'; spec: CircleLayerSpecification }
  | { id: string; role: 'raster'; spec: RasterLayerSpecification };

/** Propiedad sintética con el id estable del feature (ver `vector-data.ts`). */
export const FEATURE_ID_KEY = '__tbid';

const PREFIX = 'tb';

export function sourceIdFor(layerId: string): string {
  return `${PREFIX}-src:${layerId}`;
}

export function mapLayerId(layerId: string, role: MapLayerRole): string {
  return `${PREFIX}-${role}:${layerId}`;
}

export function highlightLayerId(layerId: string, role: MapLayerRole): string {
  return `${PREFIX}-hl-${role}:${layerId}`;
}

/* -------------------------------------------------------------------------- */
/* Color                                                                       */
/* -------------------------------------------------------------------------- */

function firstClassColor(legend: LegendSpec): string {
  if (legend.type === 'classes') return legend.classes[0]?.color ?? '#999999';
  if (legend.type === 'swatch') return legend.color;
  return legend.colors[0] ?? '#999999';
}

/**
 * Campo categórico de la capa: el primero del popup que declare `valueLabels`.
 *
 * Es lo que hace que hidrología pinte sus tres tipos con los tres hex del
 * inventario (`waterway #1f78b4`, `water_body #08519c`, `wetland #41b6c4`) sin
 * que este módulo sepa qué es "hidrología": la relación código→etiqueta la
 * declara el `PopupConfig` y la etiqueta→color la declara la leyenda. Una capa
 * futura con la misma forma se pinta igual sin tocar código.
 */
function categoricalField(layer: LayerDef): PopupField | undefined {
  return layer.popup?.fields.find((field) => field.valueLabels !== undefined);
}

/**
 * Color de relleno/trazo de una capa vectorial. Devuelve una expresión `match`
 * cuando la capa es categórica y un literal cuando no.
 */
export function colorExpression(layer: LayerDef): DataDrivenPropertyValueSpecification<string> {
  const legend = layer.legend;
  const fallback = firstClassColor(legend);
  if (legend.type !== 'classes') return fallback;

  const field = categoricalField(layer);
  const valueLabels = field?.valueLabels;
  if (field === undefined || valueLabels === undefined) return fallback;

  const byLabel = new Map(legend.classes.map((item) => [item.label, item.color]));
  const cases: string[] = [];
  for (const [code, label] of Object.entries(valueLabels)) {
    const color = byLabel.get(label);
    if (color !== undefined) cases.push(code, color);
  }
  if (cases.length === 0) return fallback;

  /*
    `match` se arma con un número VARIABLE de pares (uno por valor declarado en
    `valueLabels`), y la firma del style-spec exige el primer par en posición
    fija. Un array construido en runtime no puede satisfacer esa forma sin
    perder el resto de los pares, así que se afirma el tipo — pero después de
    haber comprobado arriba que `cases` no está vacío, que es justo lo que la
    firma quiere garantizar.
  */
  const expression: unknown = ['match', ['get', field.key], ...cases, fallback];
  return expression as ExpressionSpecification;
}

/* -------------------------------------------------------------------------- */
/* Geometría del estilo                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Fracción de la opacidad que va al RELLENO. `fillFactor` sale del registro
 * (regresión #4). Sin él, un polígono cae al 0,12 conservador en vez de al
 * 0,34 que producía el blob.
 */
function fillFactorOf(legend: LegendSpec): number {
  if (legend.type === 'swatch') return legend.fillFactor ?? 0.12;
  return 0.12;
}

/** Grosor del borde. Fuerte a propósito: es lo único legible cuando hay solape. */
function outlineWidth(layer: LayerDef): number {
  if (layer.id === 'aoi') return 2;
  if (layer.kind === 'vector-polygon') return 2.5;
  return 2;
}

/** Radio del círculo de puntos. r=4 es el `CircleMarker` del legacy (§4). */
const POINT_RADIUS = 4;

/**
 * Todas las capas de estilo de una capa del registro, de abajo hacia arriba.
 *
 * Un polígono da SIEMPRE dos: relleno translúcido + borde opaco. Separarlas es
 * lo que arregla la regresión #4 — con `fill-outline-color` el borde hereda la
 * opacidad del relleno y desaparece justo cuando más falta hace.
 */
export function vectorLayerSpecs(layer: LayerDef, opacity: number): StyledLayer[] {
  const source = sourceIdFor(layer.id);
  const color = colorExpression(layer);
  const clamped = Math.min(1, Math.max(0, opacity));

  switch (layer.kind) {
    case 'vector-polygon': {
      const fillOpacity = clamped * fillFactorOf(layer.legend);
      const out: StyledLayer[] = [];

      // El AOI es un borde, no una mancha: `fillFactor: 0` en el registro.
      if (fillOpacity > 0) {
        out.push({
          id: mapLayerId(layer.id, 'fill'),
          role: 'fill',
          spec: {
            id: mapLayerId(layer.id, 'fill'),
            type: 'fill',
            source,
            paint: { 'fill-color': color, 'fill-opacity': fillOpacity },
          },
        });
      }

      out.push({
        id: mapLayerId(layer.id, 'outline'),
        role: 'outline',
        spec: {
          id: mapLayerId(layer.id, 'outline'),
          type: 'line',
          source,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': color,
            'line-width': outlineWidth(layer),
            'line-opacity': clamped,
          },
        },
      });

      return out;
    }

    case 'vector-line': {
      /*
        Hidrología OSM trae líneas Y polígonos en la misma fuente (`waterway`
        es línea; `natural=water` / `wetland` son polígonos). Por eso una capa
        declarada como línea igual emite su relleno: el filtro por tipo de
        geometría lo hace MapLibre solo — una capa `fill` ignora las líneas y
        una `line` dibuja también el contorno de los polígonos.
      */
      const fillOpacity = clamped * fillFactorOf(layer.legend);
      return [
        {
          id: mapLayerId(layer.id, 'fill'),
          role: 'fill',
          spec: {
            id: mapLayerId(layer.id, 'fill'),
            type: 'fill',
            source,
            paint: { 'fill-color': color, 'fill-opacity': fillOpacity },
          },
        },
        {
          id: mapLayerId(layer.id, 'line'),
          role: 'line',
          spec: {
            id: mapLayerId(layer.id, 'line'),
            type: 'line',
            source,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
              'line-color': color,
              'line-width': layer.id === 'osm-hydro' ? 3 : 2,
              'line-opacity': clamped,
            },
          },
        },
      ];
    }

    case 'vector-point':
      // Regresión #5: círculo con radio y color explícitos, JAMÁS un pin.
      return [
        {
          id: mapLayerId(layer.id, 'point'),
          role: 'point',
          spec: {
            id: mapLayerId(layer.id, 'point'),
            type: 'circle',
            source,
            paint: {
              'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                8,
                POINT_RADIUS - 1.5,
                14,
                POINT_RADIUS,
                18,
                POINT_RADIUS + 2,
              ],
              'circle-color': color,
              'circle-opacity': clamped,
              'circle-stroke-width': 1,
              'circle-stroke-color': '#ffffff',
              'circle-stroke-opacity': clamped * 0.85,
            },
          },
        },
      ];

    case 'raster-continuous':
    case 'raster-categorical':
      return [];
  }
}

/** Capa `raster` que muestra el PNG del overlay del servicio. */
export function rasterOverlaySpec(layerId: string, opacity: number): StyledLayer {
  const id = mapLayerId(layerId, 'raster');
  return {
    id,
    role: 'raster',
    spec: {
      id,
      type: 'raster',
      source: sourceIdFor(layerId),
      paint: {
        'raster-opacity': Math.min(1, Math.max(0, opacity)),
        // Nearest: las clases (pendiente, NDVI, WorldCover) son categóricas y
        // la interpolación bilineal inventa colores que no están en la leyenda.
        'raster-resampling': 'nearest',
        'raster-fade-duration': 0,
      },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Resaltado del feature seleccionado y del hover (§5.1)                       */
/* -------------------------------------------------------------------------- */

/** `--accent`: 3px de contorno y 30% de relleno, tal cual el §5.1. */
export const HIGHLIGHT_COLOR = '#1f6feb';

/**
 * Capas de resaltado del feature seleccionado, filtradas por el id sintético.
 *
 * Se usa `filter` y no `feature-state` a propósito: `feature-state` sólo pinta
 * features que ya están renderizados, así que una selección que llega por URL
 * (`sel=` del §5.1) sobre un feature todavía fuera de viewport no se vería.
 */
export function highlightSpecs(layer: LayerDef, featureId: string): StyledLayer[] {
  const source = sourceIdFor(layer.id);
  const filter: ExpressionSpecification = ['==', ['get', FEATURE_ID_KEY], featureId];

  switch (layer.kind) {
    case 'vector-point':
      return [
        {
          id: highlightLayerId(layer.id, 'point'),
          role: 'point',
          spec: {
            id: highlightLayerId(layer.id, 'point'),
            type: 'circle',
            source,
            filter,
            paint: {
              'circle-radius': POINT_RADIUS + 4,
              'circle-color': HIGHLIGHT_COLOR,
              'circle-opacity': 0.3,
              'circle-stroke-width': 3,
              'circle-stroke-color': HIGHLIGHT_COLOR,
            },
          },
        },
      ];

    case 'vector-polygon':
    case 'vector-line':
      return [
        {
          id: highlightLayerId(layer.id, 'fill'),
          role: 'fill',
          spec: {
            id: highlightLayerId(layer.id, 'fill'),
            type: 'fill',
            source,
            filter,
            paint: { 'fill-color': HIGHLIGHT_COLOR, 'fill-opacity': 0.3 },
          },
        },
        {
          id: highlightLayerId(layer.id, 'outline'),
          role: 'outline',
          spec: {
            id: highlightLayerId(layer.id, 'outline'),
            type: 'line',
            source,
            filter,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': HIGHLIGHT_COLOR, 'line-width': 3 },
          },
        },
      ];

    case 'raster-continuous':
    case 'raster-categorical':
      return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Orden de dibujo                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Clave de orden, de abajo hacia arriba. Un punto nunca queda tapado por un
 * polígono y el AOI queda siempre arriba de todo lo que describe.
 *
 * El desempate es el índice en el registro, así que el z-order del mapa es el
 * mismo orden que muestra el panel de capas — sin una segunda lista que
 * mantener sincronizada.
 */
const ROLE_RANK: Record<MapLayerRole, number> = {
  raster: 0,
  fill: 1,
  outline: 2,
  line: 3,
  point: 4,
};

export function sortKey(role: MapLayerRole, registryIndex: number, alwaysOn: boolean): number {
  const band = alwaysOn ? 5 : ROLE_RANK[role];
  return band * 10_000 + registryIndex;
}
