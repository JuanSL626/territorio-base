/**
 * Los tests de la exportación prueban UNA cosa, la que el §7.2 llama "generada
 * desde lo que el análisis produjo, nunca una lista estática": que una capa que
 * el análisis no pudo traer **aparece igual en el plan**, marcada como no
 * disponible y con su motivo, y que ese motivo termina escrito adentro del
 * bundle (`LEEME.txt` y `FUENTES.txt`).
 *
 * La alternativa —filtrar del menú lo que no salió— es exactamente la regresión
 * #3 del inventario trasladada a la descarga: el usuario se lleva un ZIP sin
 * hidrología y no tiene forma de distinguir "Overpass estaba caído" de "no hay
 * ríos". Estos tests existen para que ese filtrado no se pueda reintroducir sin
 * romper algo.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ANALYSIS_PARAMS,
  SOURCE_SERVICE_NAMES,
  type SourceStatus,
  type TerritorioAnalysis,
} from './analysis-contract';
import {
  buildExportPlan,
  decideExportSize,
  defaultSelection,
  EXPORT_MAX_BYTES,
  isIncluded,
  omissions,
  totalEstimatedBytes,
} from './export-contract';
import {
  buildBundleReadme,
  buildReportMarkdown,
  buildSourcesManifest,
  buildSummaryCsv,
} from './export-documents';

import type { LayerAvailability } from '@territorio/api-client';
import type { AreaGeometry } from '@territorio/geo';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

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

function rasterLayer(
  layer: LayerAvailability['layer'],
  label: string,
  available: boolean,
): LayerAvailability {
  return {
    available,
    default_opacity: 0.7,
    download_filename: `${layer}.tif`,
    kind: 'continuous',
    label,
    layer,
    overlay_url: available ? `/analysis/job-1/overlay/${layer}.png` : null,
    raster_url: available ? `/analysis/job-1/raster/${layer}.tif` : null,
  };
}

function source(id: SourceStatus['id'], overrides: Partial<SourceStatus> = {}): SourceStatus {
  return {
    id,
    service: SOURCE_SERVICE_NAMES[id],
    available: true,
    state: 'ok',
    found: 1,
    error: null,
    ...overrides,
  };
}

function analysisFixture(overrides: Partial<TerritorioAnalysis> = {}): TerritorioAnalysis {
  return {
    id: 'an_1234567890',
    raster_job_id: 'job-1',
    status: 'ok',
    created_at: '2026-01-15T10:00:00.000Z',
    finished_at: '2026-01-15T10:03:00.000Z',
    params: DEFAULT_ANALYSIS_PARAMS,

    aoi: { area_ha: 120, bbox: [-69.94, 18.47, -69.93, 18.48], utm_epsg: 32619, vertex_count: 5 },
    aoi_geometry: AOI_GEOMETRY,

    topography: {
      available: true,
      error: null,
      summary: {
        elevation_min_m: 10,
        elevation_max_m: 90,
        elevation_mean_m: 42,
        elevation_range_m: 80,
        slope_mean_pct: 7.5,
        slope_max_pct: 44,
        slope_class_pct: { 'Plano (0-5%)': 40, 'Suave (5-15%)': 45, 'Moderado (15-30%)': 15 },
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
        ndvi_mean: 0.51,
        ndvi_median: 0.53,
        ndvi_p90: 0.72,
        ndvi_density_class_pct: { 'Vegetación densa / bosque secundario': 100 },
        worldcover_tree_cover_pct: 33,
        worldcover_landcover_pct: { 'Tree cover': 33, Cropland: 67 },
      },
    },

    hydrology: {
      summary: {
        available: true,
        features_found: 2,
        intersects_aoi: true,
        nearest_distance_m: 0,
        features: [
          { osm_id: 1, kind: 'waterway', name: 'Arroyo Seco', distance_m: 0 },
          { osm_id: 2, kind: 'water_body', name: null, distance_m: 210 },
        ],
      },
      features: [
        {
          osm_id: 1,
          kind: 'waterway',
          name: 'Arroyo Seco',
          distance_m: 0,
          geometry: {
            type: 'LineString',
            coordinates: [
              [-69.945, 18.475],
              [-69.925, 18.475],
            ],
          },
        },
        {
          osm_id: 2,
          kind: 'water_body',
          name: null,
          distance_m: 210,
          geometry: { type: 'Point', coordinates: [-69.9355, 18.4755] },
        },
      ],
    },
    protected_areas: {
      summary: {
        available: true,
        areas_found: 1,
        intersects_aoi: false,
        overlap_ha: 0,
        overlap_pct_of_aoi: 0,
        nearest_distance_m: 640,
        areas: [
          {
            name: 'Parque Nacional',
            desig: 'Parque Nacional',
            iucn_cat: 'II',
            status: 'Designated',
            distance_m: 640,
            overlap_ha: 0,
          },
        ],
      },
      areas: [
        {
          name: 'Parque Nacional',
          desig: 'Parque Nacional',
          desig_eng: 'National Park',
          iucn_cat: 'II',
          status: 'Designated',
          mang_auth: 'Ministerio de Medio Ambiente',
          distance_m: 640,
          overlap_ha: 0,
          geometry: { type: 'Point', coordinates: [-69.95, 18.49] },
        },
      ],
    },
    mepyd_rd: {
      in_rd: true,
      summary: { Agua: { 'Ríos y arroyos': { count: 3, features: [] } } },
      layers: [
        {
          layer_id: 'mepyd:agua/rios-y-arroyos',
          group: 'Agua',
          label: 'Ríos y arroyos',
          count: 3,
          features: [
            {
              properties: { NOMBRE: 'Río Ozama' },
              geometry: { type: 'Point', coordinates: [-69.935, 18.475] },
            },
          ],
        },
      ],
      failures: [],
      geometries_omitted: false,
    },

    provenance: { dem_source: 'cop-dem-glo-30', sentinel2_scene_count: 6 },
    layers: [
      rasterLayer('dem', 'Elevación (DEM)', true),
      rasterLayer('slope', 'Pendiente (%)', true),
      rasterLayer('aspect', 'Orientación (°)', true),
      rasterLayer('ndvi', 'NDVI (continuo)', true),
      rasterLayer('worldcover', 'Cobertura de suelo (WorldCover)', true),
    ],
    sources: [
      source('raster'),
      source('hidrologia', { found: 2 }),
      source('areas-protegidas'),
      source('mepyd', { found: 3 }),
    ],
    coastal: null,
    ...overrides,
  };
}

const plan = (analysis: TerritorioAnalysis) => buildExportPlan({ analysis, aoiName: 'Zona Norte' });

const byId = (analysis: TerritorioAnalysis, id: string) => {
  const found = plan(analysis).artifacts.find((artifact) => artifact.id === id);
  expect(found, `no hay artefacto ${id}`).toBeDefined();
  return found!;
};

/* -------------------------------------------------------------------------- */
/* El plan sale del análisis, no de un catálogo                                 */
/* -------------------------------------------------------------------------- */

describe('buildExportPlan', () => {
  it('ofrece exactamente los rasters que la corrida produjo', () => {
    const artifacts = plan(analysisFixture()).artifacts.filter(
      (artifact) => artifact.kind === 'raster',
    );
    expect(artifacts.map((artifact) => artifact.id).sort()).toEqual([
      'raster:aspect',
      'raster:coastal',
      'raster:dem',
      'raster:ndvi',
      'raster:slope',
      'raster:worldcover',
    ]);
  });

  it('un raster que el servicio no pudo generar sigue en la lista, gris y con el motivo', () => {
    const analysis = analysisFixture({
      layers: [rasterLayer('dem', 'Elevación (DEM)', true), rasterLayer('ndvi', 'NDVI', false)],
      vegetation: {
        available: true,
        error: null,
        ndvi_available: false,
        ndvi_error: 'STAC timeout al pedir Sentinel-2.',
        worldcover_available: true,
        worldcover_error: null,
        summary: null,
      },
    });

    const ndvi = byId(analysis, 'raster:ndvi');
    expect(ndvi.selectable).toBe(false);
    expect(ndvi.defaultSelected).toBe(false);
    // El motivo ESPECÍFICO del servicio, no "falló el raster".
    expect(ndvi.reason).toBe('STAC timeout al pedir Sentinel-2.');
    // Y el DEM que sí salió no se contagia.
    expect(byId(analysis, 'raster:dem').selectable).toBe(true);
  });

  it('`aspect` se ofrece pero no se pretilda (el hueco explícito del inventario §9)', () => {
    const aspect = byId(analysisFixture(), 'raster:aspect');
    expect(aspect.selectable).toBe(true);
    expect(aspect.defaultSelected).toBe(false);
  });

  it('sin job raster, ningún GeoTIFF es exportable y el motivo nombra el servicio', () => {
    const analysis = analysisFixture({ raster_job_id: null });
    const dem = byId(analysis, 'raster:dem');
    expect(dem.selectable).toBe(false);
    expect(dem.reason).toContain('servicio raster');
  });
});

/* -------------------------------------------------------------------------- */
/* «No respondió» ≠ «no hay nada» — la regresión #3, en la descarga             */
/* -------------------------------------------------------------------------- */

describe('fuente caída vs. fuente vacía', () => {
  it('Overpass caído: la capa no es exportable y el motivo dice que el servicio no respondió', () => {
    const analysis = analysisFixture({
      hydrology: {
        summary: {
          available: false,
          features_found: 0,
          intersects_aoi: false,
          nearest_distance_m: null,
          features: [],
        },
        features: [],
      },
      sources: [
        source('raster'),
        source('hidrologia', {
          available: false,
          state: 'error',
          found: 0,
          error: 'Overpass no respondió (5 mirrors).',
        }),
        source('areas-protegidas'),
        source('mepyd'),
      ],
    });

    const hidro = byId(analysis, 'vector:hidrologia');
    expect(hidro.selectable).toBe(false);
    expect(hidro.reason).toBe('Overpass no respondió (5 mirrors).');
  });

  it('Overpass respondió y no hay nada: el motivo lo dice con esas palabras', () => {
    const analysis = analysisFixture({
      hydrology: {
        summary: {
          available: true,
          features_found: 0,
          intersects_aoi: false,
          nearest_distance_m: null,
          features: [],
        },
        features: [],
      },
      sources: [
        source('raster'),
        source('hidrologia', { found: 0, state: 'empty' }),
        source('areas-protegidas'),
        source('mepyd'),
      ],
    });

    const hidro = byId(analysis, 'vector:hidrologia');
    expect(hidro.selectable).toBe(false);
    expect(hidro.reason).toContain('no hay hidrología cerca');
    // Y NO dice que el servicio falló: son dos hechos distintos del mundo.
    expect(hidro.reason).not.toContain('no respondió');
  });

  it('las capas MEPyD que fallaron aparecen una por una con el motivo del servicio', () => {
    const analysis = analysisFixture({
      mepyd_rd: {
        in_rd: true,
        summary: {},
        layers: [],
        failures: [{ group: 'Amenazas', label: 'Deslizamientos', reason: 'HTTP 503' }],
        geometries_omitted: false,
      },
    });

    const failed = plan(analysis).artifacts.filter((artifact) => artifact.id.startsWith('mepyd:'));
    expect(failed).toHaveLength(1);
    expect(failed[0]?.label).toBe('Amenazas · Deslizamientos');
    expect(failed[0]?.reason).toBe('HTTP 503');
  });

  it('AOI fuera de RD: una sola fila que lo explica, sin inventar 39 capas', () => {
    const analysis = analysisFixture({
      mepyd_rd: {
        in_rd: false,
        summary: {},
        layers: [],
        failures: [],
        geometries_omitted: false,
      },
    });

    const rows = plan(analysis).artifacts.filter((artifact) => artifact.id.startsWith('mepyd:'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toContain('fuera de República Dominicana');
  });

  it('geometrías MEPyD descartadas por tamaño: no es exportable, y el motivo dice que el resumen sí está', () => {
    const analysis = analysisFixture({
      mepyd_rd: {
        in_rd: true,
        summary: { Agua: { 'Ríos y arroyos': { count: 3, features: [] } } },
        layers: [
          {
            layer_id: 'mepyd:agua/rios-y-arroyos',
            group: 'Agua',
            label: 'Ríos y arroyos',
            count: 3,
            features: [],
          },
        ],
        failures: [],
        geometries_omitted: true,
      },
    });

    const layer = byId(analysis, 'mepyd:mepyd:agua/rios-y-arroyos');
    expect(layer.selectable).toBe(false);
    expect(layer.reason).toContain('no se guardaron por tamaño');
  });
});

/* -------------------------------------------------------------------------- */
/* Obligatorios y omisiones                                                    */
/* -------------------------------------------------------------------------- */

describe('selección', () => {
  it('el AOI, el LEEME y el FUENTES son obligatorios y entran aunque no se los tilde', () => {
    const built = plan(analysisFixture());
    const empty = new Set<string>();

    for (const id of ['vector:aoi', 'doc:leeme', 'doc:fuentes']) {
      const artifact = built.artifacts.find((candidate) => candidate.id === id);
      expect(artifact?.mandatory, id).toBe(true);
      expect(isIncluded(artifact!, empty), id).toBe(true);
    }
  });

  it('la selección por defecto no incluye las capas de contexto MEPyD', () => {
    const ids = new Set(defaultSelection(plan(analysisFixture())));
    expect(ids.has('vector:hidrologia')).toBe(true);
    expect(ids.has('mepyd:mepyd:agua/rios-y-arroyos')).toBe(false);
  });

  it('lo que no se puede generar sale listado como omisión con su motivo', () => {
    const analysis = analysisFixture({
      layers: [rasterLayer('dem', 'Elevación (DEM)', true), rasterLayer('ndvi', 'NDVI', false)],
      vegetation: {
        available: true,
        error: null,
        ndvi_available: false,
        ndvi_error: 'STAC timeout.',
        worldcover_available: true,
        worldcover_error: null,
        summary: null,
      },
    });
    const built = plan(analysis);
    const listed = omissions(built, new Set(defaultSelection(built)));

    expect(listed.some((entry) => entry.label === 'NDVI' && entry.reason === 'STAC timeout.')).toBe(
      true,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Guard de tamaño (§7.4)                                                      */
/* -------------------------------------------------------------------------- */

describe('decideExportSize', () => {
  const base = { artifactCount: 5, confirmed: false };

  it('un AOI chico con una selección chica pasa en silencio', () => {
    const decision = decideExportSize({ ...base, areaHa: 120, estimatedBytes: 5_000_000 });
    expect(decision.allowed).toBe(true);
    expect(decision.verdict).toBe('ok');
  });

  it('un AOI de 1 200 ha avisa antes del click y se destraba confirmando', () => {
    const warn = decideExportSize({ ...base, areaHa: 1_200, estimatedBytes: 5_000_000 });
    expect(warn.allowed).toBe(false);
    expect(warn.verdict).toBe('warn');
    expect(!warn.allowed && warn.message).toContain('1 200 ha');

    const confirmed = decideExportSize({
      ...base,
      areaHa: 1_200,
      estimatedBytes: 5_000_000,
      confirmed: true,
    });
    expect(confirmed.allowed).toBe(true);
  });

  it('por encima del tope duro no alcanza con confirmar: hay que achicar la selección', () => {
    const decision = decideExportSize({
      ...base,
      areaHa: 100,
      estimatedBytes: EXPORT_MAX_BYTES + 1,
      confirmed: true,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.verdict).toBe('block');
    expect(!decision.allowed && decision.message).toContain('Destildá');
  });

  it('el estimado crece con lo tildado', () => {
    const built = plan(analysisFixture());
    const few = totalEstimatedBytes(built, new Set(['doc:reporte']));
    const many = totalEstimatedBytes(built, new Set(defaultSelection(built)));
    expect(many).toBeGreaterThan(few);
  });
});

/* -------------------------------------------------------------------------- */
/* Los documentos dicen la verdad                                              */
/* -------------------------------------------------------------------------- */

describe('documentos del bundle', () => {
  const generatedAt = new Date('2026-01-15T12:00:00.000Z');

  it('FUENTES.txt trae las siete columnas del inventario §5 de cada dataset incluido', () => {
    const text = buildSourcesManifest({
      aoiName: 'Zona Norte',
      generatedAt,
      datasetIds: ['ndvi'],
      omissions: [],
      parameters: [{ label: 'Resolución NDVI', value: '10 m' }],
      engineVersion: 'test',
    });

    expect(text).toContain('Sentinel-2 L2A');
    expect(text).toContain('Proveedor');
    expect(text).toContain('Endpoint');
    expect(text).toContain('Resolución');
    expect(text).toContain('Licencia');
    expect(text).toContain('Fecha de consulta: 2026-01-15');
    expect(text).toContain('Advertencias');
    // Sólo lo incluido: WDPA no entró al bundle, no se cita.
    expect(text).not.toContain('World Database on Protected Areas');
  });

  it('FUENTES.txt lista lo que NO está y aclara que no significa ausencia de datos', () => {
    const text = buildSourcesManifest({
      aoiName: 'Zona Norte',
      generatedAt,
      datasetIds: ['dem'],
      omissions: [{ label: 'Hidrología (OSM)', reason: 'Overpass no respondió.' }],
      parameters: [],
      engineVersion: 'test',
    });

    expect(text).toContain('CAPAS QUE NO ESTÁN EN ESTE ZIP');
    expect(text).toContain('Hidrología (OSM)');
    expect(text).toContain('Overpass no respondió.');
    expect(text).toContain('NO');
  });

  it('LEEME.txt anota el CRS de cada archivo y describe el AOI', () => {
    const text = buildBundleReadme({
      aoiName: 'Zona Norte',
      analysisId: 'an_1',
      areaHa: 120,
      vertexCount: 5,
      bbox: [-69.94, 18.47, -69.93, 18.48],
      utmEpsg: 32619,
      vectorEpsg: 4326,
      clipToAoi: true,
      generatedAt,
      engineVersion: 'test',
      entries: [
        { path: 'raster/dem.tif', description: 'DEM', crs: 'EPSG:32619 (UTM local)' },
        { path: 'vector/aoi.geojson', description: 'AOI', crs: 'EPSG:4326 (WGS84)' },
      ],
      omissions: [{ label: 'NDVI', reason: 'STAC timeout.' }],
    });

    expect(text).toContain('raster/dem.tif');
    expect(text).toContain('EPSG:32619 (UTM local)');
    expect(text).toContain('vector/aoi.geojson');
    expect(text).toContain('EPSG:4326 (WGS84)');
    expect(text).toContain('120,0 ha');
    expect(text).toContain('campos_shapefile.csv');
    expect(text).toContain('CAPAS NO INCLUIDAS');
    expect(text).toContain('STAC timeout.');
  });

  it('resumen.csv trae la fuente en la MISMA fila que el indicador', () => {
    const csv = buildSummaryCsv(analysisFixture());
    const rows = csv.trim().split('\n');
    expect(rows[0]).toBe('tema,indicador,valor,unidad,fuente');

    const elevation = rows.find((row) => row.includes('Elevación media'));
    expect(elevation).toContain('Copernicus DEM GLO-30');
  });

  it('el reporte incluye la costera, que el legacy nunca metía en el Markdown', () => {
    const markdown = buildReportMarkdown({
      analysis: analysisFixture({
        coastal: {
          preset: 'Hoy (histórico) — 100 años de retorno',
          cache_key: 'k',
          available: true,
          error: null,
          summary: {
            has_data: true,
            max_depth_m: 1.4,
            mean_depth_where_flooded_m: 0.6,
            pct_area_flooded: 12,
            resolution_m_approx: 927,
          },
          overlay_url: null,
          raster_url: null,
        },
      }),
      aoiName: 'Zona Norte',
      generatedAt,
    });

    expect(markdown).toContain('## Riesgo costero');
    expect(markdown).toContain('Hoy (histórico) — 100 años de retorno');
    expect(markdown).toContain('screening');
  });

  it('el reporte nombra las fuentes que no respondieron en vez de omitirlas', () => {
    const markdown = buildReportMarkdown({
      analysis: analysisFixture({
        hydrology: {
          summary: {
            available: false,
            features_found: 0,
            intersects_aoi: false,
            nearest_distance_m: null,
            features: [],
          },
          features: [],
        },
        sources: [
          source('raster'),
          source('hidrologia', {
            available: false,
            state: 'error',
            found: 0,
            error: 'Overpass no respondió.',
          }),
          source('areas-protegidas'),
          source('mepyd'),
        ],
      }),
      aoiName: 'Zona Norte',
      generatedAt,
    });

    expect(markdown).toContain('## Fuentes que no respondieron');
    expect(markdown).toContain('Overpass API (OpenStreetMap)');
    expect(markdown).toContain('no significa que no haya datos');
  });

  it('respeta el filtro de secciones', () => {
    const markdown = buildReportMarkdown({
      analysis: analysisFixture(),
      aoiName: 'Zona Norte',
      generatedAt,
      sections: ['topografia'],
    });

    expect(markdown).toContain('## Topografía');
    expect(markdown).not.toContain('## Vegetación');
    expect(markdown).not.toContain('# Reporte territorial');
  });
});
