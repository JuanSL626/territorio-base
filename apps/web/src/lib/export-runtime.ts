/**
 * El trabajo de exportación: asíncrono, con cada artefacto aislado del resto.
 * SOLO SERVIDOR (toca `node:fs`, `node:os` y el servicio raster).
 *
 * Es un job y no una descarga síncrona porque armar el bundle (varios GeoTIFF,
 * hasta 40 shapefiles, el ZIP) toma minutos: un request síncrono se cortaría
 * a los 60s del navegador sin progreso real. `startExportRun` devuelve un id
 * enseguida; la URL (`/descargas/$jobId`) y el progreso (`3/7`, bytes reales
 * por archivo) sobreviven a un F5.
 *
 * Cada artefacto se genera en su propio `try`: un NDVI que falla queda en
 * `error` con motivo y Reintentar, sin tumbar el resto del bundle (regresión
 * #3 del inventario). Por eso NO usa `buildVectorBundleFiles` de
 * `@territorio/geo` (arma todo el bloque vectorial de una pasada — una
 * excepción se llevaría las otras 39 capas); usa sus primitivas
 * (`clipFeaturesToAoi`, `writeShapefileSet`, `projectGeometry`) capa por capa,
 * y arma `campos_shapefile.csv` con el mapa `{nombre largo → nombre DBF}` que
 * devuelve `writeShapefileSet` (H6: el DBF trunca nombres a 10 caracteres y
 * un lector descarta en silencio la columna tapada).
 *
 * Los bytes viven en un directorio temporal por job, no en memoria: los
 * tamaños que muestra la pantalla son reales (`fs.stat`) y un bundle de
 * cientos de MB no se acumula en el heap. El ZIP se arma al momento de la
 * descarga y se transmite (archiver leyendo de disco), nunca se materializa
 * entero.
 *
 * El registro de jobs es un `Map` de módulo (como `analysis-runtime.ts`):
 * estado POR PROCESO. Detrás de un balanceador con varias instancias, un job
 * sólo se ve y se baja desde la instancia que lo creó.
 */
import { ZipArchive } from 'archiver';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  createAoi,
  GEOMETRY_CLASS_SUFFIX,
  projectGeometry,
  writeShapefileSet,
  type Aoi,
  type DbfField,
  type Feature,
} from '@territorio/geo';
// `clipFeaturesToAoi` vive en el entry point server-only del paquete (su
// módulo `export/bundle` importa `archiver` y usa `Buffer`); este archivo ya
// es Node-only, el deep import es gratis.
import { clipFeaturesToAoi } from '@territorio/geo/server';

import { getRasterApi } from './api';
import {
  bundleFilename,
  fileSlug,
  isIncluded,
  mepydFileBase,
  omissions,
  resolveOutputEpsg,
  type ExportArtifactPlan,
  type ExportArtifactStatus,
  type ExportPlan,
  type ExportSelection,
} from './export-contract';
import {
  buildBundleReadme,
  buildReportMarkdown,
  buildSourcesManifest,
  buildSummaryCsv,
  type BundleEntryNote,
} from './export-documents';

import type { TerritorioAnalysis } from './analysis-contract';

/** Pasado este plazo el directorio se borra y el job pasa a `expirado` (pantalla propia, no 404 mudo). */
const BUNDLE_TTL_MS = 60 * 60_000;

/** Cuánto sobrevive el REGISTRO del job después de expirar, para poder decirlo. */
const JOB_RETENTION_MS = BUNDLE_TTL_MS + 30 * 60_000;

const ENGINE_VERSION = 'territorio-base 2.0 (TanStack + services/api)';

export type ExportJobStatus =
  'generando' | 'listo' | 'parcial' | 'error' | 'cancelado' | 'expirado';

export type ExportArtifactSnapshot = {
  id: string;
  label: string;
  group: string;
  status: ExportArtifactStatus;
  /** Bytes REALES una vez generado. `null` mientras no exista el archivo. */
  bytes: number | null;
  reason: string | null;
  /** Rutas dentro del ZIP. Un shapefile aporta 5 y su GeoJSON una sexta. */
  entries: string[];
  /** `true` si tiene sentido ofrecer `[Reintentar]` en la fila. */
  retryable: boolean;
};

export type ExportJobSnapshot = {
  jobId: string;
  analysisId: string;
  status: ExportJobStatus;
  filename: string;
  artifacts: ExportArtifactSnapshot[];
  /** Artefactos terminados (bien o mal) sobre el total. Alimenta `Exportando… 3/7`. */
  done: number;
  total: number;
  /** Bytes reales de lo ya generado. */
  bytes: number;
  createdAt: string;
  finishedAt: string | null;
  /** ISO. Después de esto el bundle se borra. */
  expiresAt: string;
  error: string | null;
  /** `true` si hay al menos un artefacto listo: el ZIP se puede bajar. */
  downloadable: boolean;
};

type JobArtifact = {
  plan: ExportArtifactPlan;
  status: ExportArtifactStatus;
  bytes: number | null;
  reason: string | null;
  entries: string[];
};

type ExportJob = {
  id: string;
  userId: string;
  analysis: TerritorioAnalysis;
  plan: ExportPlan;
  selection: ExportSelection;
  selectedIds: Set<string>;
  dir: string;
  filename: string;
  status: ExportJobStatus;
  createdAt: Date;
  finishedAt: Date | null;
  expiresAt: Date;
  error: string | null;
  artifacts: Map<string, JobArtifact>;
  order: string[];
  /**
   * Campos DBF por ARCHIVO (no por capa), para el `campos_shapefile.csv`: una
   * capa con geometrías mixtas produce dos shapefiles (`…_lineas`, `…_puntos`)
   * con anchos de campo distintos, y por capa el CSV tendría filas contradictorias.
   */
  fieldMap: Map<string, { layer: string; fields: DbfField[] }>;
  abort: AbortController;
  completion: Promise<void>;
  cleanupTimer: NodeJS.Timeout | null;
};

const jobs = new Map<string, ExportJob>();

function newJobId(): string {
  return `exp_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

function snapshotArtifact(artifact: JobArtifact): ExportArtifactSnapshot {
  return {
    id: artifact.plan.id,
    label: artifact.plan.label,
    group: artifact.plan.group,
    status: artifact.status,
    bytes: artifact.bytes,
    reason: artifact.reason,
    entries: [...artifact.entries],
    // Un `omitido` NO es reintentable: el análisis nunca produjo ese dato, así
    // que reintentar sólo daría la misma respuesta más tarde. Un `error` sí:
    // ahí lo que falló fue la generación (red, disco, el servicio raster).
    retryable: artifact.status === 'error',
  };
}

function snapshot(job: ExportJob): ExportJobSnapshot {
  const artifacts = job.order
    .map((id) => job.artifacts.get(id))
    .filter((artifact): artifact is JobArtifact => artifact !== undefined)
    .map(snapshotArtifact);

  const terminal = artifacts.filter(
    (artifact) =>
      artifact.status === 'listo' || artifact.status === 'error' || artifact.status === 'omitido',
  );
  const ready = artifacts.filter((artifact) => artifact.status === 'listo');

  return {
    jobId: job.id,
    analysisId: job.analysis.id,
    status: job.status,
    filename: job.filename,
    artifacts,
    done: terminal.length,
    total: artifacts.length,
    bytes: ready.reduce((sum, artifact) => sum + (artifact.bytes ?? 0), 0),
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
    expiresAt: job.expiresAt.toISOString(),
    error: job.error,
    // `generando` excluye porque `openExportBundle` responde 409 mientras el job
    // corre; el estado del botón tiene que coincidir con lo que la ruta del ZIP hace.
    downloadable:
      job.status !== 'expirado' && job.status !== 'generando' && ready.length > 0,
  };
}

export function getExportSnapshot(jobId: string, userId: string): ExportJobSnapshot | null {
  const job = jobs.get(jobId);
  // Scopeado al dueño, igual que toda lectura de un análisis: un id adivinado
  // no puede devolver el AOI de otra persona.
  if (job?.userId !== userId) return null;
  return snapshot(job);
}

export function cancelExportRun(jobId: string, userId: string): boolean {
  const job = jobs.get(jobId);
  if (job?.userId !== userId) return false;
  if (job.status !== 'generando') return false;
  job.abort.abort(new Error('Cancelado por el usuario.'));
  return true;
}

/** Semilla de test: espera a que el job termine de generar. */
export async function awaitExportRun(jobId: string): Promise<void> {
  await jobs.get(jobId)?.completion;
}

// `lib/api.ts` mantiene el token privado a propósito y sólo devuelve JSON o
// URLs, no bytes. Bajar un GeoTIFF es un `fetch` crudo con `Authorization`,
// con los MISMOS nombres de variable que `api.ts` (duplicación conocida,
// acotada a estas cuatro líneas).
function rasterAuthHeaders(): Record<string, string> {
  const token = process.env.API_TOKEN ?? process.env.TERRITORIO_API_TOKEN;
  return token === undefined || token.trim() === ''
    ? {}
    : { authorization: `Bearer ${token.trim()}` };
}

async function downloadToFile(url: string, target: string, signal: AbortSignal): Promise<number> {
  /*
    El error de transporte de `fetch` es «fetch failed» a secas, que en una fila
    de la pantalla de descargas no le dice nada a nadie. Se traduce acá, donde
    todavía se sabe que lo que falló fue bajar un raster.
  */
  let response: Response;
  try {
    response = await fetch(url, { headers: rasterAuthHeaders(), signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new Error(
      'No se pudo contactar el servicio raster para bajar esta capa. Reintentá en un momento.',
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? 'El servicio raster ya no tiene esta capa: el resultado del análisis expiró en el servicio. Volvé a analizar la zona.'
        : `El servicio raster respondió ${String(response.status)} al pedir esta capa.`,
    );
  }
  const body = response.body;
  if (body === null) throw new Error('El servicio raster respondió sin cuerpo.');

  await pipeline(Readable.from(readWebStream(body)), createWriteStream(target));
  return (await stat(target)).size;
}

/**
 * Lee un `ReadableStream` web como iterable async.
 *
 * `Readable.fromWeb` haría lo mismo, pero su firma pide el `ReadableStream` de
 * `node:stream/web` y `fetch` devuelve el global: los dos tipos no son
 * asignables entre sí y el puente sería una doble aserción. Leer el reader a
 * mano cuesta ocho líneas y no miente sobre ningún tipo.
 */
async function* readWebStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

type VectorSource = { base: string; features: Feature[] };

function hydrologyFeatures(analysis: TerritorioAnalysis): Feature[] {
  return analysis.hydrology.features.map((feature) => ({
    type: 'Feature',
    geometry: feature.geometry,
    properties: {
      osm_id: feature.osm_id,
      kind: feature.kind,
      name: feature.name,
      distance_m: feature.distance_m,
    },
  }));
}

function protectedAreaFeatures(analysis: TerritorioAnalysis): Feature[] {
  return analysis.protected_areas.areas.map((area) => ({
    type: 'Feature',
    geometry: area.geometry,
    properties: {
      name: area.name,
      desig: area.desig,
      desig_eng: area.desig_eng,
      iucn_cat: area.iucn_cat,
      status: area.status,
      // Se trae y la UI nunca lo muestra (inventario §6). En la exportación sí:
      // quien abre el shapefile en QGIS quiere la autoridad de manejo.
      mang_auth: area.mang_auth,
      distance_m: area.distance_m,
      overlap_ha: area.overlap_ha,
    },
  }));
}

function vectorSourceFor(
  analysis: TerritorioAnalysis,
  artifactId: string,
  aoiName: string,
): VectorSource | null {
  if (artifactId === 'vector:aoi') {
    return {
      base: 'aoi',
      features: [
        {
          type: 'Feature',
          geometry: analysis.aoi_geometry,
          properties: {
            nombre: aoiName,
            analisis: analysis.id,
            area_ha: analysis.aoi.area_ha,
            utm_epsg: analysis.aoi.utm_epsg,
          },
        },
      ],
    };
  }
  if (artifactId === 'vector:hidrologia') {
    return { base: 'hidrologia_osm', features: hydrologyFeatures(analysis) };
  }
  if (artifactId === 'vector:wdpa') {
    return { base: 'wdpa', features: protectedAreaFeatures(analysis) };
  }
  if (artifactId.startsWith('mepyd:')) {
    const layerId = artifactId.slice('mepyd:'.length);
    const layer = analysis.mepyd_rd.layers.find((candidate) => candidate.layer_id === layerId);
    if (layer === undefined) return null;
    return {
      base: mepydFileBase(layer.group, layer.label),
      features: layer.features.map((feature) => ({
        type: 'Feature',
        geometry: feature.geometry,
        properties: { ...feature.properties },
      })),
    };
  }
  return null;
}

/**
 * Escribe una capa vectorial: el GeoJSON (WGS84, nombres de columna completos)
 * y el set de shapefiles, uno por clase de geometría.
 *
 * El GeoJSON no es un extra: es el archivo que conserva los nombres de columna
 * sin el corsé de 10 caracteres del DBF y los tipos sin adivinar. El shapefile
 * está porque sigue siendo lo que abre cualquier oficina, no porque sea mejor.
 */
async function writeVectorArtifact(
  job: ExportJob,
  artifact: JobArtifact,
  aoi: Aoi,
): Promise<string[]> {
  const source = vectorSourceFor(job.analysis, artifact.plan.id, job.plan.aoiName);
  if (source === null) {
    throw new Error('El análisis guardado ya no tiene las geometrías de esta capa.');
  }

  const clipped =
    job.selection.clipToAoi && artifact.plan.id !== 'vector:aoi'
      ? clipFeaturesToAoi(source.features, aoi)
      : source.features;

  if (clipped.length === 0) {
    throw new ArtifactNotApplicableError(
      'Después de recortar al AOI, la capa quedó sin elementos dentro del área.',
    );
  }

  const outputEpsg = resolveOutputEpsg(job.selection.crs, job.plan.utmEpsg);
  const entries: string[] = [];

  const geojsonPath = `vector/${source.base}.geojson`;
  await writeFile(
    join(job.dir, geojsonPath),
    JSON.stringify({ type: 'FeatureCollection', features: clipped }),
    'utf-8',
  );
  entries.push(geojsonPath);

  const projected = clipped.map((feature) => ({
    ...feature,
    geometry: projectGeometry(feature.geometry, 4326, outputEpsg),
  }));

  const set = writeShapefileSet({ features: projected, epsg: outputEpsg });
  const multiple = set.size > 1;

  for (const parts of set.values()) {
    // Una "capa" de OSM o del MEPyD puede mezclar líneas y polígonos, y un
    // shapefile guarda un solo tipo: se parte en `…_lineas` / `…_poligonos`.
    const stem = multiple
      ? `${source.base}_${GEOMETRY_CLASS_SUFFIX[parts.geometryClass]}`
      : source.base;
    const files: [string, Uint8Array | string][] = [
      [`vector/${stem}.shp`, parts.shp],
      [`vector/${stem}.shx`, parts.shx],
      [`vector/${stem}.dbf`, parts.dbf],
      [`vector/${stem}.prj`, parts.prj],
      [`vector/${stem}.cpg`, parts.cpg],
    ];
    for (const [path, content] of files) {
      await writeFile(join(job.dir, path), content);
      entries.push(path);
    }
    job.fieldMap.set(`${stem}.dbf`, { layer: artifact.plan.label, fields: parts.fields });
  }

  return entries;
}

function rasterFilename(analysis: TerritorioAnalysis, layer: string): string {
  const declared = analysis.layers.find((candidate) => candidate.layer === layer);
  return declared?.download_filename ?? `${fileSlug(layer)}.tif`;
}

function rasterUrlFor(analysis: TerritorioAnalysis, layer: string, baseUrl: string): string | null {
  if (layer === 'coastal') {
    const url = analysis.coastal?.raster_url;
    if (url != null && url !== '') return url;
  }
  const declared = analysis.layers.find((candidate) => candidate.layer === layer);
  if (declared?.raster_url != null && declared.raster_url !== '') {
    return declared.raster_url.startsWith('http')
      ? declared.raster_url
      : `${baseUrl}${declared.raster_url}`;
  }
  const jobId = analysis.raster_job_id;
  if (jobId === null) return null;
  return `${baseUrl}/analysis/${encodeURIComponent(jobId)}/raster/${encodeURIComponent(layer)}.tif`;
}

async function writeRasterArtifact(
  job: ExportJob,
  artifact: JobArtifact,
  baseUrl: string,
): Promise<string[]> {
  const layer = artifact.plan.id.slice('raster:'.length);
  const url = rasterUrlFor(job.analysis, layer, baseUrl);
  if (url === null) {
    throw new Error(
      'Este análisis no tiene un job en el servicio raster: no hay GeoTIFF que pedir.',
    );
  }

  const path = `raster/${rasterFilename(job.analysis, layer)}`;
  const bytes = await downloadToFile(url, join(job.dir, path), job.abort.signal);
  if (bytes === 0) throw new Error('El servicio raster devolvió un archivo vacío.');
  return [path];
}

const ENTRY_DESCRIPTIONS: readonly { suffix: string; text: string }[] = [
  { suffix: '.tif', text: 'Raster recortado al AOI (GeoTIFF, DEFLATE, nodata explícito).' },
  { suffix: '.geojson', text: 'Capa vectorial con los nombres de columna completos.' },
  { suffix: '.shp', text: 'Shapefile (geometría). Va acompañado de .shx, .dbf, .prj y .cpg.' },
  { suffix: '.csv', text: 'Tabla en texto separado por comas, codificación UTF-8.' },
  { suffix: '.md', text: 'Reporte territorial en Markdown.' },
  { suffix: '.txt', text: 'Documentación del bundle.' },
];

function describeEntry(path: string): string {
  for (const entry of ENTRY_DESCRIPTIONS) {
    if (path.endsWith(entry.suffix)) return entry.text;
  }
  return 'Archivo del bundle.';
}

function crsForEntry(path: string, utmEpsg: number, vectorEpsg: number): string {
  if (path.endsWith('.tif')) return `EPSG:${String(utmEpsg)} (UTM local)`;
  if (path.endsWith('.geojson')) return 'EPSG:4326 (WGS84)';
  if (path.startsWith('vector/') && !path.endsWith('.csv')) {
    return `EPSG:${String(vectorEpsg)}`;
  }
  return 'No aplica (texto)';
}

/** El CSV `{campo DBF → nombre original}` (H6), con la capa y el archivo. */
function fieldMapCsv(fieldMap: Map<string, { layer: string; fields: DbfField[] }>): string {
  const cell = (value: string): string =>
    /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  const rows = ['capa,archivo,campo_dbf,campo_original,tipo,largo,decimales'];
  for (const [file, entry] of fieldMap) {
    for (const field of entry.fields) {
      rows.push(
        [
          entry.layer,
          file,
          field.name,
          field.longName,
          field.type,
          String(field.length),
          String(field.decimals),
        ]
          .map(cell)
          .join(','),
      );
    }
  }
  return `${rows.join('\n')}\n`;
}

/**
 * Los documentos se escriben **al final**, y se reescriben después de cada
 * reintento, porque tienen que contar lo que realmente pasó: qué archivos
 * entraron, en qué CRS, y qué capas quedaron afuera con qué motivo. Generarlos
 * primero produciría un `LEEME.txt` que promete archivos que no están.
 */
async function writeDocuments(job: ExportJob): Promise<void> {
  const generatedAt = new Date();
  const vectorEpsg = resolveOutputEpsg(job.selection.crs, job.plan.utmEpsg);

  const producedEntries: string[] = [];
  for (const id of job.order) {
    const artifact = job.artifacts.get(id);
    if (artifact?.status === 'listo') producedEntries.push(...artifact.entries);
  }

  if (job.fieldMap.size > 0) {
    await writeFile(
      join(job.dir, 'vector/campos_shapefile.csv'),
      fieldMapCsv(job.fieldMap),
      'utf-8',
    );
    producedEntries.push('vector/campos_shapefile.csv');
  }

  const datasetIds = new Set<string>();
  for (const id of job.order) {
    const artifact = job.artifacts.get(id);
    if (artifact?.status === 'listo' && artifact.plan.datasetId !== null) {
      datasetIds.add(artifact.plan.datasetId);
    }
  }

  const planned = omissions(job.plan, job.selectedIds);
  // Lo que se pidió y no entró: fallado o no aplicable. Ambos quedan escritos,
  // el ZIP no puede limitarse a no traer el archivo.
  const failed = job.order
    .map((id) => job.artifacts.get(id))
    .filter(
      (artifact): artifact is JobArtifact =>
        artifact !== undefined &&
        (artifact.status === 'error' || artifact.status === 'omitido') &&
        artifact.reason !== null &&
        isIncluded(artifact.plan, job.selectedIds),
    )
    .map((artifact) => ({ label: artifact.plan.label, reason: artifact.reason ?? '' }));
  const allOmissions = [...planned, ...failed];

  const parameters = [
    { label: 'Resolución NDVI', value: `${String(job.analysis.params.ndvi_resolution_m)} m` },
    { label: 'Ventana Sentinel-2', value: `${String(job.analysis.params.lookback_days)} días` },
    { label: 'Nubosidad máxima', value: `${String(job.analysis.params.max_cloud_cover)} %` },
    { label: 'CRS de los vectores', value: `EPSG:${String(vectorEpsg)}` },
    { label: 'Recorte al AOI', value: job.selection.clipToAoi ? 'sí' : 'no' },
  ];

  const notes: BundleEntryNote[] = [
    { path: 'LEEME.txt', description: 'Este archivo.', crs: 'No aplica (texto)' },
    {
      path: 'FUENTES.txt',
      description: 'Cita, licencia, endpoint y fecha de consulta de cada capa.',
      crs: 'No aplica (texto)',
    },
    ...producedEntries
      .filter(
        (path) =>
          !path.endsWith('.shx') &&
          !path.endsWith('.dbf') &&
          !path.endsWith('.prj') &&
          !path.endsWith('.cpg'),
      )
      .map((path) => ({
        path,
        description: describeEntry(path),
        crs: crsForEntry(path, job.plan.utmEpsg, vectorEpsg),
      })),
  ];

  const documents: [string, string][] = [
    [
      'FUENTES.txt',
      buildSourcesManifest({
        aoiName: job.plan.aoiName,
        generatedAt,
        datasetIds: [...datasetIds],
        omissions: allOmissions,
        parameters,
        engineVersion: ENGINE_VERSION,
      }),
    ],
    [
      'LEEME.txt',
      buildBundleReadme({
        aoiName: job.plan.aoiName,
        analysisId: job.analysis.id,
        areaHa: job.analysis.aoi.area_ha,
        vertexCount: job.analysis.aoi.vertex_count,
        bbox: job.analysis.aoi.bbox,
        utmEpsg: job.plan.utmEpsg,
        vectorEpsg,
        clipToAoi: job.selection.clipToAoi,
        generatedAt,
        engineVersion: ENGINE_VERSION,
        entries: notes,
        omissions: allOmissions,
      }),
    ],
  ];

  for (const [path, content] of documents) {
    await writeFile(join(job.dir, path), content, 'utf-8');
  }

  await markDocument(job, 'doc:leeme', ['LEEME.txt']);
  await markDocument(job, 'doc:fuentes', ['FUENTES.txt']);

  if (job.selectedIds.has('doc:reporte')) {
    await writeFile(
      join(job.dir, 'reporte.md'),
      buildReportMarkdown({
        analysis: job.analysis,
        aoiName: job.plan.aoiName,
        generatedAt,
        sections: job.selection.reportSections,
      }),
      'utf-8',
    );
    await markDocument(job, 'doc:reporte', ['reporte.md']);
  } else {
    skipDocument(job, 'doc:reporte');
  }

  if (job.selectedIds.has('doc:resumen')) {
    await writeFile(join(job.dir, 'resumen.csv'), buildSummaryCsv(job.analysis), 'utf-8');
    await markDocument(job, 'doc:resumen', ['resumen.csv']);
  } else {
    skipDocument(job, 'doc:resumen');
  }
}

/** Un documento que el usuario destildó. Se dice, no se deja en `pendiente`. */
function skipDocument(job: ExportJob, id: string): void {
  const artifact = job.artifacts.get(id);
  if (artifact === undefined) return;
  artifact.status = 'omitido';
  artifact.reason = 'No se pidió en esta exportación.';
  artifact.entries = [];
  artifact.bytes = null;
}

async function markDocument(job: ExportJob, id: string, entries: string[]): Promise<void> {
  const artifact = job.artifacts.get(id);
  if (artifact === undefined) return;
  let bytes = 0;
  for (const entry of entries) bytes += (await stat(join(job.dir, entry))).size;
  artifact.status = 'listo';
  artifact.bytes = bytes;
  artifact.reason = null;
  artifact.entries = entries;
}

// Toma el ID y no el objeto porque el objeto se muta acá adentro y
// `no-param-reassign` prohíbe escribir sobre las propiedades de un parámetro;
// la búsqueda en el mapa deja la mutación contenida en una variable local.
async function runArtifact(
  job: ExportJob,
  artifactId: string,
  aoi: Aoi,
  baseUrl: string,
): Promise<void> {
  const artifact = job.artifacts.get(artifactId);
  if (artifact === undefined) return;

  if (!isIncluded(artifact.plan, job.selectedIds)) {
    artifact.status = 'omitido';
    artifact.reason = artifact.plan.reason ?? 'No se pidió en esta exportación.';
    return;
  }

  if (!artifact.plan.selectable && !artifact.plan.mandatory) {
    // Se pidió algo que el análisis no produjo: se deja dicho, no se inventa.
    artifact.status = 'omitido';
    artifact.reason = artifact.plan.reason ?? 'El análisis no produjo esta capa.';
    return;
  }

  artifact.status = 'generando';
  try {
    const entries =
      artifact.plan.kind === 'raster'
        ? await writeRasterArtifact(job, artifact, baseUrl)
        : await writeVectorArtifact(job, artifact, aoi);

    let bytes = 0;
    for (const entry of entries) bytes += (await stat(join(job.dir, entry))).size;

    artifact.status = 'listo';
    artifact.entries = entries;
    artifact.bytes = bytes;
    artifact.reason = null;
  } catch (error) {
    artifact.status = error instanceof ArtifactNotApplicableError ? 'omitido' : 'error';
    artifact.entries = [];
    artifact.bytes = null;
    artifact.reason = failureMessage(error);
  }
}

/**
 * «Se pidió, y para este AOI no aplica».
 *
 * Distinta de un fallo a propósito: una capa que queda sin elementos después
 * del recorte no se arregla reintentando, así que la fila va a `omitido` (sin
 * botón) en vez de a `error` (con botón). Ofrecer un Reintentar que siempre va
 * a dar lo mismo es peor que no ofrecerlo.
 */
class ArtifactNotApplicableError extends Error {
  override readonly name = 'ArtifactNotApplicableError';
}

function failureMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return 'Se canceló la exportación.';
    return error.message;
  }
  return 'No se pudo generar este archivo.';
}

function resolveStatus(job: ExportJob): ExportJobStatus {
  const artifacts = [...job.artifacts.values()];
  const requested = artifacts.filter((artifact) => isIncluded(artifact.plan, job.selectedIds));
  const ready = requested.filter((artifact) => artifact.status === 'listo');
  const failed = requested.filter((artifact) => artifact.status === 'error');

  if (ready.length === 0) return 'error';
  if (failed.length > 0) return 'parcial';
  return 'listo';
}

export type StartExportInput = {
  userId: string;
  analysis: TerritorioAnalysis;
  plan: ExportPlan;
  selection: ExportSelection;
};

/**
 * Crea el job y arranca la generación en segundo plano. Vuelve enseguida con
 * el id: es lo que va a la URL y lo que sobrevive a un F5.
 */
export function startExportRun(input: StartExportInput): { jobId: string } {
  const jobId = newJobId();
  const createdAt = new Date();
  const selectedIds = new Set(input.selection.artifactIds);

  const job: ExportJob = {
    id: jobId,
    userId: input.userId,
    analysis: input.analysis,
    plan: input.plan,
    selection: input.selection,
    selectedIds,
    dir: join(tmpdir(), `territorio-export-${jobId}`),
    filename: bundleFilename(input.plan.aoiName, createdAt),
    status: 'generando',
    createdAt,
    finishedAt: null,
    expiresAt: new Date(createdAt.getTime() + BUNDLE_TTL_MS),
    error: null,
    artifacts: new Map(),
    order: [],
    fieldMap: new Map(),
    abort: new AbortController(),
    completion: Promise.resolve(),
    cleanupTimer: null,
  };

  /*
    Orden de trabajo: primero los vectores (baratos, en proceso), después los
    rasters (red, lentos), y los documentos al final porque son los únicos que
    necesitan saber cómo les fue a los demás.
  */
  const vectors = input.plan.artifacts.filter((artifact) => artifact.kind === 'vector');
  const rasters = input.plan.artifacts.filter((artifact) => artifact.kind === 'raster');
  const documents = input.plan.artifacts.filter((artifact) => artifact.kind === 'documento');

  // El job registra SÓLO lo pedido (más lo pedido que no se puede hacer). Las
  // capas ofrecidas y no tildadas no entran: con 39 capas MEPyD disponibles,
  // listarlas todas volvería `Exportando… 3/45` un número sin sentido. Que
  // existen y por qué no están lo dicen el modal (antes) y `LEEME.txt` (después).
  const requested = (plan: ExportArtifactPlan): boolean =>
    isIncluded(plan, selectedIds) || selectedIds.has(plan.id);

  for (const plan of [...vectors, ...rasters, ...documents]) {
    if (!requested(plan)) continue;
    job.artifacts.set(plan.id, {
      plan,
      status: 'pendiente',
      bytes: null,
      reason: null,
      entries: [],
    });
    job.order.push(plan.id);
  }

  // El registro se puebla ANTES de arrancar: `execute` busca el job por id y su
  // primer tramo corre sincrónicamente, así que tiene que poder encontrarlo.
  jobs.set(jobId, job);
  job.completion = execute(jobId, [...vectors, ...rasters].filter(requested));
  return { jobId };
}

async function execute(jobId: string, dataArtifacts: ExportArtifactPlan[]): Promise<void> {
  const job = jobs.get(jobId);
  if (job === undefined) return;
  const baseUrl = getRasterApi().baseUrl;

  try {
    await mkdir(join(job.dir, 'vector'), { recursive: true });
    await mkdir(join(job.dir, 'raster'), { recursive: true });

    const aoi = createAoi(job.analysis.aoi_geometry);

    for (const plan of dataArtifacts) {
      if (job.abort.signal.aborted) break;
      await runArtifact(job, plan.id, aoi, baseUrl);
    }

    if (job.abort.signal.aborted) {
      job.status = 'cancelado';
      job.error = 'La exportación se canceló.';
      await rm(job.dir, { recursive: true, force: true });
      return;
    }

    await writeDocuments(job);
    job.status = resolveStatus(job);
    job.error =
      job.status === 'error'
        ? 'Ningún archivo del bundle se pudo generar. Mirá el motivo de cada fila.'
        : null;
  } catch (error) {
    job.status = 'error';
    job.error = failureMessage(error);
  } finally {
    job.finishedAt = new Date();
    scheduleCleanup(jobId);
  }
}

function scheduleCleanup(jobId: string): void {
  const job = jobs.get(jobId);
  if (job === undefined) return;
  if (job.cleanupTimer !== null) clearTimeout(job.cleanupTimer);

  const expire = setTimeout(
    () => {
      job.status = 'expirado';
      job.error = 'El bundle expiró y se borró del servidor. Volvé a exportar.';
      void rm(job.dir, { recursive: true, force: true });
      setTimeout(() => jobs.delete(jobId), JOB_RETENTION_MS - BUNDLE_TTL_MS).unref();
    },
    Math.max(0, job.expiresAt.getTime() - Date.now()),
  );

  // `unref` para que un bundle pendiente de expirar no mantenga vivo el proceso.
  expire.unref();
  job.cleanupTimer = expire;
}

/**
 * Vuelve a generar UN artefacto. Es lo que hay detrás de
 * `NDVI · error (STAC timeout) [Reintentar]`: el resto del bundle no se toca y
 * sigue siendo descargable mientras este reintento corre.
 */
export async function retryExportArtifact(
  jobId: string,
  userId: string,
  artifactId: string,
): Promise<ExportJobSnapshot | null> {
  const job = jobs.get(jobId);
  if (job?.userId !== userId) return null;
  if (job.status === 'expirado' || job.status === 'generando') return snapshot(job);

  if (job.artifacts.get(artifactId)?.status !== 'error') return snapshot(job);

  const baseUrl = getRasterApi().baseUrl;

  job.status = 'generando';
  try {
    await mkdir(join(job.dir, 'vector'), { recursive: true });
    await mkdir(join(job.dir, 'raster'), { recursive: true });
    await runArtifact(job, artifactId, createAoi(job.analysis.aoi_geometry), baseUrl);
    // Los documentos vuelven a escribirse: si el reintento salió bien, el
    // `LEEME.txt` ya no puede seguir diciendo que esa capa falta.
    await writeDocuments(job);
    job.status = resolveStatus(job);
  } catch (error) {
    job.status = resolveStatus(job);
    job.error = failureMessage(error);
  }
  job.finishedAt = new Date();
  return snapshot(job);
}

export type BundleStream = {
  filename: string;
  body: ReadableStream<Uint8Array>;
};

export type OpenBundleResult =
  | { ok: true; bundle: BundleStream }
  | { ok: false; reason: 'no-encontrado' | 'expirado' | 'vacio' | 'generando'; message: string };

/**
 * Abre el bundle para descargarlo.
 *
 * `archiver` lee cada archivo de disco y empuja los bytes comprimidos a la
 * respuesta a medida que los produce: en ningún momento existe el ZIP entero en
 * memoria. La fecha de cada entrada se fija a la de creación del job para que
 * dos descargas del mismo bundle den bytes idénticos.
 */
export function openExportBundle(jobId: string, userId: string): OpenBundleResult {
  const job = jobs.get(jobId);
  if (job?.userId !== userId) {
    return {
      ok: false,
      reason: 'no-encontrado',
      message: 'No existe ese trabajo de exportación, o no es tuyo.',
    };
  }
  if (job.status === 'expirado') {
    return {
      ok: false,
      reason: 'expirado',
      message: 'El bundle expiró y se borró del servidor. Volvé a exportar.',
    };
  }
  if (job.status === 'generando') {
    return {
      ok: false,
      reason: 'generando',
      message: 'El bundle todavía se está generando.',
    };
  }

  const ready = [...job.artifacts.values()].filter((artifact) => artifact.status === 'listo');
  if (ready.length === 0) {
    return {
      ok: false,
      reason: 'vacio',
      message: 'Ningún archivo se pudo generar: no hay nada que bajar.',
    };
  }

  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on('warning', (error) => {
    // Un ENOENT acá es un archivo que desapareció entre el listado y el zipeo.
    // No se puede rescatar el stream, pero sí dejar constancia.
    console.error('[export] advertencia al comprimir el bundle:', error.message);
  });
  archive.on('error', (error) => {
    console.error('[export] error al comprimir el bundle:', error.message);
  });

  for (const artifact of ready) {
    for (const entry of artifact.entries) {
      archive.file(join(job.dir, entry), { name: entry, date: job.createdAt });
    }
  }
  if (job.fieldMap.size > 0) {
    archive.file(join(job.dir, 'vector/campos_shapefile.csv'), {
      name: 'vector/campos_shapefile.csv',
      date: job.createdAt,
    });
  }

  void archive.finalize();

  return {
    ok: true,
    bundle: { filename: job.filename, body: toWebStream(archive) },
  };
}

/**
 * Puente Node → web con contrapresión real.
 *
 * `Readable.toWeb` devuelve el `ReadableStream` de `node:stream/web`, que no es
 * el que acepta `new Response(...)`. Este puente además **pausa la fuente**
 * cuando el consumidor se queda atrás: sin eso, archiver comprimiría el bundle
 * entero a la velocidad del disco y lo acumularía en la cola del stream, que es
 * exactamente el "bufferearlo en memoria" que este diseño evita.
 */
function toWebStream(source: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      source.on('data', (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
        if ((controller.desiredSize ?? 0) <= 0) source.pause();
      });
      source.on('end', () => {
        controller.close();
      });
      source.on('error', (error: Error) => {
        controller.error(error);
      });
    },
    pull() {
      source.resume();
    },
    cancel() {
      source.destroy();
    },
  });
}
