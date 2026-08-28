/**
 * Resúmenes vectoriales, en la forma **exacta** del contrato de datos del
 * inventario §3. Las claves van en `snake_case` a propósito: este objeto es el
 * payload que la API devuelve y que el reporte consume, y el inventario lo
 * define así.
 *
 * Lo que este módulo protege:
 *
 * - `available: false` es **semánticamente distinto** de "consulté y no hay
 *   nada" (regresión #3). Gobierna el color y el texto del banner
 *   (UC-13..20 / TC-07..14), así que se modela como un estado propio y no
 *   como una lista vacía.
 * - `intersects_aoi` sale de `booleanIntersects`, nunca de `distance === 0`
 *   (H9).
 * - `distance_m` es distancia **segmento a segmento** en UTM, no
 *   vértice a vértice (H8).
 */

import { z } from 'zod';

import { projectGeometry, WGS84_EPSG, type UtmEpsg } from './crs';
import { intersects, planarArea, planarDistance, planarIntersection } from './geometry';

import type { Aoi } from './aoi';
import type { AreaGeometry, Geometry } from './geojson';
import type { MepydResult } from './sources/mepyd';
import type { HydrologyFeature, HydrologyKind } from './sources/overpass';
import type { ProtectedAreaFeature } from './sources/wdpa';

/**
 * Resultado de una fuente externa: o trajo datos, o no respondió. Nunca se
 * colapsan los dos casos en "lista vacía".
 */
export type SourceOutcome<T> = { available: true; data: T } | { available: false; error?: unknown };

export const hydrologyFeatureSummarySchema = z.object({
  osm_id: z.number(),
  kind: z.union([z.literal('waterway'), z.literal('water_body'), z.literal('wetland')]),
  name: z.string().nullable(),
  distance_m: z.number(),
});

export const hydrologySummarySchema = z.object({
  available: z.boolean(),
  features_found: z.number().int(),
  intersects_aoi: z.boolean(),
  nearest_distance_m: z.number().nullable(),
  features: z.array(hydrologyFeatureSummarySchema),
});

export type HydrologyFeatureSummary = {
  osm_id: number;
  kind: HydrologyKind;
  name: string | null;
  distance_m: number;
};

export type HydrologySummary = {
  available: boolean;
  features_found: number;
  intersects_aoi: boolean;
  nearest_distance_m: number | null;
  features: HydrologyFeatureSummary[];
};

export const protectedAreaSummarySchema = z.object({
  name: z.string().nullable(),
  desig: z.string().nullable(),
  iucn_cat: z.string().nullable(),
  status: z.string().nullable(),
  distance_m: z.number(),
  overlap_ha: z.number(),
});

export const protectedAreasSummarySchema = z.object({
  available: z.boolean(),
  areas_found: z.number().int(),
  intersects_aoi: z.boolean(),
  overlap_ha: z.number(),
  overlap_pct_of_aoi: z.number(),
  nearest_distance_m: z.number().nullable(),
  areas: z.array(protectedAreaSummarySchema),
});

export type ProtectedAreaSummary = {
  name: string | null;
  desig: string | null;
  iucn_cat: string | null;
  status: string | null;
  distance_m: number;
  overlap_ha: number;
};

export type ProtectedAreasSummary = {
  available: boolean;
  areas_found: number;
  intersects_aoi: boolean;
  overlap_ha: number;
  overlap_pct_of_aoi: number;
  nearest_distance_m: number | null;
  areas: ProtectedAreaSummary[];
};

export type MepydLayerSummary = { count: number; features: Record<string, unknown>[] };
/** `{ "<grupo>": { "<capa>": { count, features } } }` — inventario §3. */
export type MepydSummary = Record<string, Record<string, MepydLayerSummary>>;

export const mepydSummarySchema: z.ZodType<MepydSummary> = z.record(
  z.string(),
  z.record(
    z.string(),
    z.object({ count: z.number().int(), features: z.array(z.record(z.string(), z.unknown())) }),
  ),
);

type Proximity = { distance: number; intersects: boolean };

/**
 * Distancia en metros de cada geometría al AOI, proyectando **una sola vez** el
 * AOI. La intersección se decide con `booleanIntersects` y la distancia se fija
 * en `0` exacto en ese caso — nunca al revés (H9).
 */
function proximityToAoi(
  aoiWgs84: Geometry,
  aoiUtm: Geometry,
  utmEpsg: UtmEpsg,
  geometries: readonly Geometry[],
): Proximity[] {
  return geometries.map((geometry) => {
    if (intersects(aoiWgs84, geometry)) return { distance: 0, intersects: true };
    return {
      distance: planarDistance(aoiUtm, projectGeometry(geometry, WGS84_EPSG, utmEpsg)),
      intersects: false,
    };
  });
}

/** Orden estable por distancia ascendente (el `sorted()` de Python también lo es). */
function stableOrderByDistance(distances: readonly number[]): number[] {
  return distances
    .map((distance, index) => ({ distance, index }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .map((entry) => entry.index);
}

/**
 * Resumen de hidrología. `available: false` (UC-09 / TC-11) se representa con
 * conteo 0 y `nearest_distance_m: null`, igual que el legacy, pero el booleano
 * lo distingue de "no hay nada cerca" (TC-14).
 */
export function summarizeHydrology(
  aoi: Aoi,
  outcome: SourceOutcome<readonly HydrologyFeature[]>,
): HydrologySummary {
  if (!outcome.available) {
    return {
      available: false,
      features_found: 0,
      intersects_aoi: false,
      nearest_distance_m: null,
      features: [],
    };
  }

  const features = outcome.data;
  if (features.length === 0) {
    return {
      available: true,
      features_found: 0,
      intersects_aoi: false,
      nearest_distance_m: null,
      features: [],
    };
  }

  const aoiUtm = projectGeometry(aoi.geometry, WGS84_EPSG, aoi.utmEpsg);
  const proximity = proximityToAoi(
    aoi.geometry,
    aoiUtm,
    aoi.utmEpsg,
    features.map((f) => f.geometry),
  );
  const distances = proximity.map((p) => p.distance);
  const order = stableOrderByDistance(distances);

  return {
    available: true,
    features_found: features.length,
    intersects_aoi: proximity.some((p) => p.intersects),
    nearest_distance_m: Math.min(...distances),
    features: order.map((index) => {
      const feature = features[index];
      const distance = distances[index];
      if (feature === undefined || distance === undefined) {
        throw new Error('summarizeHydrology: índice fuera de rango.');
      }
      return {
        osm_id: feature.osmId,
        kind: feature.kind,
        name: feature.name,
        distance_m: distance,
      };
    }),
  };
}

function asAreaOrNull(geometry: Geometry): AreaGeometry | null {
  return geometry.type === 'Polygon' || geometry.type === 'MultiPolygon' ? geometry : null;
}

/**
 * Resumen de áreas protegidas. `desig` replica la preferencia del legacy:
 * `desig_eng` si existe, si no `desig`.
 */
export function summarizeProtectedAreas(
  aoi: Aoi,
  outcome: SourceOutcome<readonly ProtectedAreaFeature[]>,
): ProtectedAreasSummary {
  const empty = (available: boolean): ProtectedAreasSummary => ({
    available,
    areas_found: 0,
    intersects_aoi: false,
    overlap_ha: 0,
    overlap_pct_of_aoi: 0,
    nearest_distance_m: null,
    areas: [],
  });

  if (!outcome.available) return empty(false);
  const areas = outcome.data;
  if (areas.length === 0) return empty(true);

  const aoiUtm = projectGeometry(aoi.geometry, WGS84_EPSG, aoi.utmEpsg);
  const aoiUtmArea = asAreaOrNull(aoiUtm);
  const aoiAreaHa = planarArea(aoiUtm) / 10_000;

  const proximity = proximityToAoi(
    aoi.geometry,
    aoiUtm,
    aoi.utmEpsg,
    areas.map((a) => a.geometry),
  );
  const distances = proximity.map((p) => p.distance);

  const overlapsHa = areas.map((area) => {
    const areaUtm = asAreaOrNull(projectGeometry(area.geometry, WGS84_EPSG, aoi.utmEpsg));
    if (areaUtm === null || aoiUtmArea === null) return 0;
    const clipped = planarIntersection(areaUtm, aoiUtmArea);
    return clipped === null ? 0 : planarArea(clipped) / 10_000;
  });

  const overlapHa = overlapsHa.reduce((sum, value) => sum + value, 0);
  const order = stableOrderByDistance(distances);

  return {
    available: true,
    areas_found: areas.length,
    intersects_aoi: proximity.some((p) => p.intersects),
    overlap_ha: overlapHa,
    overlap_pct_of_aoi: aoiAreaHa === 0 ? 0 : (overlapHa / aoiAreaHa) * 100,
    nearest_distance_m: Math.min(...distances),
    areas: order.map((index) => {
      const area = areas[index];
      const distance = distances[index];
      const overlap = overlapsHa[index];
      if (area === undefined || distance === undefined || overlap === undefined) {
        throw new Error('summarizeProtectedAreas: índice fuera de rango.');
      }
      return {
        name: area.name,
        desig: area.desigEng ?? area.desig,
        iucn_cat: area.iucnCat,
        status: area.status,
        distance_m: distance,
        overlap_ha: overlap,
      };
    }),
  };
}

/**
 * `{ grupo: { capa: { count, features } } }`, en el orden del catálogo.
 * `fetchAllMepyd` ya descartó las capas vacías, así que toda capa presente
 * tiene `count >= 1` (por eso "Sin atributos." del legacy era código muerto).
 */
export function summarizeMepyd(result: MepydResult): MepydSummary {
  const summary: MepydSummary = {};
  for (const entry of result.layers) {
    const group = (summary[entry.layer.group] ??= {});
    group[entry.layer.label] = {
      count: entry.features.length,
      features: entry.features.map((f) => f.properties),
    };
  }
  return summary;
}

/** Lo que este paquete aporta al `results` del inventario §3. */
export type VectorAnalysis = {
  aoi: { area_ha: number; bbox: Aoi['bbox']; utm_epsg: number };
  hydrology: { summary: HydrologySummary; features: HydrologyFeature[] };
  protected_areas: { summary: ProtectedAreasSummary; areas: ProtectedAreaFeature[] };
  mepyd_rd: { in_rd: boolean; summary: MepydSummary; result: MepydResult };
};

/**
 * Ensambla el bloque vectorial completo a partir de resultados ya obtenidos.
 * Se separa del fetching a propósito: así el llamador decide su propia política
 * de aislamiento de fallos y este módulo queda puro y testeable sin red.
 */
export function buildVectorAnalysis(
  aoi: Aoi,
  input: {
    hydrology: SourceOutcome<readonly HydrologyFeature[]>;
    protectedAreas: SourceOutcome<readonly ProtectedAreaFeature[]>;
    mepyd: MepydResult;
  },
): VectorAnalysis {
  return {
    aoi: { area_ha: aoi.areaHa, bbox: aoi.bbox, utm_epsg: aoi.utmEpsg },
    hydrology: {
      summary: summarizeHydrology(aoi, input.hydrology),
      features: input.hydrology.available ? [...input.hydrology.data] : [],
    },
    protected_areas: {
      summary: summarizeProtectedAreas(aoi, input.protectedAreas),
      areas: input.protectedAreas.available ? [...input.protectedAreas.data] : [],
    },
    mepyd_rd: {
      in_rd: input.mepyd.inRd,
      summary: summarizeMepyd(input.mepyd),
      result: input.mepyd,
    },
  };
}
