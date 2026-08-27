/**
 * El MODELO del reporte: qué secciones existen para este análisis, qué estado
 * de mapa activa cada una, y qué datasets se citan.
 *
 * Puro y sin JSX: la pantalla y la vista de impresión recorren exactamente la
 * misma lista, así que no pueden divergir en orden ni en qué se omite.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * COREOGRAFÍA DEL MAPA (§6.3) — POR QUÉ ES DECLARATIVA
 * ─────────────────────────────────────────────────────────────────────────────
 * Cada sección declara el estado COMPLETO que quiere del mapa
 * (`{ layers, opacity, bounds, highlight }`) y el mapa hace un diff contra el
 * estado actual. Nunca "prendé esta capa" / "apagá aquella": una secuencia de
 * órdenes imperativas se desincroniza en cuanto el usuario scrollea rápido o
 * hacia arriba, que es exactamente lo que el brief pide evitar. Con estado
 * declarativo, salir de una sección hacia arriba es simplemente volver a
 * aplicar el estado de la anterior.
 *
 * El tope de 4 capas de datos visibles del §3.1 se aplica acá, no en el mapa.
 */
import type { LayerDef, SourceRef } from '~/layers/types';
import type { TerritorioAnalysisSummary } from '~/lib/analysis-contract';
import type { Bbox } from '~/lib/search-params';

import { MEPYD_GROUP } from '~/layers/mepyd';
import { getLayer, LAYER_REGISTRY } from '~/layers/registry';
import { type BasemapId, MAX_VISIBLE_DATA_LAYERS  } from '~/layers/vistas';

/* -------------------------------------------------------------------------- */
/* Secciones                                                                   */
/* -------------------------------------------------------------------------- */

export type ReportSectionId =
  | 'portada'
  | 'topografia'
  | 'vegetacion'
  | 'hidrologia'
  | 'areas-protegidas'
  | 'riesgo-costero'
  | 'contexto-rd'
  | 'fuentes';

export type ReportMapState = {
  /** Ids del registro de capas. El orden es el z-order del inventario §1. */
  layers: string[];
  opacity: Record<string, number>;
  bounds: Bbox;
  basemap: BasemapId;
  /** Features a resaltar dentro de las capas activas (`layerId:featureKey`). */
  highlight: string[];
  /**
   * `false` con `prefers-reduced-motion`: corte seco en vez de vuelo. Viaja en
   * el estado y no como flag global porque es una propiedad de la TRANSICIÓN
   * pedida, y el mapa es quien decide cómo ejecutarla.
   */
  fly: boolean;
  /** Una línea que dice qué se está mirando. Va sobre el mapa y en el `alt`. */
  caption: string;
};

export type ReportSection = {
  id: ReportSectionId;
  /** Rótulo corto de la navegación lateral. */
  eyebrow: string;
  title: string;
  map: ReportMapState;
  /** Capas cuya fuente se cita al pie de la sección (§6.5a). */
  citedLayerIds: string[];
};

/* -------------------------------------------------------------------------- */
/* Encuadre                                                                    */
/* -------------------------------------------------------------------------- */

const EARTH_METERS_PER_DEGREE = 111_320;

/**
 * Amplía un bbox unos metros. Es lo que convierte "hay un cauce a 240 m" en un
 * encuadre que efectivamente lo muestra, en vez de un zoom al AOI que lo deja
 * afuera del cuadro.
 */
export function expandBbox(bbox: Bbox, meters: number): Bbox {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const midLat = (minLat + maxLat) / 2;
  const cosLat = Math.max(Math.cos((midLat * Math.PI) / 180), 0.01);

  const dLat = meters / EARTH_METERS_PER_DEGREE;
  const dLon = meters / (EARTH_METERS_PER_DEGREE * cosLat);

  return [minLon - dLon, minLat - dLat, maxLon + dLon, maxLat + dLat];
}

/** Margen mínimo para que el borde del AOI no quede pegado al marco. */
function framed(bbox: Bbox, extraMeters = 0): Bbox {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const spanMeters = Math.max(
    (maxLon - minLon) * EARTH_METERS_PER_DEGREE,
    (maxLat - minLat) * EARTH_METERS_PER_DEGREE,
    50,
  );
  return expandBbox(bbox, Math.max(spanMeters * 0.12, 60) + extraMeters);
}

/* -------------------------------------------------------------------------- */
/* Estado de mapa por sección                                                  */
/* -------------------------------------------------------------------------- */

/** Tope duro del §3.1 aplicado al reporte: el AOI no consume cupo. */
function capLayers(ids: readonly string[]): string[] {
  const out: string[] = [];
  let dataLayers = 0;
  for (const id of ids) {
    const layer = getLayer(id);
    if (layer === undefined) continue;
    if (layer.alwaysOn === true) {
      out.push(id);
      continue;
    }
    if (dataLayers >= MAX_VISIBLE_DATA_LAYERS) continue;
    out.push(id);
    dataLayers += 1;
  }
  return out;
}

function mapState(input: {
  layers: string[];
  bounds: Bbox;
  basemap: BasemapId;
  caption: string;
  highlight?: string[];
  fly: boolean;
  opacity?: Record<string, number>;
}): ReportMapState {
  const layers = capLayers(['aoi', ...input.layers]);
  const opacity: Record<string, number> = { ...input.opacity };
  for (const id of layers) {
    if (id in opacity) continue;
    const layer = getLayer(id);
    if (layer !== undefined) opacity[id] = layer.defaultOpacity;
  }
  return {
    layers,
    opacity,
    bounds: input.bounds,
    basemap: input.basemap,
    highlight: input.highlight ?? [],
    fly: input.fly,
    caption: input.caption,
  };
}

/* -------------------------------------------------------------------------- */
/* Construcción de la lista                                                    */
/* -------------------------------------------------------------------------- */

/** Capas MEPyD del grupo Amenazas, que son las que el reporte destaca. */
const MEPYD_HAZARD_SUBGROUP = 'Amenazas';

function mepydLayerIdsWithData(analysis: TerritorioAnalysisSummary): string[] {
  const wanted = new Set<string>();
  for (const [, layers] of Object.entries(analysis.mepyd_rd.summary)) {
    for (const [label, entry] of Object.entries(layers)) {
      if (entry.count > 0) wanted.add(label);
    }
  }
  return LAYER_REGISTRY.filter(
    (layer) => layer.group === MEPYD_GROUP && wanted.has(layer.label),
  ).map((layer) => layer.id);
}

/**
 * Las secciones de ESTE análisis, en el orden del §6.2.
 *
 * Una sección sin datos utilizables NO se renderiza vacía: o se omite (y el
 * resumen ejecutivo lo dice) o se dibuja como bloque `no-data` con el motivo.
 * Acá se decide la omisión; el bloque `no-data` lo dibuja la sección.
 *
 * - `riesgo-costero` sólo existe si el usuario exploró la capa (el legacy la
 *   dejaba fuera del reporte incluso habiéndola visto: inventario §9).
 * - `contexto-rd` sólo existe si `in_rd` (UC-11, TC-22/TC-23).
 */
export function buildSections(
  analysis: TerritorioAnalysisSummary,
  options: { fly: boolean },
): ReportSection[] {
  const { fly } = options;
  const aoiBbox = analysis.aoi.bbox;
  const base = framed(aoiBbox);

  const sections: ReportSection[] = [
    {
      id: 'portada',
      eyebrow: 'Resumen',
      title: 'Zona de estudio',
      citedLayerIds: ['aoi'],
      map: mapState({
        layers: [],
        bounds: base,
        basemap: 'light',
        caption: 'Límite del área de estudio sobre el mapa base.',
        fly,
      }),
    },
    {
      id: 'topografia',
      eyebrow: 'Topografía',
      title: 'Relieve y pendiente',
      citedLayerIds: ['dem', 'slope-classes'],
      map: mapState({
        layers: ['slope-classes', 'dem'],
        bounds: base,
        basemap: 'terrain',
        caption: 'Clases de pendiente sobre el modelo de elevación Copernicus GLO-30.',
        fly,
      }),
    },
    {
      id: 'vegetacion',
      eyebrow: 'Vegetación',
      title: 'Vegetación y cobertura de suelo',
      citedLayerIds: ['ndvi-density', 'worldcover'],
      map: mapState({
        layers: ['ndvi-density', 'worldcover'],
        bounds: base,
        basemap: 'satellite',
        caption: 'Densidad de vegetación derivada del NDVI y cobertura ESA WorldCover.',
        fly,
      }),
    },
  ];

  const hydrology = analysis.hydrology.summary;
  const hydroReach =
    hydrology.available && !hydrology.intersects_aoi && hydrology.nearest_distance_m != null
      ? hydrology.nearest_distance_m
      : 0;
  sections.push({
    id: 'hidrologia',
    eyebrow: 'Hidrología',
    title: 'Agua superficial',
    citedLayerIds: ['osm-hydro'],
    map: mapState({
      layers: ['osm-hydro'],
      bounds: framed(aoiBbox, hydroReach),
      basemap: 'light',
      caption: 'Cursos, cuerpos de agua y humedales mapeados en OpenStreetMap (buffer 500 m).',
      fly,
    }),
  });

  const protectedAreas = analysis.protected_areas.summary;
  const protectedReach =
    protectedAreas.available &&
    !protectedAreas.intersects_aoi &&
    protectedAreas.nearest_distance_m != null
      ? protectedAreas.nearest_distance_m
      : 0;
  sections.push({
    id: 'areas-protegidas',
    eyebrow: 'Áreas protegidas',
    title: 'Áreas protegidas (WDPA)',
    citedLayerIds: ['wdpa'],
    map: mapState({
      layers: ['wdpa'],
      bounds: framed(aoiBbox, protectedReach),
      basemap: 'light',
      caption: 'Áreas protegidas de la WDPA dentro del kilómetro alrededor del polígono.',
      fly,
      highlight: protectedAreas.intersects_aoi ? ['wdpa:*'] : [],
    }),
  });

  if (analysis.coastal != null) {
    sections.push({
      id: 'riesgo-costero',
      eyebrow: 'Riesgo costero',
      title: `Inundación costera — ${analysis.coastal.preset}`,
      citedLayerIds: ['aqueduct'],
      map: mapState({
        layers: ['aqueduct'],
        bounds: base,
        basemap: 'light',
        caption: `Profundidad de inundación proyectada (WRI Aqueduct, ${analysis.coastal.preset}).`,
        fly,
      }),
    });
  }

  if (analysis.mepyd_rd.in_rd) {
    const mepydIds = mepydLayerIdsWithData(analysis);
    const hazardIds = mepydIds.filter((id) => getLayer(id)?.subgroup === MEPYD_HAZARD_SUBGROUP);
    const shown = (hazardIds.length > 0 ? hazardIds : mepydIds).slice(0, MAX_VISIBLE_DATA_LAYERS);
    sections.push({
      id: 'contexto-rd',
      eyebrow: 'Contexto RD',
      title: 'Contexto RD (MEPyD)',
      citedLayerIds: shown.length > 0 ? shown.slice(0, 1) : [],
      map: mapState({
        layers: shown,
        bounds: base,
        basemap: 'light',
        caption:
          shown.length > 0
            ? 'Capas del Explorador de Riesgo del MEPyD con elementos cerca del polígono.'
            : 'Ninguna capa del MEPyD devolvió elementos cerca del polígono.',
        fly,
      }),
    });
  }

  sections.push({
    id: 'fuentes',
    eyebrow: 'Fuentes',
    title: 'Fuentes y metodología',
    citedLayerIds: [],
    map: mapState({
      layers: [],
      bounds: base,
      basemap: 'light',
      caption: 'Área de estudio y datasets efectivamente usados en esta corrida.',
      fly,
    }),
  });

  return sections;
}

/* -------------------------------------------------------------------------- */
/* Datasets — insumo de la tabla fija del §6.5                                 */
/* -------------------------------------------------------------------------- */

export type DatasetRow = {
  source: SourceRef;
  /** Capas de este análisis que salen de esa fuente. */
  layers: string[];
};

export type DatasetUsage = {
  used: DatasetRow[];
  /** "No disponibles en esta corrida", con el motivo. Nunca se omiten. */
  unavailable: { source: SourceRef; reason: string }[];
};

function sourceOf(layerId: string): LayerDef | undefined {
  return getLayer(layerId);
}

function push(rows: Map<string, DatasetRow>, layerId: string): void {
  const layer = sourceOf(layerId);
  if (layer === undefined) return;
  const existing = rows.get(layer.source.name);
  if (existing) existing.layers.push(layer.label);
  else rows.set(layer.source.name, { source: layer.source, layers: [layer.label] });
}

/**
 * Una fila por dataset **efectivamente usado en esta corrida** (§6.5), y una
 * nota aparte con los que no respondieron y su motivo.
 *
 * La lista NO sale del registro completo: un reporte que cita Sentinel-2
 * cuando Sentinel-2 no devolvió nada está atribuyendo un dato que no existe.
 */
export function datasetUsage(analysis: TerritorioAnalysisSummary): DatasetUsage {
  const used = new Map<string, DatasetRow>();
  const unavailable: { source: SourceRef; reason: string }[] = [];

  const consider = (
    ok: boolean,
    layerIds: string[],
    reason: string,
  ): void => {
    if (ok) {
      for (const id of layerIds) push(used, id);
      return;
    }
    const layer = layerIds.map(sourceOf).find((candidate) => candidate !== undefined);
    if (layer !== undefined) unavailable.push({ source: layer.source, reason });
  };

  push(used, 'aoi');

  consider(
    analysis.topography.available,
    ['dem', 'slope-classes'],
    analysis.topography.error ?? 'El servicio de elevación no respondió en esta corrida.',
  );
  consider(
    analysis.vegetation.ndvi_available,
    ['ndvi-density'],
    analysis.vegetation.ndvi_error ??
      'No hubo escenas Sentinel-2 con menos de 30 % de nubes en la ventana consultada.',
  );
  consider(
    analysis.vegetation.worldcover_available,
    ['worldcover'],
    analysis.vegetation.worldcover_error ?? 'ESA WorldCover no respondió en esta corrida.',
  );
  consider(
    analysis.hydrology.summary.available,
    ['osm-hydro'],
    'Overpass API no respondió en ninguno de sus mirrors.',
  );
  consider(
    analysis.protected_areas.summary.available,
    ['wdpa'],
    'El FeatureServer de la WDPA (UNEP-WCMC) no respondió.',
  );

  if (analysis.coastal != null) {
    consider(
      analysis.coastal.available,
      ['aqueduct'],
      analysis.coastal.error ?? 'WRI Aqueduct no respondió para el escenario elegido.',
    );
  }

  if (analysis.mepyd_rd.in_rd) {
    const mepydIds = mepydLayerIdsWithData(analysis);
    if (mepydIds.length > 0) {
      for (const id of mepydIds) push(used, id);
    } else {
      const anyMepyd = LAYER_REGISTRY.find((layer) => layer.group === MEPYD_GROUP);
      if (anyMepyd !== undefined) {
        unavailable.push({
          source: anyMepyd.source,
          reason:
            analysis.mepyd_rd.failures.length > 0
              ? `${String(analysis.mepyd_rd.failures.length)} capa(s) del MEPyD no respondieron y ninguna devolvió elementos cerca del polígono.`
              : 'Ninguna capa del MEPyD devolvió elementos cerca del polígono.',
        });
      }
    }
  }

  return { used: [...used.values()], unavailable };
}

/* -------------------------------------------------------------------------- */
/* Identidad del AOI                                                           */
/* -------------------------------------------------------------------------- */

const DPA_GROUP = 'División Político-Administrativa';
const DPA_LAYER = 'Municipios (límites, provincia, región, población)';

/** El mismo heurístico de display que usa el motor (inventario §6). */
const NAME_KEYS = ['MUN_NOM', 'NOMBRE', 'nombre', 'name'];
const PROVINCE_KEYS = ['PROV_NOM', 'PROVINCIA', 'provincia', 'REG_NOM'];

function firstStringField(
  attributes: Record<string, string | number | boolean | null>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

/**
 * Municipio y provincia de la portada (§6.2), tomados de la capa de División
 * Político-Administrativa del MEPyD. `null` fuera de RD o si esa capa no
 * devolvió nada: la portada muestra entonces sólo las coordenadas, que es un
 * dato verdadero, en vez de inventar una ubicación administrativa.
 */
export function locationLabel(analysis: TerritorioAnalysisSummary): string | null {
  if (!analysis.mepyd_rd.in_rd) return null;
  const entry = analysis.mepyd_rd.summary[DPA_GROUP]?.[DPA_LAYER];
  if (entry === undefined) return null;

  const names = new Set<string>();
  const provinces = new Set<string>();

  for (const attributes of entry.features) {
    const name = firstStringField(attributes, NAME_KEYS);
    if (name !== null) names.add(name);
    const province = firstStringField(attributes, PROVINCE_KEYS);
    if (province !== null) provinces.add(province);
  }

  const municipality = [...names].slice(0, 3).join(' / ');
  const province = [...provinces].slice(0, 2).join(' / ');

  if (municipality === '' && province === '') return null;
  if (province === '') return municipality;
  if (municipality === '') return province;
  return `${municipality}, ${province}`;
}
