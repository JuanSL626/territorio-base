import { describe, expect, it } from 'vitest';

import {
  createAoi,
  MEPYD_LAYERS_FLAT,
  type AreaGeometry,
  type Geometry,
  type HydrologyFeature,
  type MepydResult,
  type ProtectedAreaFeature,
  type SourceOutcome,
} from '@territorio/geo';

import { FEATURE_ID_KEY } from './layer-style';
import { buildVectorData } from './vector-data';

import type { AnalysisJob } from '@territorio/api-client';

import { buildLayerRuntime } from '~/components/layers/layer-runtime';
import { type TerritorioAnalysis, DEFAULT_ANALYSIS_PARAMS } from '~/lib/analysis-contract';
import { mepydLayerId, mergeAnalysis, type RasterOutcome } from '~/lib/analysis-merge';

// Fixtures: un AOI real en Santo Domingo, dentro de RD_BBOX

const AOI_GEOMETRY: AreaGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [-69.94, 18.47],
      [-69.93, 18.47],
      [-69.93, 18.48],
      [-69.94, 18.48],
      [-69.94, 18.47],
    ],
  ],
};

const LINE: Geometry = {
  type: 'LineString',
  coordinates: [
    [-69.945, 18.475],
    [-69.925, 18.475],
  ],
};

const POLYGON: Geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [-69.92, 18.47],
      [-69.91, 18.47],
      [-69.91, 18.48],
      [-69.92, 18.48],
      [-69.92, 18.47],
    ],
  ],
};

const aoi = createAoi(AOI_GEOMETRY);

const HYDROLOGY: HydrologyFeature[] = [
  { osmId: 24_193, kind: 'waterway', name: 'Río Ozama', geometry: LINE },
  { osmId: 55, kind: 'wetland', name: null, geometry: POLYGON },
];

const PROTECTED: ProtectedAreaFeature[] = [
  {
    name: 'Parque Nacional Sibarí',
    desig: 'Parque Nacional',
    desigEng: 'National Park',
    iucnCat: 'II',
    status: 'Designated',
    mangAuth: 'Ministerio de Medio Ambiente',
    geometry: POLYGON,
  },
];

const mepydDef = MEPYD_LAYERS_FLAT[0];
if (mepydDef === undefined) throw new Error('El catálogo MEPyD cambió de tamaño.');

const MEPYD: MepydResult = {
  inRd: true,
  layers: [
    {
      layer: mepydDef,
      features: [
        { properties: { MUN_NOM: 'Santo Domingo Este', POB: 948_855 }, geometry: POLYGON },
      ],
    },
  ],
  failures: [],
};

const RASTER_JOB: AnalysisJob = {
  id: 'raster-1',
  status: 'ok',
  created_at: '2026-01-01T00:00:00Z',
  events_url: '/analysis/raster-1/events',
  self_url: '/analysis/raster-1',
  progress: [],
  result: {
    aoi: { area_ha: 111.3, bbox: [-69.94, 18.47, -69.93, 18.48], utm_epsg: 32619 },
    topography: { available: true, summary: null },
    vegetation: {
      available: true,
      ndvi_available: true,
      worldcover_available: true,
      summary: null,
    },
    provenance: {},
    layers: [
      {
        layer: 'dem',
        kind: 'continuous',
        label: 'Elevación (DEM)',
        default_opacity: 0.7,
        available: true,
        download_filename: 'elevacion.tif',
        overlay_url: '/analysis/raster-1/overlay/dem.png',
        overlay_metadata_url: '/analysis/raster-1/overlay/dem.json',
        raster_url: '/analysis/raster-1/raster/dem.tif',
      },
    ],
  },
};

const up = <T>(data: T): SourceOutcome<T> => ({ available: true, data });
const down = (reason: string): SourceOutcome<never> => ({
  available: false,
  error: new Error(reason),
});

function analysisWith(overrides: {
  hydrology?: SourceOutcome<readonly HydrologyFeature[]>;
  protectedAreas?: SourceOutcome<readonly ProtectedAreaFeature[]>;
  mepyd?: SourceOutcome<MepydResult>;
  raster?: RasterOutcome;
}): TerritorioAnalysis {
  return mergeAnalysis({
    id: 'analisis-1',
    createdAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:05:00Z',
    params: DEFAULT_ANALYSIS_PARAMS,
    aoi,
    raster: overrides.raster ?? { available: true, job: RASTER_JOB },
    vector: {
      hydrology: overrides.hydrology ?? up(HYDROLOGY),
      protectedAreas: overrides.protectedAreas ?? up(PROTECTED),
      mepyd: overrides.mepyd ?? up(MEPYD),
    },
  });
}

describe('buildVectorData', () => {
  const data = buildVectorData(analysisWith({}));

  it('el AOI es siempre una capa, con su propio feature', () => {
    expect(data.get('aoi')?.data.features).toHaveLength(1);
    expect(data.get('aoi')?.data.features[0]?.geometry).toEqual(AOI_GEOMETRY);
  });

  it('cada feature lleva un id sintético estable', () => {
    const hydro = data.get('osm-hydro');
    expect(hydro?.data.features.map((feature) => feature.properties?.[FEATURE_ID_KEY])).toEqual([
      'osm-24193',
      'osm-55',
    ]);
  });

  it('el id de hidrología usa el osm_id REAL, así un link sobrevive un reanálisis', () => {
    const first = data.get('osm-hydro')?.data.features[0];
    expect(first?.properties?.osm_id).toBe(24_193);
    expect(first?.properties?.[FEATURE_ID_KEY]).toBe('osm-24193');
  });

  it('hidrología conserva las propiedades que el popup nombra', () => {
    const first = data.get('osm-hydro')?.data.features[0];
    expect(first?.properties).toMatchObject({ kind: 'waterway', name: 'Río Ozama' });
    expect(typeof first?.properties?.distance_m).toBe('number');
  });

  it('WDPA conserva `desig_eng` y `mang_auth` para la exportación aunque no se muestren', () => {
    const first = data.get('wdpa')?.data.features[0];
    expect(first?.properties?.desig_eng).toBe('National Park');
  });

  it('MEPyD se indexa por el id del registro y copia sus atributos dinámicos', () => {
    const layerId = mepydLayerId(mepydDef.group, mepydDef.label);
    const entry = data.get(layerId);
    expect(entry?.count).toBe(1);
    expect(entry?.data.features[0]?.properties).toMatchObject({
      MUN_NOM: 'Santo Domingo Este',
      POB: 948_855,
    });
  });

  it('sin análisis, el índice está vacío (no hay capas fantasma)', () => {
    expect(buildVectorData(null).size).toBe(0);
  });
});

// Regresión #3: "no se pudo consultar" ≠ "consulté y no hay nada"

describe('buildLayerRuntime — el estado por fila (§4.3)', () => {
  function runtimeFor(analysis: TerritorioAnalysis) {
    const data = buildVectorData(analysis);
    const featureCounts = new Map<string, number>();
    for (const [layerId, entry] of data) featureCounts.set(layerId, entry.count);
    const producedRasters = new Set(
      analysis.layers.filter((entry) => entry.available).map(() => 'dem'),
    );
    return buildLayerRuntime({ analysis, featureCounts, producedRasters });
  }

  it('Overpass caído → `error` con reintento, NO "sin datos"', () => {
    const runtime = runtimeFor(analysisWith({ hydrology: down('504') }));
    expect(runtime['osm-hydro']).toMatchObject({ status: 'error', reason: 'Overpass caído' });
    // El texto largo del §8 viaja aparte, como `title` del chip.
    expect(runtime['osm-hydro']?.detail).toContain('Overpass API');
  });

  it('Overpass vivo sin resultados → `empty`, que es un resultado válido', () => {
    const runtime = runtimeFor(analysisWith({ hydrology: up([]) }));
    expect(runtime['osm-hydro']).toMatchObject({ status: 'empty', reason: 'sin datos' });
  });

  it('una fuente caída no contamina a las demás', () => {
    const runtime = runtimeFor(analysisWith({ hydrology: down('504') }));
    expect(runtime.wdpa).toMatchObject({ status: 'ok' });
    expect(runtime.dem).toEqual({ status: 'ok' });
  });

  it('el conteo de features viaja a la fila para el chip numérico', () => {
    expect(runtimeFor(analysisWith({})).wdpa).toEqual({ status: 'ok', featureCount: 1 });
  });

  it('sin análisis, toda capa de datos dice "sin AOI" en vez de fingir estar lista', () => {
    const runtime = buildLayerRuntime({
      analysis: null,
      featureCounts: new Map(),
      producedRasters: new Set(),
    });
    expect(runtime['osm-hydro']).toMatchObject({ status: 'skipped', reason: 'sin AOI' });
    expect(runtime.dem).toMatchObject({ status: 'skipped', reason: 'sin AOI' });
  });

  it('el costero no pedido es `skipped`, no un error', () => {
    expect(runtimeFor(analysisWith({})).aqueduct).toMatchObject({
      status: 'skipped',
      reason: 'elegí escenario',
    });
  });
});
