/*
  Mapas base — 02-design-brief.md §3.3.

  REGLA DURA: ninguno pide API key ni registro. El legacy corría sobre OSM sin
  token y la migración no puede introducir una credencial nueva para poder
  dibujar el fondo. Los tres proveedores de acá sirven tiles públicos.

  El modo oscuro NO cambia de proveedor: reusa el mismo raster con
  `raster-brightness-*` / `raster-saturation` (§10, "el basemap se cambia con
  el tema"). Traer un segundo proveedor sólo para el modo oscuro sería una
  dependencia más que mantener y una atribución más que explicar.
*/

import type { RasterLayerSpecification, StyleSpecification } from 'maplibre-gl';
import type { BasemapId } from '~/layers/vistas';

export type BasemapDef = {
  id: BasemapId;
  label: string;
  /** Texto de atribución EXIGIDO por el proveedor. No es decorativo. */
  attribution: string;
  tiles: string[];
  tileSize: number;
  maxzoom: number;
};

/**
 * OSM estándar. Es el basemap del legacy (folium, centro `[18.453, -69.571]`)
 * y el único que se puede usar sin ninguna gestión previa.
 */
const OSM: BasemapDef = {
  id: 'light',
  label: 'Claro (OpenStreetMap)',
  attribution: '© OpenStreetMap contributors',
  tiles: [
    'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
    'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
    'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
  ],
  tileSize: 256,
  maxzoom: 19,
};

/** Relieve sombreado + curvas de nivel. Sin key, CC-BY-SA. */
const OPENTOPO: BasemapDef = {
  id: 'terrain',
  label: 'Relieve (OpenTopoMap)',
  attribution: '© OpenStreetMap contributors · SRTM | © OpenTopoMap (CC-BY-SA)',
  tiles: [
    'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
    'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
    'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
  ],
  tileSize: 256,
  maxzoom: 17,
};

/** Imagen satelital sin key. La vista `vegetacion` la pide por defecto (§3). */
const ESRI_IMAGERY: BasemapDef = {
  id: 'satellite',
  label: 'Satélite (Esri World Imagery)',
  attribution: 'Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  tiles: [
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  ],
  tileSize: 256,
  maxzoom: 19,
};

export const BASEMAPS: Record<BasemapId, BasemapDef> = {
  light: OSM,
  terrain: OPENTOPO,
  satellite: ESRI_IMAGERY,
};

/** Orden del selector de mapa base de la toolbar (§2, botón ⑤). */
export const BASEMAP_ORDER: BasemapId[] = ['light', 'terrain', 'satellite'];

/** Fondo del canvas por tema, para que no parpadee blanco en modo oscuro. */
const CANVAS_BACKGROUND = { light: '#eceff3', dark: '#11151a' } as const;

/*
  El satélite ya es oscuro: bajarle el brillo lo vuelve barro. Sólo los dos
  basemaps de cartografía se atenúan.
*/
function basemapPaint(id: BasemapId, dark: boolean): RasterLayerSpecification['paint'] {
  if (!dark || id === 'satellite') return { 'raster-opacity': 1 };
  return {
    'raster-opacity': 1,
    'raster-brightness-min': 0.08,
    'raster-brightness-max': 0.55,
    'raster-saturation': -0.35,
    'raster-contrast': 0.08,
  };
}

export const BASEMAP_SOURCE_ID = 'tb-basemap';
export const BASEMAP_LAYER_ID = 'tb-basemap-layer';

/**
 * Estilo completo, listo para `new maplibregl.Map({ style })` o `setStyle`.
 *
 * Se devuelve un objeto NUEVO en cada llamada a propósito: MapLibre muta el
 * estilo que recibe, y compartir la misma referencia entre dos mapas (o entre
 * dos `setStyle`) deja basura de la corrida anterior.
 */
export function basemapStyle(id: BasemapId, dark: boolean): StyleSpecification {
  const basemap = BASEMAPS[id];

  return {
    version: 8,
    // Sin glyphs/sprite remotos: ninguna capa de este mapa dibuja texto ni
    // íconos de sprite, así que pedirlos sería un request de red inútil.
    sources: {
      [BASEMAP_SOURCE_ID]: {
        type: 'raster',
        tiles: [...basemap.tiles],
        tileSize: basemap.tileSize,
        maxzoom: basemap.maxzoom,
        attribution: basemap.attribution,
      },
    },
    layers: [
      {
        id: 'tb-canvas',
        type: 'background',
        paint: { 'background-color': dark ? CANVAS_BACKGROUND.dark : CANVAS_BACKGROUND.light },
      },
      {
        id: BASEMAP_LAYER_ID,
        type: 'raster',
        source: BASEMAP_SOURCE_ID,
        paint: basemapPaint(id, dark),
      },
    ],
  };
}
