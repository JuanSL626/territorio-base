/**
 * El job, de punta a punta y sobre disco de verdad.
 *
 * Lo que se prueba acá no es "el ZIP se arma": es que **un artefacto que falla
 * no se lleva puesto el bundle** (§7.1) y que lo que faltó queda escrito
 * adentro. El DEM del fixture apunta a un servicio que no está: tiene que
 * fallar solo, y el bloque vectorial y los documentos tienen que salir igual y
 * quedar descargables.
 *
 * El GeoTIFF apunta a un puerto cerrado en loopback: falla en milisegundos y
 * sin salir de la máquina.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ANALYSIS_PARAMS,
  SOURCE_SERVICE_NAMES,
  type TerritorioAnalysis,
} from './analysis-contract';
import { buildExportPlan, defaultSelection, type ExportSelection } from './export-contract';
import {
  awaitExportRun,
  getExportSnapshot,
  openExportBundle,
  startExportRun,
} from './export-runtime';

import type { AreaGeometry } from '@territorio/geo';

const USER = 'user-1';

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

function analysisFixture(): TerritorioAnalysis {
  return {
    id: 'an_1',
    raster_job_id: 'job-1',
    status: 'partial',
    created_at: '2026-01-15T10:00:00.000Z',
    finished_at: '2026-01-15T10:03:00.000Z',
    params: DEFAULT_ANALYSIS_PARAMS,
    aoi: { area_ha: 120, bbox: [-69.94, 18.47, -69.93, 18.48], utm_epsg: 32619, vertex_count: 5 },
    aoi_geometry: AOI_GEOMETRY,
    topography: { available: false, error: 'El servicio raster no respondió.', summary: null },
    vegetation: {
      available: false,
      error: 'El servicio raster no respondió.',
      ndvi_available: false,
      ndvi_error: null,
      worldcover_available: false,
      worldcover_error: null,
      summary: null,
    },
    hydrology: {
      summary: {
        available: true,
        features_found: 1,
        intersects_aoi: true,
        nearest_distance_m: 0,
        features: [{ osm_id: 1, kind: 'waterway', name: 'Arroyo Seco', distance_m: 0 }],
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
      ],
    },
    protected_areas: {
      summary: {
        available: true,
        areas_found: 0,
        intersects_aoi: false,
        overlap_ha: 0,
        overlap_pct_of_aoi: 0,
        nearest_distance_m: null,
        areas: [],
      },
      areas: [],
    },
    mepyd_rd: {
      in_rd: true,
      summary: {},
      layers: [],
      failures: [],
      geometries_omitted: false,
    },
    provenance: {},
    layers: [
      {
        available: true,
        default_opacity: 0.7,
        download_filename: 'elevacion.tif',
        kind: 'continuous',
        label: 'Elevación (DEM)',
        layer: 'dem',
        overlay_url: null,
        /*
          Puerto cerrado en loopback: la descarga falla al instante y sin salir
          de la máquina. Es la forma más barata de ejercitar el camino «el
          artefacto falló» sin montar un servidor ni mockear `fetch`.
        */
        raster_url: 'http://127.0.0.1:1/analysis/job-1/raster/dem.tif',
      },
    ],
    sources: [
      {
        id: 'raster',
        service: SOURCE_SERVICE_NAMES.raster,
        available: false,
        state: 'error',
        found: 0,
        error: 'El servicio raster no respondió.',
      },
      {
        id: 'hidrologia',
        service: SOURCE_SERVICE_NAMES.hidrologia,
        available: true,
        state: 'ok',
        found: 1,
        error: null,
      },
      {
        id: 'areas-protegidas',
        service: SOURCE_SERVICE_NAMES['areas-protegidas'],
        available: true,
        state: 'empty',
        found: 0,
        error: null,
      },
      {
        id: 'mepyd',
        service: SOURCE_SERVICE_NAMES.mepyd,
        available: true,
        state: 'empty',
        found: 0,
        error: null,
      },
    ],
    coastal: null,
  };
}

async function runJob(): Promise<string> {
  const analysis = analysisFixture();
  const plan = buildExportPlan({ analysis, aoiName: 'Zona Norte' });
  const selection: ExportSelection = {
    /*
      Se tilda todo lo tildable, más dos que NO se pueden hacer: el DEM (el
      servicio no está) y WDPA (la consulta no devolvió áreas). Los dos tienen
      que aparecer en el trabajo, porque el usuario los pidió.
    */
    artifactIds: [...defaultSelection(plan), 'raster:dem', 'vector:wdpa'],
    crs: 'wgs84',
    clipToAoi: true,
    reportSections: [],
  };

  const { jobId } = startExportRun({ userId: USER, analysis, plan, selection });
  await awaitExportRun(jobId);
  return jobId;
}

async function readZipEntries(body: ReadableStream<Uint8Array>): Promise<string[]> {
  const chunks: Uint8Array[] = [];
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  /*
    Se leen los encabezados locales (`PK\3\4`) en vez de descomprimir: alcanza
    para probar QUÉ entró al ZIP, que es lo que este test afirma, y no agrega
    una dependencia de lectura de ZIP sólo para eso.
  */
  const view = new DataView(bytes.buffer);
  const decoder = new TextDecoder();
  const names: string[] = [];
  for (let i = 0; i + 30 <= bytes.length; i += 1) {
    if (view.getUint32(i, true) !== 0x04034b50) continue;
    const nameLength = view.getUint16(i + 26, true);
    names.push(decoder.decode(bytes.subarray(i + 30, i + 30 + nameLength)));
  }
  return names;
}

describe('startExportRun', () => {
  it('un raster imposible falla solo y el resto del bundle queda descargable', async () => {
    const jobId = await runJob();
    const job = getExportSnapshot(jobId, USER);
    expect(job).not.toBeNull();
    if (job === null) return;

    // El trabajo terminó PARCIAL: hay faltantes, no es un fracaso.
    expect(job.status).toBe('parcial');
    expect(job.downloadable).toBe(true);

    const dem = job.artifacts.find((artifact) => artifact.id === 'raster:dem');
    expect(dem?.status).toBe('error');
    expect(dem?.reason).toContain('No se pudo contactar el servicio raster');
    // Y se puede reintentar: falló la generación, no el dato.
    expect(dem?.retryable).toBe(true);

    const hidro = job.artifacts.find((artifact) => artifact.id === 'vector:hidrologia');
    expect(hidro?.status).toBe('listo');
    expect(hidro?.bytes).toBeGreaterThan(0);

    /*
      Se pidió WDPA y el análisis no la produjo: la fila está, dice por qué, y
      NO ofrece reintento — reintentar daría exactamente lo mismo, porque lo que
      falta es el dato, no la generación.
    */
    const wdpa = job.artifacts.find((artifact) => artifact.id === 'vector:wdpa');
    expect(wdpa?.status).toBe('omitido');
    expect(wdpa?.retryable).toBe(false);
    expect(wdpa?.reason).toContain('WDPA');

    // Lo que NO se pidió no ensucia la pantalla del trabajo.
    expect(job.artifacts.some((artifact) => artifact.id === 'raster:coastal')).toBe(false);
  });

  it('el ZIP trae el shapefile con sus cinco sidecars, el GeoJSON, el mapa de campos y la documentación', async () => {
    const jobId = await runJob();
    const opened = openExportBundle(jobId, USER);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    expect(opened.bundle.filename).toMatch(/^territorio-base_zona-norte_\d{4}-\d{2}-\d{2}\.zip$/);

    const names = await readZipEntries(opened.bundle.body);

    expect(names).toContain('LEEME.txt');
    expect(names).toContain('FUENTES.txt');
    expect(names).toContain('vector/campos_shapefile.csv');
    expect(names).toContain('vector/aoi.geojson');
    expect(names).toContain('vector/hidrologia_osm.geojson');
    for (const extension of ['shp', 'shx', 'dbf', 'prj', 'cpg']) {
      expect(names, extension).toContain(`vector/aoi.${extension}`);
    }
    // El DEM falló: no puede haber un `raster/` mudo con un archivo a medias.
    expect(names.some((name) => name.startsWith('raster/'))).toBe(false);
  });

  it('un job de otro usuario no existe', async () => {
    const jobId = await runJob();
    expect(getExportSnapshot(jobId, 'otro')).toBeNull();
    const opened = openExportBundle(jobId, 'otro');
    expect(opened.ok).toBe(false);
    expect(!opened.ok && opened.reason).toBe('no-encontrado');
  });
});
