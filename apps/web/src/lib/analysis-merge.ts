/**
 * La costura: raster (servicio Python) + vector (`@territorio/geo`, en proceso)
 * → UN resultado con la forma del inventario §3.
 *
 * Este módulo es **puro**. No hace red, no toca la base, no importa nada de
 * `@tanstack/react-start`. Todo el aislamiento de fallos se decide acá, y por
 * eso se puede probar la matriz completa de fuentes arriba/abajo sin levantar
 * un solo servicio (`analysis-merge.test.ts`).
 *
 * Regresión #3 — la regla que este archivo hace cumplir:
 * Cada fuente entra como `SourceOutcome` (`@territorio/geo`): o trajo datos, o
 * no respondió. Nunca "lista vacía" para las dos cosas. La función NO tiene
 * ningún camino en el que el fallo de una fuente afecte a otra: los cuatro
 * bloques se construyen por separado y se juntan al final. Un servicio caído
 * baja su propio `available` a `false`, deja el resto intacto y lleva el estado
 * global a `partial` — jamás a `error`, salvo que **todo** lo consultado haya
 * fallado.
 */
import {
  isInRd,
  summarizeHydrology,
  summarizeMepyd,
  summarizeProtectedAreas,
  type Aoi,
  type HydrologyFeature,
  type MepydResult,
  type ProtectedAreaFeature,
  type SourceOutcome,
} from '@territorio/geo';

import {
  ANALYSIS_SOURCE_IDS,
  SOURCE_DOWN_MESSAGES,
  SOURCE_SERVICE_NAMES,
  toMepydAttributes,
  type AnalysisMepydSummary,
  type AnalysisParams,
  type AnalysisSourceId,
  type CoastalRun,
  type HydrologyFeatureGeo,
  type MepydLayerFailure,
  type MepydLayerGeo,
  type ProtectedAreaGeo,
  type SourceState,
  type SourceStatus,
  type TerritorioAnalysis,
} from './analysis-contract';

import type { AnalysisJob, AnalysisStatus } from '@territorio/api-client';

import { slugify } from '~/layers/mepyd';

/**
 * El lado raster. `available: false` cubre las dos formas de "el servicio no
 * está": no se pudo crear el job, o el job terminó en `error`. En los dos
 * casos el bloque vectorial sigue siendo un resultado válido.
 */
export type RasterOutcome =
  { available: true; job: AnalysisJob } | { available: false; error: string };

export type VectorOutcomes = {
  hydrology: SourceOutcome<readonly HydrologyFeature[]>;
  protectedAreas: SourceOutcome<readonly ProtectedAreaFeature[]>;
  /** `fetchAllMepyd` no lanza por capa; `available: false` = falló la llamada entera. */
  mepyd: SourceOutcome<MepydResult>;
};

export type MergeAnalysisInput = {
  id: string;
  createdAt: string;
  finishedAt: string | null;
  params: AnalysisParams;
  /** El AOI que produjo estos resultados. Fuente única de verdad (UC-05/TC-47). */
  aoi: Aoi;
  raster: RasterOutcome;
  vector: VectorOutcomes;
  coastal?: CoastalRun | null;
};

function reasonText(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message === '' ? fallback : message;
  }
  if (typeof error === 'string' && error.trim() !== '') return error.trim();
  return fallback;
}

function sourceStatus(
  id: AnalysisSourceId,
  state: SourceState,
  found: number,
  error: string | null,
): SourceStatus {
  return {
    id,
    service: SOURCE_SERVICE_NAMES[id],
    available: state !== 'error',
    state,
    found,
    error: state === 'error' ? (error ?? SOURCE_DOWN_MESSAGES[id]) : null,
  };
}

/**
 * Une la lista **resumida** (ordenada por distancia) con la lista **cruda**
 * (en orden de llegada, con geometría).
 *
 * Por qué hace falta: `summarizeHydrology` / `summarizeProtectedAreas` de
 * `@territorio/geo` calculan distancia y solape y devuelven las filas
 * reordenadas por cercanía, sin geometría. El mapa necesita las dos cosas en la
 * misma fila. Recalcular la distancia acá sería duplicar la matemática de H8/H9
 * y arriesgar dos números distintos para lo mismo en la tabla y en el mapa.
 *
 * El emparejamiento es por clave natural, con **cola por clave**: si dos filas
 * comparten clave son indistinguibles para el usuario (mismos atributos), así
 * que consumirlas en orden de llegada es correcto, no una aproximación.
 */
function joinByKey<Raw, Summary, Out>(
  raws: readonly Raw[],
  summaries: readonly Summary[],
  keyOfRaw: (raw: Raw) => string,
  keyOfSummary: (summary: Summary) => string,
  combine: (summary: Summary, raw: Raw) => Out,
): Out[] {
  const queues = new Map<string, Raw[]>();
  for (const raw of raws) {
    const key = keyOfRaw(raw);
    const queue = queues.get(key);
    if (queue === undefined) queues.set(key, [raw]);
    else queue.push(raw);
  }

  const out: Out[] = [];
  for (const summary of summaries) {
    const queue = queues.get(keyOfSummary(summary));
    const raw = queue?.shift();
    // Sin par no se inventa una geometría: la fila queda sólo en el resumen.
    if (raw === undefined) continue;
    out.push(combine(summary, raw));
  }
  return out;
}

const EMPTY_RASTER = {
  topography: { available: false, error: null, summary: null },
  vegetation: {
    available: false,
    error: null,
    ndvi_available: false,
    ndvi_error: null,
    worldcover_available: false,
    worldcover_error: null,
    summary: null,
  },
  provenance: {},
  layers: [],
} as const;

type RasterBlock = Pick<
  TerritorioAnalysis,
  'raster_job_id' | 'topography' | 'vegetation' | 'provenance' | 'layers'
> & { status: SourceStatus; degraded: boolean };

function buildRaster(outcome: RasterOutcome): RasterBlock {
  if (!outcome.available) {
    return {
      raster_job_id: null,
      topography: { ...EMPTY_RASTER.topography, error: outcome.error },
      vegetation: {
        ...EMPTY_RASTER.vegetation,
        error: outcome.error,
        ndvi_error: outcome.error,
        worldcover_error: outcome.error,
      },
      provenance: {},
      layers: [],
      status: sourceStatus('raster', 'error', 0, outcome.error),
      degraded: true,
    };
  }

  const { job } = outcome;
  const result = job.result;

  if (result == null) {
    // El job existe pero no dejó resultado: terminó en error, o lo estamos
    // fusionando antes de tiempo. En los dos casos, raster no está disponible.
    const error = job.error ?? SOURCE_DOWN_MESSAGES.raster;
    return {
      raster_job_id: job.id,
      topography: { ...EMPTY_RASTER.topography, error },
      vegetation: {
        ...EMPTY_RASTER.vegetation,
        error,
        ndvi_error: error,
        worldcover_error: error,
      },
      provenance: {},
      layers: [],
      status: sourceStatus('raster', 'error', 0, error),
      degraded: true,
    };
  }

  const produced = result.layers.filter((layer) => layer.available);
  const degraded =
    !result.topography.available ||
    !result.vegetation.ndvi_available ||
    !result.vegetation.worldcover_available;

  return {
    raster_job_id: job.id,
    topography: result.topography,
    vegetation: result.vegetation,
    provenance: result.provenance,
    layers: result.layers,
    status: sourceStatus('raster', produced.length === 0 ? 'empty' : 'ok', produced.length, null),
    degraded,
  };
}

function buildHydrology(
  aoi: Aoi,
  outcome: SourceOutcome<readonly HydrologyFeature[]>,
): { block: TerritorioAnalysis['hydrology']; status: SourceStatus } {
  const summary = summarizeHydrology(aoi, outcome);
  const raws = outcome.available ? outcome.data : [];

  const features: HydrologyFeatureGeo[] = joinByKey(
    raws,
    summary.features,
    (raw) => `${raw.kind}:${raw.osmId}`,
    (row) => `${row.kind}:${row.osm_id}`,
    (row, raw) => ({
      osm_id: row.osm_id,
      kind: row.kind,
      name: row.name,
      distance_m: row.distance_m,
      geometry: raw.geometry,
    }),
  );

  const status = outcome.available
    ? sourceStatus(
        'hidrologia',
        summary.features_found === 0 ? 'empty' : 'ok',
        summary.features_found,
        null,
      )
    : sourceStatus(
        'hidrologia',
        'error',
        0,
        reasonText(outcome.error, SOURCE_DOWN_MESSAGES.hidrologia),
      );

  return { block: { summary, features }, status };
}

function buildProtectedAreas(
  aoi: Aoi,
  outcome: SourceOutcome<readonly ProtectedAreaFeature[]>,
): { block: TerritorioAnalysis['protected_areas']; status: SourceStatus } {
  const summary = summarizeProtectedAreas(aoi, outcome);
  const raws = outcome.available ? outcome.data : [];

  // `summarizeProtectedAreas` prefiere `desigEng` sobre `desig`, así que la
  // clave del lado crudo tiene que aplicar la misma preferencia.
  const areas: ProtectedAreaGeo[] = joinByKey(
    raws,
    summary.areas,
    (raw) => [raw.name, raw.desigEng ?? raw.desig, raw.iucnCat, raw.status].join('|'),
    (row) => [row.name, row.desig, row.iucn_cat, row.status].join('|'),
    (row, raw) => ({
      name: row.name,
      desig: raw.desig,
      desig_eng: raw.desigEng,
      iucn_cat: row.iucn_cat,
      status: row.status,
      mang_auth: raw.mangAuth,
      distance_m: row.distance_m,
      overlap_ha: row.overlap_ha,
      geometry: raw.geometry,
    }),
  );

  const status = outcome.available
    ? sourceStatus(
        'areas-protegidas',
        summary.areas_found === 0 ? 'empty' : 'ok',
        summary.areas_found,
        null,
      )
    : sourceStatus(
        'areas-protegidas',
        'error',
        0,
        reasonText(outcome.error, SOURCE_DOWN_MESSAGES['areas-protegidas']),
      );

  return { block: { summary, areas }, status };
}

/**
 * `summarizeMepyd` de `@territorio/geo` tipa los atributos como
 * `Record<string, unknown>`; el contrato los acota a escalares. Es la misma
 * data, con el tipo que refleja lo que un FeatureServer devuelve de verdad.
 */
function narrowMepydSummary(
  summary: Record<string, Record<string, { count: number; features: Record<string, unknown>[] }>>,
): AnalysisMepydSummary {
  const out: AnalysisMepydSummary = {};
  for (const [group, layers] of Object.entries(summary)) {
    const narrowed: AnalysisMepydSummary[string] = {};
    for (const [label, entry] of Object.entries(layers)) {
      narrowed[label] = {
        count: entry.count,
        features: entry.features.map(toMepydAttributes),
      };
    }
    out[group] = narrowed;
  }
  return out;
}

/** Id de capa del registro: `mepyd:<grupo-slug>/<capa-slug>` (`~/layers/mepyd`). */
export function mepydLayerId(group: string, label: string): string {
  return `mepyd:${slugify(group)}/${slugify(label)}`;
}

function buildMepyd(
  inRdByBbox: boolean,
  outcome: SourceOutcome<MepydResult>,
): { block: TerritorioAnalysis['mepyd_rd']; status: SourceStatus } {
  if (!outcome.available) {
    return {
      block: {
        in_rd: inRdByBbox,
        summary: {},
        layers: [],
        failures: [],
        geometries_omitted: false,
      },
      status: sourceStatus(
        'mepyd',
        // Fuera de RD no se consulta nada: eso es `skipped`, no un fallo
        // (UC-11). Adentro de RD, que la llamada entera reviente sí lo es.
        inRdByBbox ? 'error' : 'skipped',
        0,
        reasonText(outcome.error, SOURCE_DOWN_MESSAGES.mepyd),
      ),
    };
  }

  const result = outcome.data;
  const layers: MepydLayerGeo[] = result.layers.map((entry) => ({
    layer_id: mepydLayerId(entry.layer.group, entry.layer.label),
    group: entry.layer.group,
    label: entry.layer.label,
    count: entry.features.length,
    features: entry.features.map((feature) => ({
      properties: toMepydAttributes(feature.properties),
      geometry: feature.geometry,
    })),
  }));

  const failures: MepydLayerFailure[] = result.failures.map((failure) => ({
    group: failure.layer.group,
    label: failure.layer.label,
    reason: reasonText(failure.error, 'El servicio de la capa no respondió.'),
  }));

  const found = layers.reduce((total, layer) => total + layer.count, 0);

  /*
    MEPyD son ~39 servicios independientes y el catálogo los aísla capa por
    capa. Que TODAS fallen y ninguna traiga datos es indistinguible de "el
    portal está caído", y así se reporta (TC-25). Que algunas fallen y otras
    traigan datos NO baja `available`: es el caso normal de un portal con
    capas intermitentes, y las fallidas viajan en `failures` para pintarse en
    gris con su motivo (§7.2) en vez de desaparecer en silencio.
  */
  const allFailed = result.inRd && layers.length === 0 && failures.length > 0;

  let state: SourceState;
  if (!result.inRd) state = 'skipped';
  else if (allFailed) state = 'error';
  else if (layers.length === 0) state = 'empty';
  else state = 'ok';

  return {
    block: {
      in_rd: result.inRd,
      summary: narrowMepydSummary(summarizeMepyd(result)),
      layers,
      failures,
      geometries_omitted: false,
    },
    status: sourceStatus('mepyd', state, found, SOURCE_DOWN_MESSAGES.mepyd),
  };
}

/**
 * `ok` sólo si todo lo consultado respondió; `error` sólo si nada respondió;
 * `partial` en el medio — que es el caso interesante y el que el legacy no
 * podía representar.
 *
 * Una fuente `skipped` (MEPyD fuera de RD) no cuenta ni a favor ni en contra:
 * no se consultó.
 */
export function resolveAnalysisStatus(
  sources: readonly SourceStatus[],
  rasterDegraded: boolean,
): AnalysisStatus {
  const queried = sources.filter((source) => source.state !== 'skipped');
  if (queried.length === 0) return 'error';

  const failed = queried.filter((source) => source.state === 'error');
  if (failed.length === queried.length) return 'error';
  if (failed.length > 0) return 'partial';
  return rasterDegraded ? 'partial' : 'ok';
}

export function mergeAnalysis(input: MergeAnalysisInput): TerritorioAnalysis {
  const raster = buildRaster(input.raster);
  const hydrology = buildHydrology(input.aoi, input.vector.hydrology);
  const protectedAreas = buildProtectedAreas(input.aoi, input.vector.protectedAreas);

  /*
    Si la llamada a MEPyD reventó entera no hay `inRd` que leer, así que se
    decide con el bbox del AOI — la misma regla que usa `fetchAllMepyd`. Sin
    esto, un AOI fuera de RD con MEPyD caído se reportaría como servicio caído
    cuando en realidad nunca se lo iba a consultar (UC-11).
  */
  const inRdByBbox = input.vector.mepyd.available
    ? input.vector.mepyd.data.inRd
    : isInRd(input.aoi.bbox);
  const mepyd = buildMepyd(inRdByBbox, input.vector.mepyd);

  // El ORDEN es el del §1.4 y el de las tarjetas del reporte.
  const sources: SourceStatus[] = [
    raster.status,
    hydrology.status,
    protectedAreas.status,
    mepyd.status,
  ];

  return {
    id: input.id,
    raster_job_id: raster.raster_job_id,
    status: resolveAnalysisStatus(sources, raster.degraded),
    created_at: input.createdAt,
    finished_at: input.finishedAt,
    params: input.params,

    aoi: {
      area_ha: input.aoi.areaHa,
      bbox: input.aoi.bbox,
      utm_epsg: input.aoi.utmEpsg,
      vertex_count: input.aoi.vertexCount,
    },
    aoi_geometry: input.aoi.geometry,

    topography: raster.topography,
    vegetation: raster.vegetation,

    hydrology: hydrology.block,
    protected_areas: protectedAreas.block,
    mepyd_rd: mepyd.block,

    provenance: raster.provenance,
    layers: raster.layers,
    sources,
    coastal: input.coastal ?? null,
  };
}
/** Las cuatro fuentes, para tests y para pintar el estado inicial. */
export const ALL_SOURCE_IDS = ANALYSIS_SOURCE_IDS;
