/**
 * Lo que estas pruebas defienden es UNA distinción: "no se pudo consultar" vs
 * "consulté y no hay nada" (regresión #3 del inventario). Es la diferencia que
 * el legacy ya había pagado caro y la que un refactor de copy vuelve a romper
 * sin que nadie lo note, porque las dos ramas se ven parecidas en pantalla.
 *
 * Por eso hay una prueba que recorre las CUATRO ramas de cada fuente y verifica
 * el string exacto (TC-07..TC-14), y otra que afirma que ningún texto de la
 * rama caída contiene la palabra que la volvería una negación de existencia.
 */
import { describe, expect, it } from 'vitest';

import {
  branchOf,
  coastalConclusions,
  executiveSummary,
  hydrologyBanner,
  hydrologyConclusions,
  mepydConclusions,
  protectedBanner,
  protectedConclusions,
  topographyConclusions,
  vegetationConclusions,
} from './narrative';

import type { HydrologySummary, ProtectedAreasSummary } from '@territorio/geo';

import {
  SOURCE_DOWN_MESSAGES,
  type TerritorioAnalysisSummary,
} from '~/lib/analysis-contract';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

function hydrology(overrides: Partial<HydrologySummary> = {}): HydrologySummary {
  return {
    available: true,
    features_found: 0,
    intersects_aoi: false,
    nearest_distance_m: null,
    features: [],
    ...overrides,
  };
}

function protectedAreas(overrides: Partial<ProtectedAreasSummary> = {}): ProtectedAreasSummary {
  return {
    available: true,
    areas_found: 0,
    intersects_aoi: false,
    overlap_ha: 0,
    overlap_pct_of_aoi: 0,
    nearest_distance_m: null,
    areas: [],
    ...overrides,
  };
}

function analysis(overrides: Partial<TerritorioAnalysisSummary> = {}): TerritorioAnalysisSummary {
  return {
    id: 'a1',
    raster_job_id: 'j1',
    status: 'ok',
    created_at: '2026-01-01T00:00:00.000Z',
    finished_at: '2026-01-01T00:02:00.000Z',
    params: { ndvi_resolution_m: 10, lookback_days: 180, max_cloud_cover: 30 },
    aoi: { area_ha: 100, bbox: [-69.6, 18.4, -69.5, 18.5], utm_epsg: 32619, vertex_count: 5 },
    topography: {
      available: true,
      error: null,
      summary: {
        elevation_min_m: 10,
        elevation_max_m: 110,
        elevation_mean_m: 50,
        elevation_range_m: 100,
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
      error: null,
      ndvi_available: true,
      ndvi_error: null,
      worldcover_available: true,
      worldcover_error: null,
      summary: {
        ndvi_mean: 0.55,
        ndvi_median: 0.58,
        ndvi_p90: 0.75,
        ndvi_density_class_pct: {
          'Sin vegetación / suelo desnudo o agua': 0.6,
          'Vegetación dispersa / matorral bajo': 2.2,
          'Vegetación densa / bosque secundario': 12.4,
          'Vegetación muy densa / dosel maduro': 84.8,
        },
        worldcover_tree_cover_pct: 71.2,
        worldcover_landcover_pct: { 'Bosque / cobertura arbórea': 71.2, Pastizal: 28.8 },
      },
    },
    hydrology: { summary: hydrology() },
    protected_areas: { summary: protectedAreas() },
    mepyd_rd: { in_rd: false, summary: {}, failures: [] },
    provenance: {},
    layers: [],
    sources: [],
    coastal: null,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Ramas                                                                       */
/* -------------------------------------------------------------------------- */

describe('branchOf', () => {
  it('«no se pudo consultar» gana sobre cualquier otra rama', () => {
    // Aunque el resto de los campos parezcan afirmar algo, sin respuesta del
    // servicio ninguno es afirmable.
    expect(branchOf({ available: false, intersects: true, found: 9 })).toBe('no-consultado');
    expect(branchOf({ available: false, intersects: false, found: 0 })).toBe('no-consultado');
  });

  it('distingue intersecta / cerca / sin elementos', () => {
    expect(branchOf({ available: true, intersects: true, found: 3 })).toBe('intersecta');
    expect(branchOf({ available: true, intersects: false, found: 3 })).toBe('cerca');
    expect(branchOf({ available: true, intersects: false, found: 0 })).toBe('sin-elementos');
  });
});

describe('banner de hidrología — strings exactos (TC-11..TC-14)', () => {
  it('servicio caído', () => {
    const banner = hydrologyBanner(hydrology({ available: false }));
    expect(banner.state).toBe('no-consultado');
    expect(banner.tone).toBe('danger');
    expect(banner.headline).toBe(SOURCE_DOWN_MESSAGES.hidrologia);
  });

  it('intersecta', () => {
    const banner = hydrologyBanner(
      hydrology({ intersects_aoi: true, features_found: 2, nearest_distance_m: 0 }),
    );
    expect(banner.tone).toBe('warning');
    expect(banner.headline).toBe('⚠️ Hay un curso/cuerpo de agua de OSM que intersecta el polígono.');
  });

  it('cerca sin intersección', () => {
    const banner = hydrologyBanner(hydrology({ features_found: 3, nearest_distance_m: 240 }));
    expect(banner.tone).toBe('info');
    expect(banner.headline).toBe('No hay intersección, pero hay 3 elemento(s) de hidrología a 240 m.');
  });

  it('sin elementos', () => {
    const banner = hydrologyBanner(hydrology());
    expect(banner.tone).toBe('success');
    expect(banner.headline).toBe('No se encontró hidrología mapeada en OSM cerca del polígono.');
  });
});

describe('banner de áreas protegidas — strings exactos (TC-07..TC-10)', () => {
  it('servicio caído', () => {
    const banner = protectedBanner(protectedAreas({ available: false }));
    expect(banner.tone).toBe('danger');
    expect(banner.headline).toBe(SOURCE_DOWN_MESSAGES['areas-protegidas']);
  });

  it('intersecta', () => {
    const banner = protectedBanner(protectedAreas({ intersects_aoi: true, areas_found: 1 }));
    expect(banner.tone).toBe('warning');
    expect(banner.headline).toBe('⚠️ El polígono SÍ intersecta un área de la WDPA:');
  });

  it('cerca sin intersección', () => {
    const banner = protectedBanner(protectedAreas({ areas_found: 2, nearest_distance_m: 815 }));
    expect(banner.tone).toBe('info');
    expect(banner.headline).toBe('No hay intersección, pero hay 2 área(s) WDPA a 815 m del polígono.');
  });

  it('sin áreas', () => {
    const banner = protectedBanner(protectedAreas());
    expect(banner.tone).toBe('success');
    expect(banner.headline).toBe('No se encontraron áreas protegidas (WDPA) cerca del polígono.');
  });
});

describe('un servicio caído nunca se lee como una ausencia', () => {
  it('hidrología caída: dice que falta el dato, no que no hay agua', () => {
    const texts = hydrologyConclusions(hydrology({ available: false })).map((item) => item.text);
    expect(texts.join(' ')).toContain('no puede decir si hay o no');
    expect(texts.join(' ')).not.toContain('No se encontró hidrología');
  });

  it('WDPA caída: no afirma ni descarta el solape', () => {
    const texts = protectedConclusions(protectedAreas({ available: false }), 100).map(
      (item) => item.text,
    );
    expect(texts.join(' ')).toContain('no puede afirmar ni descartar');
    expect(texts.join(' ')).not.toContain('No se encontraron áreas protegidas');
  });

  it('el resumen ejecutivo dice «No se pudo consultar», no un cero', () => {
    const lines = executiveSummary(
      analysis({
        hydrology: { summary: hydrology({ available: false }) },
        protected_areas: { summary: protectedAreas({ available: false }) },
      }),
    );
    const hydro = lines.find((line) => line.id === 'hidrologia');
    const wdpa = lines.find((line) => line.id === 'areas-protegidas');
    expect(hydro?.value).toBe('No se pudo consultar');
    expect(wdpa?.value).toBe('No se pudo consultar');
  });

  it('«sin elementos» sí se lee como ausencia comprobada', () => {
    const lines = executiveSummary(analysis());
    expect(lines.find((line) => line.id === 'hidrologia')?.value).toBe('Sin elementos en 500 m');
  });
});

/* -------------------------------------------------------------------------- */
/* Conclusiones derivadas de los números                                       */
/* -------------------------------------------------------------------------- */

describe('conclusiones de topografía', () => {
  it('terreno mayormente llano: lo dice, con el porcentaje real', () => {
    const texts = topographyConclusions(analysis().topography).map((item) => item.text);
    // `formatPercent` usa espacio fino no separable (U+202F) antes del signo, como manda la
    // ortografía. La prueba lo escribe explícito para que un cambio de
    // separador no pase inadvertido.
    expect(texts.join(' ')).toContain('73,5\u202f%');
    expect(texts.join(' ')).toContain('llano o de pendiente suave');
  });

  it('terreno empinado: advierte sobre movimiento de tierra', () => {
    const steep = analysis({
      topography: {
        available: true,
        error: null,
        summary: {
          elevation_min_m: 100,
          elevation_max_m: 600,
          elevation_mean_m: 300,
          elevation_range_m: 500,
          slope_mean_pct: 38,
          slope_max_pct: 120,
          slope_class_pct: {
            'Plano (0-5%)': 5,
            'Suave (5-15%)': 10,
            'Moderado (15-30%)': 25,
            'Fuerte (>30%)': 60,
          },
        },
      },
    });
    const conclusions = topographyConclusions(steep.topography);
    const slope = conclusions.find((item) => item.id === 'topografia-pendiente');
    expect(slope?.tone).toBe('warning');
    expect(slope?.text).toContain('movimiento de tierra');
  });

  it('sin DEM: una sola conclusión, y es la de la falta de dato', () => {
    const conclusions = topographyConclusions({
      available: false,
      error: 'El servicio de elevación no respondió.',
      summary: null,
    });
    expect(conclusions).toHaveLength(1);
    expect(conclusions[0]?.tone).toBe('danger');
  });
});

describe('conclusiones de vegetación', () => {
  it('dosel denso: lo nombra y cuantifica la cobertura arbórea', () => {
    const texts = vegetationConclusions(analysis().vegetation).map((item) => item.text).join(' ');
    expect(texts).toContain('Vegetación muy densa / dosel maduro');
    expect(texts).toContain('71,2\u202f%');
  });

  it('sin escenas Sentinel-2: no dice que no haya vegetación', () => {
    const conclusions = vegetationConclusions({
      available: true,
      error: null,
      ndvi_available: false,
      ndvi_error: null,
      worldcover_available: false,
      worldcover_error: null,
      summary: null,
    });
    expect(conclusions.map((item) => item.text).join(' ')).toContain('no se pudo medir');
  });
});

describe('riesgo costero — la sección que el legacy no incluía', () => {
  const base = {
    preset: 'Hoy (histórico) — 100 años de retorno' as const,
    cache_key: 'k',
    available: true,
    error: null,
    overlay_url: null,
    raster_url: null,
  };

  it('fuera de cobertura', () => {
    const conclusions = coastalConclusions({
      ...base,
      summary: { has_data: false },
    });
    expect(conclusions[0]?.text).toBe('No hay cobertura de datos de Aqueduct para esta zona.');
  });

  it('cobertura sin inundación proyectada', () => {
    const conclusions = coastalConclusions({
      ...base,
      summary: { has_data: true, pct_area_flooded: 0, resolution_m_approx: 927 },
    });
    expect(conclusions[0]?.text).toBe(
      'Sin inundación proyectada en el AOI para «Hoy (histórico) — 100 años de retorno» (resolución ~927 m).',
    );
  });

  it('con inundación: porcentaje y profundidad máxima', () => {
    const conclusions = coastalConclusions({
      ...base,
      summary: {
        has_data: true,
        pct_area_flooded: 12.5,
        max_depth_m: 1.8,
        mean_depth_where_flooded_m: 0.6,
        resolution_m_approx: 927,
      },
    });
    expect(conclusions[0]?.tone).toBe('warning');
    expect(conclusions[0]?.text).toContain('12,5\u202f%');
    expect(conclusions[0]?.text).toContain('1,8 m');
  });
});

describe('contexto RD', () => {
  it('fuera de RD: la línea exacta del panel, sin inventar una sección', () => {
    const conclusions = mepydConclusions({ in_rd: false, summary: {}, failures: [] });
    expect(conclusions).toHaveLength(1);
    expect(conclusions[0]?.text).toBe(
      'Contexto RD no aplica: el AOI está fuera de República Dominicana.',
    );
  });

  it('capas caídas se listan; no desaparecen como en el legacy', () => {
    const conclusions = mepydConclusions({
      in_rd: true,
      summary: { Amenazas: { 'Área propensa a inundación': { count: 2, features: [] } } },
      failures: [{ group: 'Vías', label: 'Puentes', reason: 'timeout' }],
    });
    const text = conclusions.map((item) => item.text).join(' ');
    expect(text).toContain('Puentes');
    expect(text).toContain('Área propensa a inundación');
  });
});
