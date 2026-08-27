/**
 * La matriz de aislamiento de fallos — regresión #3 del inventario.
 *
 * Es EL test de este workstream. Las tres fuentes vectoriales suben y bajan de
 * forma independiente (2³ = 8 combinaciones) y en las ocho el resultado
 * fusionado tiene que ser correcto: la fuente caída baja su `available`, las
 * otras conservan sus datos intactos, el raster no se entera, y el estado
 * global es `partial` en vez de `error` mientras quede algo utilizable.
 *
 * Además se prueba la distinción que la regresión pide preservar:
 * `available: false` (el servicio no respondió) NO es lo mismo que
 * `available: true, found: 0` (consulté y no hay nada). Colapsar las dos cosas
 * cambia el color y el texto del banner (UC-13..20 / TC-07..14).
 */
import { describe, expect, it } from 'vitest';

import {
  createAoi,
  MEPYD_LAYERS_FLAT,
  type Aoi,
  type HydrologyFeature,
  type MepydLayerDef,
  type MepydResult,
  type ProtectedAreaFeature,
  type SourceOutcome,
  type AreaGeometry,
  type Geometry,
} from '@territorio/geo';

import {
  DEFAULT_ANALYSIS_PARAMS,
  SOURCE_DOWN_MESSAGES,
  decideAoiSize,
  findSource,
  parseStoredAnalysis,
  toSummary,
  verdictForAreaHa,
  type AnalysisSourceId,
} from './analysis-contract';
import {
  mepydLayerId,
  mergeAnalysis,
  resolveAnalysisStatus,
  type RasterOutcome,
  type VectorOutcomes,
} from './analysis-merge';

import type { AnalysisJob } from '@territorio/api-client';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

/** Un rectángulo chico en Santo Domingo: dentro de RD, y ≤500 ha. */
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

/** El mismo rectángulo, corrido a Costa Rica: fuera del RD_BBOX (UC-11). */
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

const aoi: Aoi = createAoi(AOI_GEOMETRY);

/** Una línea que cruza el AOI: intersecta, así que `distance_m` es 0 exacto (H9). */
const CROSSING_LINE: Geometry = {
  type: 'LineString',
  coordinates: [
    [-69.945, 18.475],
    [-69.925, 18.475],
  ],
};

/** Un polígono claramente afuera, para el caso "cerca pero sin intersección". */
const NEARBY_POLYGON: Geometry = {
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

const HYDROLOGY: HydrologyFeature[] = [
  { osmId: 1, kind: 'waterway', name: 'Río Ozama', geometry: CROSSING_LINE },
  { osmId: 2, kind: 'wetland', name: null, geometry: NEARBY_POLYGON },
];

const PROTECTED_AREAS: ProtectedAreaFeature[] = [
  {
    name: 'Parque Nacional Sibarí',
    desig: 'Parque Nacional',
    desigEng: 'National Park',
    iucnCat: 'II',
    status: 'Designated',
    mangAuth: 'Ministerio de Medio Ambiente',
    geometry: NEARBY_POLYGON,
  },
];

function mepydLayer(index: number): MepydLayerDef {
  const definition = MEPYD_LAYERS_FLAT[index];
  if (definition === undefined) throw new Error('El catálogo MEPyD cambió de tamaño.');
  return definition;
}

const MEPYD_OK: MepydResult = {
  inRd: true,
  layers: [
    {
      layer: mepydLayer(0),
      features: [
        { properties: { MUN_NOM: 'Santo Domingo Este', POB: 948_855 }, geometry: NEARBY_POLYGON },
      ],
    },
  ],
  failures: [],
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
        slope_class_pct: {
          'Plano (0-5%)': 42.1,
          'Suave (5-15%)': 31.4,
          'Moderado (15-30%)': 18,
          'Fuerte (>30%)': 8.5,
        },
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
        ndvi_density_class_pct: {
          'Sin vegetación / suelo desnudo o agua': 0.6,
          'Vegetación dispersa / matorral bajo': 2.2,
          'Vegetación densa / bosque secundario': 12.4,
          'Vegetación muy densa / dosel maduro': 84.8,
        },
        worldcover_tree_cover_pct: 7.3,
        worldcover_landcover_pct: { 'Área construida': 61.2, Pastizal: 21.4 },
      },
    },
    provenance: { dem_source: 'cop-dem-glo-30', sentinel2_scene_count: 6 },
    layers: [
      {
        layer: 'dem',
        kind: 'continuous',
        label: 'Elevación (DEM)',
        default_opacity: 0.7,
        available: true,
        download_filename: 'elevacion.tif',
      },
      {
        layer: 'ndvi',
        kind: 'continuous',
        label: 'NDVI (continuo)',
        default_opacity: 0.7,
        available: true,
        download_filename: 'ndvi.tif',
      },
    ],
  },
};

const RASTER_UP: RasterOutcome = { available: true, job: RASTER_RESULT };
const RASTER_DOWN: RasterOutcome = { available: false, error: 'El servicio raster no respondió.' };

const up = <T>(data: T): SourceOutcome<T> => ({ available: true, data });
const down = (reason: string): SourceOutcome<never> => ({
  available: false,
  error: new Error(reason),
});

function vector(overrides: Partial<VectorOutcomes> = {}): VectorOutcomes {
  return {
    hydrology: up(HYDROLOGY),
    protectedAreas: up(PROTECTED_AREAS),
    mepyd: up(MEPYD_OK),
    ...overrides,
  };
}

function merge(options: { raster?: RasterOutcome; vector?: VectorOutcomes; aoi?: Aoi } = {}) {
  return mergeAnalysis({
    id: 'analisis-1',
    createdAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:01:00Z',
    params: DEFAULT_ANALYSIS_PARAMS,
    aoi: options.aoi ?? aoi,
    raster: options.raster ?? RASTER_UP,
    vector: options.vector ?? vector(),
  });
}

/* -------------------------------------------------------------------------- */
/* Fusión feliz                                                                */
/* -------------------------------------------------------------------------- */

describe('mergeAnalysis — el camino completo', () => {
  it('arma el contrato del §3 con las dos mitades', () => {
    const result = merge();

    expect(result.id).toBe('analisis-1');
    expect(result.raster_job_id).toBe('raster-job-1');
    expect(result.status).toBe('ok');

    // El AOI sale de packages/geo, no del servicio raster: es el único que
    // existe aunque el raster esté caído.
    expect(result.aoi.utm_epsg).toBe(32619);
    expect(result.aoi.bbox).toEqual(aoi.bbox);
    expect(result.aoi.area_ha).toBeCloseTo(aoi.areaHa, 6);
    expect(result.aoi_geometry).toEqual(AOI_GEOMETRY);

    expect(result.topography.summary?.slope_mean_pct).toBe(9.7);
    expect(result.vegetation.summary?.worldcover_tree_cover_pct).toBe(7.3);
    expect(result.layers).toHaveLength(2);
    expect(result.provenance.sentinel2_scene_count).toBe(6);
  });

  it('pega la geometría a cada fila del resumen sin recalcular la distancia', () => {
    const result = merge();

    expect(result.hydrology.summary.features_found).toBe(2);
    expect(result.hydrology.features).toHaveLength(2);

    // Orden por distancia ascendente: el que intersecta va primero, con 0 exacto.
    const [first, second] = result.hydrology.features;
    expect(first?.osm_id).toBe(1);
    expect(first?.distance_m).toBe(0);
    expect(first?.geometry).toEqual(CROSSING_LINE);
    expect(second?.osm_id).toBe(2);
    expect(second?.distance_m).toBeGreaterThan(0);

    // La distancia de la fila con geometría es LA MISMA que la del resumen.
    expect(result.hydrology.features.map((f) => f.distance_m)).toEqual(
      result.hydrology.summary.features.map((f) => f.distance_m),
    );
  });

  it('conserva los campos WDPA que la UI no muestra pero la exportación sí usa', () => {
    const area = merge().protected_areas.areas[0];

    expect(area?.name).toBe('Parque Nacional Sibarí');
    // El resumen prefiere `desig_eng`; la fila con geometría conserva los dos.
    expect(area?.desig).toBe('Parque Nacional');
    expect(area?.desig_eng).toBe('National Park');
    expect(area?.mang_auth).toBe('Ministerio de Medio Ambiente');
    expect(area?.overlap_ha).toBe(0);
  });

  it('indexa las capas MEPyD con el id del registro de capas', () => {
    const layer = merge().mepyd_rd.layers[0];
    const definition = mepydLayer(0);

    expect(layer?.layer_id).toBe(mepydLayerId(definition.group, definition.label));
    expect(layer?.layer_id).toMatch(/^mepyd:[a-z0-9-]+\/[a-z0-9-]+$/);
    expect(layer?.count).toBe(1);
    expect(layer?.features[0]?.properties.MUN_NOM).toBe('Santo Domingo Este');
  });
});

/* -------------------------------------------------------------------------- */
/* La matriz: 3 fuentes × arriba/abajo                                          */
/* -------------------------------------------------------------------------- */

type Flags = { hydrology: boolean; protectedAreas: boolean; mepyd: boolean };

const MATRIX: Flags[] = [false, true].flatMap((hydrology) =>
  [false, true].flatMap((protectedAreas) =>
    [false, true].map((mepyd) => ({ hydrology, protectedAreas, mepyd })),
  ),
);

function outcomesFor(flags: Flags): VectorOutcomes {
  return {
    hydrology: flags.hydrology ? up(HYDROLOGY) : down('Los 5 mirrors de Overpass fallaron'),
    protectedAreas: flags.protectedAreas
      ? up(PROTECTED_AREAS)
      : down('El FeatureServer de WDPA no respondió'),
    mepyd: flags.mepyd ? up(MEPYD_OK) : down('El portal del MEPyD no respondió'),
  };
}

function label(flags: Flags): string {
  const state = (value: boolean) => (value ? 'arriba' : 'ABAJO');
  return `hidrología ${state(flags.hydrology)} · WDPA ${state(flags.protectedAreas)} · MEPyD ${state(flags.mepyd)}`;
}

describe('mergeAnalysis — matriz de aislamiento de fallos (regresión #3)', () => {
  it('cubre las ocho combinaciones', () => {
    expect(MATRIX).toHaveLength(8);
  });

  for (const flags of MATRIX) {
    it(`${label(flags)}: cada fuente reporta lo suyo y ninguna arrastra a otra`, () => {
      const result = merge({ vector: outcomesFor(flags) });

      const hydrology = findSource(result, 'hidrologia');
      const protectedAreas = findSource(result, 'areas-protegidas');
      const mepyd = findSource(result, 'mepyd');

      // 1. El booleano `available` sigue exactamente el estado del servicio.
      expect(hydrology?.available).toBe(flags.hydrology);
      expect(protectedAreas?.available).toBe(flags.protectedAreas);
      expect(mepyd?.available).toBe(flags.mepyd);

      expect(result.hydrology.summary.available).toBe(flags.hydrology);
      expect(result.protected_areas.summary.available).toBe(flags.protectedAreas);

      // 2. Las fuentes que respondieron conservan SUS datos completos, sin
      //    importar cuántas otras se cayeron.
      if (flags.hydrology) {
        expect(result.hydrology.summary.features_found).toBe(2);
        expect(result.hydrology.features).toHaveLength(2);
        expect(result.hydrology.summary.intersects_aoi).toBe(true);
        expect(hydrology?.found).toBe(2);
      } else {
        expect(result.hydrology.summary.features_found).toBe(0);
        expect(result.hydrology.summary.nearest_distance_m).toBeNull();
        expect(result.hydrology.features).toEqual([]);
        expect(hydrology?.error).toContain('Overpass');
      }

      if (flags.protectedAreas) {
        expect(result.protected_areas.summary.areas_found).toBe(1);
        expect(result.protected_areas.areas).toHaveLength(1);
      } else {
        expect(result.protected_areas.summary.areas_found).toBe(0);
        expect(result.protected_areas.areas).toEqual([]);
        expect(protectedAreas?.error).toContain('WDPA');
      }

      if (flags.mepyd) {
        expect(result.mepyd_rd.in_rd).toBe(true);
        expect(result.mepyd_rd.layers).toHaveLength(1);
        expect(Object.keys(result.mepyd_rd.summary)).toHaveLength(1);
      } else {
        expect(result.mepyd_rd.layers).toEqual([]);
        expect(result.mepyd_rd.summary).toEqual({});
        // Adentro de RD, que MEPyD no responda SÍ es un servicio caído.
        expect(mepyd?.state).toBe('error');
      }

      // 3. El raster no se entera de nada de lo anterior.
      expect(result.topography.available).toBe(true);
      expect(result.vegetation.available).toBe(true);
      expect(result.layers).toHaveLength(2);
      expect(findSource(result, 'raster')?.available).toBe(true);

      // 4. Estado global: `ok` sólo si respondió todo; nunca `error` mientras
      //    el raster siga en pie.
      const allUp = flags.hydrology && flags.protectedAreas && flags.mepyd;
      expect(result.status).toBe(allUp ? 'ok' : 'partial');
    });
  }
});

/* -------------------------------------------------------------------------- */
/* "No respondió" ≠ "no hay nada"                                              */
/* -------------------------------------------------------------------------- */

describe('mergeAnalysis — `available: false` no es "consulté y no hay nada"', () => {
  it('cero resultados deja `available: true`, `state: empty` y sin mensaje de error', () => {
    const result = merge({
      vector: vector({ hydrology: up([]), protectedAreas: up([]) }),
    });

    const hydrology = findSource(result, 'hidrologia');
    expect(hydrology?.available).toBe(true);
    expect(hydrology?.state).toBe('empty');
    expect(hydrology?.found).toBe(0);
    expect(hydrology?.error).toBeNull();

    expect(result.hydrology.summary.available).toBe(true);
    expect(result.hydrology.summary.features_found).toBe(0);
    expect(result.protected_areas.summary.available).toBe(true);

    // Cero resultados NO degrada el análisis: es un resultado válido (TC-14).
    expect(result.status).toBe('ok');
  });

  it('servicio caído deja `available: false`, `state: error` y el texto de TC-11', () => {
    const result = merge({ vector: vector({ hydrology: down('') }) });
    const hydrology = findSource(result, 'hidrologia');

    expect(hydrology?.available).toBe(false);
    expect(hydrology?.state).toBe('error');
    // Sin motivo del servicio se usa el texto exacto del inventario.
    expect(hydrology?.error).toBe(SOURCE_DOWN_MESSAGES.hidrologia);
    expect(result.status).toBe('partial');
  });
});

/* -------------------------------------------------------------------------- */
/* Raster                                                                      */
/* -------------------------------------------------------------------------- */

describe('mergeAnalysis — el lado raster', () => {
  it('raster caído no borra el bloque vectorial (regresión #3, al revés)', () => {
    const result = merge({ raster: RASTER_DOWN });

    expect(result.raster_job_id).toBeNull();
    expect(result.topography.available).toBe(false);
    expect(result.topography.error).toBe('El servicio raster no respondió.');
    expect(result.vegetation.ndvi_available).toBe(false);
    expect(result.layers).toEqual([]);

    // Lo vectorial sobrevive entero.
    expect(result.hydrology.summary.features_found).toBe(2);
    expect(result.protected_areas.areas).toHaveLength(1);
    expect(result.mepyd_rd.layers).toHaveLength(1);
    expect(result.status).toBe('partial');
  });

  it('un job sin resultado se trata como raster caído, no como resultado vacío', () => {
    const result = merge({
      raster: {
        available: true,
        job: { ...RASTER_RESULT, status: 'error', error: 'STAC timeout', result: null },
      },
    });

    expect(result.raster_job_id).toBe('raster-job-1');
    expect(findSource(result, 'raster')?.state).toBe('error');
    expect(result.topography.error).toBe('STAC timeout');
    expect(result.status).toBe('partial');
  });

  it('Sentinel-2 caído con WorldCover arriba deja el análisis en `partial`', () => {
    const degraded: AnalysisJob = {
      ...RASTER_RESULT,
      status: 'partial',
      result: {
        ...RASTER_RESULT.result!,
        vegetation: {
          available: true,
          ndvi_available: false,
          ndvi_error: 'No se encontraron escenas con menos de 30% de nubes.',
          worldcover_available: true,
          summary: { worldcover_tree_cover_pct: 7.3 },
        },
      },
    };

    const result = merge({ raster: { available: true, job: degraded } });

    expect(findSource(result, 'raster')?.available).toBe(true);
    expect(result.vegetation.worldcover_available).toBe(true);
    expect(result.status).toBe('partial');
  });

  it('todo caído — raster y las tres vectoriales — es el único `error`', () => {
    const result = merge({
      raster: RASTER_DOWN,
      vector: outcomesFor({ hydrology: false, protectedAreas: false, mepyd: false }),
    });

    expect(result.status).toBe('error');
    expect(result.sources.every((source) => source.available)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* MEPyD: los tres estados que no son "arriba/abajo"                           */
/* -------------------------------------------------------------------------- */

describe('mergeAnalysis — MEPyD', () => {
  it('AOI fuera de RD: `skipped`, sin llamadas, y NO degrada el análisis (UC-11)', () => {
    const outside = createAoi(AOI_OUTSIDE_RD);
    const result = merge({
      aoi: outside,
      vector: vector({ mepyd: up({ inRd: false, layers: [], failures: [] }) }),
    });

    const mepyd = findSource(result, 'mepyd');
    expect(mepyd?.state).toBe('skipped');
    expect(mepyd?.available).toBe(true);
    expect(result.mepyd_rd.in_rd).toBe(false);
    expect(result.status).toBe('ok');
  });

  it('AOI fuera de RD con la llamada caída sigue siendo `skipped`, no un fallo', () => {
    const outside = createAoi(AOI_OUTSIDE_RD);
    const result = merge({ aoi: outside, vector: vector({ mepyd: down('boom') }) });

    expect(findSource(result, 'mepyd')?.state).toBe('skipped');
    expect(result.status).toBe('ok');
  });

  it('capas caídas sueltas no bajan `available`: viajan en `failures` (§7.2)', () => {
    const partial: MepydResult = {
      inRd: true,
      layers: MEPYD_OK.layers,
      failures: [{ layer: mepydLayer(1), error: new Error('HTTP 503') }],
    };
    const result = merge({ vector: vector({ mepyd: up(partial) }) });

    const mepyd = findSource(result, 'mepyd');
    expect(mepyd?.state).toBe('ok');
    expect(mepyd?.available).toBe(true);
    expect(result.mepyd_rd.failures).toEqual([
      { group: mepydLayer(1).group, label: mepydLayer(1).label, reason: 'HTTP 503' },
    ]);
    expect(result.status).toBe('ok');
  });

  it('todas las capas caídas y ninguna con datos se reporta como servicio caído (TC-25)', () => {
    const allFailed: MepydResult = {
      inRd: true,
      layers: [],
      failures: [
        { layer: mepydLayer(0), error: new Error('HTTP 503') },
        { layer: mepydLayer(1), error: new Error('HTTP 503') },
      ],
    };
    const result = merge({ vector: vector({ mepyd: up(allFailed) }) });

    expect(findSource(result, 'mepyd')?.state).toBe('error');
    expect(result.status).toBe('partial');
  });

  it('dentro de RD y sin nada cerca es `empty`, no un fallo', () => {
    const result = merge({
      vector: vector({ mepyd: up({ inRd: true, layers: [], failures: [] }) }),
    });

    expect(findSource(result, 'mepyd')?.state).toBe('empty');
    expect(result.status).toBe('ok');
  });

  it('acota los atributos dinámicos a escalares serializables', () => {
    const weird: MepydResult = {
      inRd: true,
      layers: [
        {
          layer: mepydLayer(0),
          features: [
            {
              properties: { NOMBRE: 'X', anidado: { a: 1 }, vacio: undefined, n: 3 },
              geometry: NEARBY_POLYGON,
            },
          ],
        },
      ],
      failures: [],
    };
    const attributes = merge({ vector: vector({ mepyd: up(weird) }) }).mepyd_rd.layers[0]
      ?.features[0]?.properties;

    expect(attributes?.NOMBRE).toBe('X');
    expect(attributes?.n).toBe(3);
    // Nada se descarta en silencio: lo no escalar se serializa a texto.
    expect(attributes?.anidado).toBe('{"a":1}');
    expect(attributes?.vacio).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* resolveAnalysisStatus                                                       */
/* -------------------------------------------------------------------------- */

describe('resolveAnalysisStatus', () => {
  const source = (id: AnalysisSourceId, state: 'ok' | 'empty' | 'error' | 'skipped') => ({
    id,
    service: id,
    available: state !== 'error',
    state,
    found: 0,
    error: null,
  });

  it('sólo `error` cuando falló TODO lo consultado', () => {
    expect(
      resolveAnalysisStatus([source('raster', 'error'), source('hidrologia', 'error')], true),
    ).toBe('error');
  });

  it('una fuente caída entre varias es `partial`', () => {
    expect(
      resolveAnalysisStatus([source('raster', 'ok'), source('hidrologia', 'error')], false),
    ).toBe('partial');
  });

  it('las `skipped` no cuentan ni a favor ni en contra', () => {
    expect(resolveAnalysisStatus([source('raster', 'ok'), source('mepyd', 'skipped')], false)).toBe(
      'ok',
    );
    expect(
      resolveAnalysisStatus([source('raster', 'error'), source('mepyd', 'skipped')], true),
    ).toBe('error');
  });

  it('raster degradado (una sub-fuente caída) baja a `partial` sin fuentes en error', () => {
    expect(resolveAnalysisStatus([source('raster', 'ok')], true)).toBe('partial');
  });
});

/* -------------------------------------------------------------------------- */
/* Contrato persistido                                                         */
/* -------------------------------------------------------------------------- */

describe('contrato persistido', () => {
  it('ida y vuelta por JSON: lo que se guarda se puede volver a leer', () => {
    const original = merge();
    const roundTrip = parseStoredAnalysis(JSON.parse(JSON.stringify(original)) as unknown);

    expect(roundTrip).not.toBeNull();
    expect(roundTrip).toEqual(original);
  });

  it('un resultado de otra versión del contrato se rechaza en vez de renderizarse a medias', () => {
    const broken = {
      ...(JSON.parse(JSON.stringify(merge())) as Record<string, unknown>),
      sources: 'todo bien',
    };
    expect(parseStoredAnalysis(broken)).toBeNull();
    expect(parseStoredAnalysis(null)).toBeNull();
  });

  it('`toSummary` saca las geometrías y deja el resumen del §3 intacto', () => {
    const summary = toSummary(merge());

    expect(summary.hydrology.summary.features_found).toBe(2);
    expect(summary.protected_areas.summary.areas_found).toBe(1);
    expect(summary.mepyd_rd.summary).toEqual(merge().mepyd_rd.summary);
    expect('features' in summary.hydrology).toBe(false);
    expect('aoi_geometry' in summary).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Guard de tamaño del AOI (§7.4)                                              */
/* -------------------------------------------------------------------------- */

describe('guard de tamaño del AOI', () => {
  it('clasifica los tres tramos del §7.4', () => {
    expect(verdictForAreaHa(499)).toBe('ok');
    expect(verdictForAreaHa(500)).toBe('ok');
    expect(verdictForAreaHa(1_240)).toBe('warn');
    expect(verdictForAreaHa(2_000)).toBe('warn');
    expect(verdictForAreaHa(2_001)).toBe('block');
  });

  it('≤500 ha pasa en silencio', () => {
    expect(decideAoiSize({ areaHa: 120, ndviResolutionM: 10, confirmed: false }).allowed).toBe(
      true,
    );
  });

  it('500–2 000 ha exige confirmar o bajar la resolución', () => {
    expect(decideAoiSize({ areaHa: 1_240, ndviResolutionM: 10, confirmed: false }).allowed).toBe(
      false,
    );
    expect(decideAoiSize({ areaHa: 1_240, ndviResolutionM: 10, confirmed: true }).allowed).toBe(
      true,
    );
    expect(decideAoiSize({ areaHa: 1_240, ndviResolutionM: 20, confirmed: false }).allowed).toBe(
      true,
    );
  });

  it('>2 000 ha NO se desbloquea confirmando: hace falta bajar a 20 m', () => {
    const blocked = decideAoiSize({ areaHa: 5_000, ndviResolutionM: 10, confirmed: true });
    expect(blocked.allowed).toBe(false);
    if (blocked.allowed) return;
    expect(blocked.verdict).toBe('block');
    expect(blocked.message).toContain('20 m');

    expect(decideAoiSize({ areaHa: 5_000, ndviResolutionM: 20, confirmed: false }).allowed).toBe(
      true,
    );
  });
});
