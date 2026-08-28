import { describe, expect, it } from 'vitest';

import {
  buildVectorAnalysis,
  hydrologySummarySchema,
  protectedAreasSummarySchema,
  summarizeHydrology,
  summarizeMepyd,
  summarizeProtectedAreas,
} from '../analysis';
import { createAoi } from '../aoi';
import { MEPYD_LAYERS_FLAT } from '../sources/mepyd';

import type { HydrologyFeature } from '../sources/overpass';
import type { ProtectedAreaFeature } from '../sources/wdpa';

const AOI = createAoi({
  type: 'Polygon',
  coordinates: [
    [
      [-69.6, 18.45],
      [-69.59, 18.45],
      [-69.59, 18.46],
      [-69.6, 18.46],
      [-69.6, 18.45],
    ],
  ],
});

const CROSSING: HydrologyFeature = {
  osmId: 10,
  kind: 'waterway',
  name: 'Arroyo que cruza',
  geometry: {
    type: 'LineString',
    coordinates: [
      [-69.62, 18.455],
      [-69.57, 18.455],
    ],
  },
};

const NEARBY: HydrologyFeature = {
  osmId: 20,
  kind: 'water_body',
  name: null,
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-69.585, 18.45],
        [-69.583, 18.45],
        [-69.583, 18.452],
        [-69.585, 18.452],
        [-69.585, 18.45],
      ],
    ],
  },
};

describe('hidrología — `available` es un estado propio, no una lista vacía', () => {
  it('available:false (los 5 mirrors caídos, UC-09/TC-11)', () => {
    const summary = summarizeHydrology(AOI, { available: false, error: new Error('504') });
    expect(summary).toEqual({
      available: false,
      features_found: 0,
      intersects_aoi: false,
      nearest_distance_m: null,
      features: [],
    });
    expect(hydrologySummarySchema.parse(summary)).toEqual(summary);
  });

  it('available:true con cero features (TC-14) se distingue del anterior', () => {
    const summary = summarizeHydrology(AOI, { available: true, data: [] });
    expect(summary.available).toBe(true);
    expect(summary.features_found).toBe(0);
    expect(summary.nearest_distance_m).toBeNull();
  });

  it('ordena por distancia ascendente y marca la intersección (TC-12/TC-34)', () => {
    const summary = summarizeHydrology(AOI, { available: true, data: [NEARBY, CROSSING] });
    expect(summary.features_found).toBe(2);
    expect(summary.intersects_aoi).toBe(true);
    expect(summary.nearest_distance_m).toBe(0);
    expect(summary.features.map((f) => f.osm_id)).toEqual([10, 20]);
    expect(summary.features[0]?.distance_m).toBe(0);
    expect(summary.features[1]?.distance_m).toBeGreaterThan(0);
    expect(summary.features[1]?.name).toBeNull();
    expect(hydrologySummarySchema.parse(summary)).toEqual(summary);
  });

  it('sin intersección informa la distancia real, no cero (TC-13)', () => {
    const summary = summarizeHydrology(AOI, { available: true, data: [NEARBY] });
    expect(summary.intersects_aoi).toBe(false);
    expect(summary.nearest_distance_m).toBeGreaterThan(400);
    expect(summary.nearest_distance_m).toBeLessThan(800);
  });
});

describe('áreas protegidas', () => {
  const overlapping: ProtectedAreaFeature = {
    name: 'Parque Nacional de prueba',
    desig: 'Parque Nacional',
    desigEng: 'National Park',
    iucnCat: 'II',
    status: 'Designated',
    mangAuth: 'Ministerio de Medio Ambiente',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-69.6, 18.45],
          [-69.595, 18.45],
          [-69.595, 18.46],
          [-69.6, 18.46],
          [-69.6, 18.45],
        ],
      ],
    },
  };

  it('available:false (TC-07)', () => {
    const summary = summarizeProtectedAreas(AOI, { available: false });
    expect(summary.available).toBe(false);
    expect(summary.areas_found).toBe(0);
    expect(summary.overlap_ha).toBe(0);
    expect(summary.nearest_distance_m).toBeNull();
    expect(protectedAreasSummarySchema.parse(summary)).toEqual(summary);
  });

  it('calcula solapamiento en ha y % del AOI (TC-08)', () => {
    const summary = summarizeProtectedAreas(AOI, { available: true, data: [overlapping] });
    expect(summary.intersects_aoi).toBe(true);
    expect(summary.nearest_distance_m).toBe(0);
    // La mitad oeste del AOI.
    expect(summary.overlap_pct_of_aoi).toBeGreaterThan(45);
    expect(summary.overlap_pct_of_aoi).toBeLessThan(55);
    expect(summary.overlap_ha).toBeGreaterThan(0);
    expect(summary.areas[0]?.overlap_ha).toBeCloseTo(summary.overlap_ha, 6);
  });

  it('`desig` prefiere desig_eng, como el legacy, y expone iucn_cat/status', () => {
    const summary = summarizeProtectedAreas(AOI, { available: true, data: [overlapping] });
    expect(summary.areas[0]).toMatchObject({
      name: 'Parque Nacional de prueba',
      desig: 'National Park',
      iucn_cat: 'II',
      status: 'Designated',
    });
    // `mang_auth` se trae pero no se resume — decisión explícita del inventario §6.
    expect(summary.areas[0]).not.toHaveProperty('mang_auth');
  });

  it('un área cercana sin intersección da overlap 0 y distancia > 0 (TC-09)', () => {
    const far: ProtectedAreaFeature = {
      ...overlapping,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-69.58, 18.45],
            [-69.575, 18.45],
            [-69.575, 18.46],
            [-69.58, 18.46],
            [-69.58, 18.45],
          ],
        ],
      },
    };
    const summary = summarizeProtectedAreas(AOI, { available: true, data: [far] });
    expect(summary.intersects_aoi).toBe(false);
    expect(summary.overlap_ha).toBe(0);
    expect(summary.overlap_pct_of_aoi).toBe(0);
    expect(summary.nearest_distance_m).toBeGreaterThan(500);
  });
});

describe('MEPyD — resumen anidado por grupo y capa', () => {
  it('conserva el orden del catálogo y expone count + atributos crudos', () => {
    const first = MEPYD_LAYERS_FLAT[0];
    const water = MEPYD_LAYERS_FLAT.find((l) => l.group === 'Agua');
    if (first === undefined || water === undefined) throw new Error('fixture');

    const summary = summarizeMepyd({
      inRd: true,
      failures: [],
      layers: [
        {
          layer: first,
          features: [
            {
              properties: { MUN_NOM: 'Santo Domingo Este', POBLACION: 948885 },
              geometry: { type: 'Point', coordinates: [-69.8, 18.5] },
            },
          ],
        },
        {
          layer: water,
          features: [
            {
              properties: { NOMBRE: 'PTAR X' },
              geometry: { type: 'Point', coordinates: [-69.8, 18.5] },
            },
          ],
        },
      ],
    });

    expect(Object.keys(summary)).toEqual(['División Político-Administrativa', 'Agua']);
    const layer = summary['División Político-Administrativa']?.[first.label];
    expect(layer?.count).toBe(1);
    expect(layer?.features[0]).toEqual({ MUN_NOM: 'Santo Domingo Este', POBLACION: 948885 });
  });

  it('fuera de RD el resumen queda vacío y `in_rd` es false (UC-11)', () => {
    const analysis = buildVectorAnalysis(AOI, {
      hydrology: { available: false },
      protectedAreas: { available: false },
      mepyd: { inRd: false, layers: [], failures: [] },
    });
    expect(analysis.mepyd_rd.in_rd).toBe(false);
    expect(analysis.mepyd_rd.summary).toEqual({});
  });
});

describe('buildVectorAnalysis', () => {
  it('arma el bloque con la forma del contrato §3', () => {
    const analysis = buildVectorAnalysis(AOI, {
      hydrology: { available: true, data: [CROSSING] },
      protectedAreas: { available: true, data: [] },
      mepyd: { inRd: true, layers: [], failures: [] },
    });

    expect(analysis.aoi).toEqual({
      area_ha: AOI.areaHa,
      bbox: AOI.bbox,
      utm_epsg: 32619,
    });
    expect(analysis.hydrology.summary.available).toBe(true);
    expect(analysis.hydrology.features).toHaveLength(1);
    expect(analysis.protected_areas.summary.available).toBe(true);
    expect(analysis.protected_areas.areas).toEqual([]);
    expect(analysis.mepyd_rd.in_rd).toBe(true);
  });

  it('una fuente caída no vacía las demás (regresión #3)', () => {
    const analysis = buildVectorAnalysis(AOI, {
      hydrology: { available: false, error: new Error('Overpass caído') },
      protectedAreas: { available: true, data: [] },
      mepyd: { inRd: true, layers: [], failures: [] },
    });
    expect(analysis.hydrology.summary.available).toBe(false);
    expect(analysis.protected_areas.summary.available).toBe(true);
  });
});
