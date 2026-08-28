/**
 * Las tarjetas de la pestaña ANÁLISIS.
 *
 * Lo que se prueba acá no es el copy —ése ya lo prueba `narrative.test.ts`—
 * sino el REPARTO: qué tarjeta cae en qué vista, y qué pasa con la tarjeta de
 * una fuente que no respondió. Antes de esto la ruta pasaba `cards={[]}` y la
 * pestaña imprimía "Todavía no hay resultados" con el análisis completo en
 * memoria.
 */
import { describe, expect, it } from 'vitest';

import {
  createAoi,
  MEPYD_LAYERS_FLAT,
  type Aoi,
  type AreaGeometry,
  type MepydLayerDef,
  type MepydResult,
  type SourceOutcome,
} from '@territorio/geo';

import { buildAnalysisCards } from './cards-model';

import type { AnalysisJob } from '@territorio/api-client';

import {
  DEFAULT_ANALYSIS_PARAMS,
  type CoastalRun,
  type TerritorioAnalysis,
} from '~/lib/analysis-contract';
import { mergeAnalysis, type RasterOutcome, type VectorOutcomes } from '~/lib/analysis-merge';

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

/** El mismo rectángulo en Costa Rica: fuera de RD. */
const AOI_OUTSIDE_RD: AreaGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [-84.1, 9.9],
      [-84.09, 9.9],
      [-84.09, 9.91],
      [-84.1, 9.91],
      [-84.1, 9.9],
    ],
  ],
};

const RASTER_RESULT: AnalysisJob = {
  id: 'raster-job-1',
  status: 'ok',
  created_at: '2026-01-01T00:00:00Z',
  events_url: '/analysis/raster-job-1/events',
  self_url: '/analysis/raster-job-1',
  progress: [],
  result: {
    aoi: { area_ha: 111.3, bbox: [-69.94, 18.47, -69.93, 18.48], utm_epsg: 32619 },
    topography: {
      available: true,
      summary: {
        elevation_min_m: 4,
        elevation_max_m: 61,
        elevation_mean_m: 27.5,
        elevation_range_m: 57,
        slope_mean_pct: 9.7,
        slope_max_pct: 46.2,
        slope_class_pct: { 'Plano (0-5%)': 100 },
      },
    },
    vegetation: {
      available: true,
      ndvi_available: true,
      worldcover_available: true,
      summary: {
        ndvi_mean: 0.62,
        ndvi_median: 0.64,
        ndvi_p90: 0.81,
        ndvi_density_class_pct: { 'Vegetación muy densa / dosel maduro': 84.8 },
        worldcover_tree_cover_pct: 7.3,
        worldcover_landcover_pct: { 'Área construida': 61.2 },
      },
    },
    provenance: { dem_source: 'cop-dem-glo-30', sentinel2_scene_count: 6 },
    layers: [],
  },
};

function mepydResult(inRd: boolean): MepydResult {
  const definition: MepydLayerDef | undefined = MEPYD_LAYERS_FLAT[0];
  if (definition === undefined) throw new Error('El catálogo MEPyD cambió de tamaño.');
  return {
    inRd,
    layers: inRd
      ? [
          {
            layer: definition,
            features: [{ properties: { MUN_NOM: 'Santo Domingo Este' }, geometry: AOI_GEOMETRY }],
          },
        ]
      : [],
    failures: [],
  };
}

const up = <T>(data: T): SourceOutcome<T> => ({ available: true, data });
const down = (reason: string): SourceOutcome<never> => ({
  available: false,
  error: new Error(reason),
});

function build(
  options: { raster?: RasterOutcome; vector?: Partial<VectorOutcomes>; aoi?: Aoi } = {},
): TerritorioAnalysis {
  const vector: VectorOutcomes = {
    hydrology: up([]),
    protectedAreas: up([]),
    mepyd: up(mepydResult(true)),
    ...options.vector,
  };
  return mergeAnalysis({
    id: 'analisis-1',
    createdAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:01:00Z',
    params: DEFAULT_ANALYSIS_PARAMS,
    aoi: options.aoi ?? createAoi(AOI_GEOMETRY),
    raster: options.raster ?? { available: true, job: RASTER_RESULT },
    vector,
  });
}

const noop = () => undefined;

describe('buildAnalysisCards', () => {
  it('produce una tarjeta por tema, más la de contexto RD', () => {
    const cards = buildAnalysisCards({ analysis: build(), onRetry: noop });
    expect(cards.map((card) => card.id)).toEqual([
      'elevacion',
      'vegetacion',
      'cobertura',
      'hidrologia',
      'areas-protegidas',
      'contexto-rd',
    ]);
  });

  it('reparte cada tarjeta en la vista que le corresponde', () => {
    const byId = new Map(
      buildAnalysisCards({ analysis: build(), onRetry: noop }).map((card) => [card.id, card.theme]),
    );
    expect(byId.get('elevacion')).toBe('topografia');
    expect(byId.get('vegetacion')).toBe('vegetacion');
    expect(byId.get('cobertura')).toBe('vegetacion');
    expect(byId.get('hidrologia')).toBe('hidrologia');
    expect(byId.get('areas-protegidas')).toBe('areas-protegidas');
    expect(byId.get('contexto-rd')).toBe('riesgo-rd');
  });

  it('convierte la fuente caída en tarjeta `no-data` con su servicio, sin tocar las demás', () => {
    const analysis = build({ vector: { hydrology: down('Overpass no respondió.') } });
    const cards = buildAnalysisCards({ analysis, onRetry: noop });
    const hydrology = cards.find((card) => card.id === 'hidrologia');
    const topography = cards.find((card) => card.id === 'elevacion');

    expect(hydrology?.failure).toBeDefined();
    expect(hydrology?.failure?.service).toContain('Overpass');
    // Regresión #3: la caída de una fuente no borra lo que las otras sí trajeron.
    expect(topography?.failure).toBeUndefined();
  });

  it('marca las tres tarjetas raster cuando cae el servicio raster', () => {
    const analysis = build({
      raster: { available: false, error: 'El servicio raster no respondió.' },
    });
    const failed = buildAnalysisCards({ analysis, onRetry: noop })
      .filter((card) => card.failure !== undefined)
      .map((card) => card.id);
    expect(failed).toEqual(['elevacion', 'vegetacion', 'cobertura']);
  });

  it('no dibuja contexto RD cuando el AOI está fuera de República Dominicana', () => {
    const analysis = build({
      aoi: createAoi(AOI_OUTSIDE_RD),
      vector: { mepyd: up(mepydResult(false)) },
    });
    const ids = buildAnalysisCards({ analysis, onRetry: noop }).map((card) => card.id);
    expect(ids).not.toContain('contexto-rd');
  });

  it('agrega la tarjeta costera cuando el análisis tiene un escenario adjunto', () => {
    const coastal: CoastalRun = {
      preset: 'Hoy (histórico) — 100 años de retorno',
      cache_key: 'k',
      available: true,
      error: null,
      summary: {
        has_data: true,
        pct_area_flooded: 12.5,
        max_depth_m: 1.4,
        mean_depth_where_flooded_m: 0.6,
        resolution_m_approx: 927,
      },
      overlay_url: null,
      raster_url: null,
    };
    const analysis: TerritorioAnalysis = { ...build(), coastal };
    const card = buildAnalysisCards({ analysis, onRetry: noop }).find(
      (item) => item.id === 'costera',
    );
    expect(card?.theme).toBe('riesgo-rd');
    expect(card?.failure).toBeUndefined();
  });
});
