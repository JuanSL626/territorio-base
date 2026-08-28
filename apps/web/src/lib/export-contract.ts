/**
 * EL contrato de la exportación: qué se puede bajar, cómo se llama el archivo
 * adentro del ZIP y cuánto va a pesar aproximadamente.
 *
 * Puro. Sin `fetch`, sin `node:fs`, sin base de datos — lo importan por igual
 * el modal (browser) y el runtime del job (servidor), y tienen que estar de
 * acuerdo sobre la lista de artefactos hasta el último id.
 *
 * La regla que gobierna todo este archivo (design brief §7.2 y §13): el menú
 * de exportación se genera **desde lo que el análisis produjo de verdad**,
 * nunca desde una lista estática de formatos. Un raster que el
 * servicio no pudo calcular y una capa vectorial cuya fuente estaba caída
 * aparecen igual en la lista — grises, sin checkbox, **con el motivo escrito**.
 *
 * Eso no es cosmética: es la regresión #3 del inventario aplicada a la
 * descarga. Si la lista sólo mostrara lo que salió bien, el usuario se llevaría
 * un ZIP sin hidrología sin enterarse nunca de que Overpass estaba caído — que
 * es exactamente "fallar en silencio con datos incompletos". Por eso el plan
 * conserva los artefactos imposibles, y por eso `omissions()` existe: lo que no
 * entró al bundle tiene que quedar escrito ADENTRO del bundle.
 */
import {
  AOI_SIZE_THRESHOLDS,
  SOURCE_DOWN_MESSAGES,
  type AnalysisSourceId,
  type SourceStatus,
  type TerritorioAnalysis,
} from './analysis-contract';
import { formatNumber } from './format';

import type { RasterLayer } from '@territorio/api-client';

/** Un artefacto es raster (GeoTIFF), vector (SHP + GeoJSON) o documento. */
export type ExportArtifactKind = 'raster' | 'vector' | 'documento';

/**
 * Estado de un artefacto DENTRO de un job. `omitido` es el que importa: el
 * artefacto se pidió, no se pudo generar, y el bundle lo dice en el `LEEME.txt`
 * en vez de simplemente no traerlo.
 */
export type ExportArtifactStatus = 'pendiente' | 'generando' | 'listo' | 'omitido' | 'error';

export type ExportArtifactPlan = {
  /** `raster:dem`, `vector:hidrologia`, `mepyd:<layer_id>`, `doc:reporte`. */
  id: string;
  kind: ExportArtifactKind;
  label: string;
  /** Grupo del panel de capas (`GROUP_ORDER`), para agrupar los checkboxes. */
  group: string;
  /** Formatos que produce, en texto: `GeoTIFF`, `Shapefile + GeoJSON`, `Markdown`. */
  formats: string;
  /**
   * `false` = el análisis no lo produjo. La fila se pinta gris, sin checkbox, y
   * `reason` explica por qué (§7.2, "las capas fallidas/omitidas aparecen
   * grises con su motivo y sin checkbox").
   */
  selectable: boolean;
  reason: string | null;
  /** Preseleccionado al abrir el modal. */
  defaultSelected: boolean;
  /**
   * Obligatorio: no se puede destildar. El AOI y los documentos de fuentes van
   * SIEMPRE — un ZIP sin `FUENTES.txt` no es un entregable, es un archivo suelto.
   */
  mandatory: boolean;
  estimatedBytes: number;
  /** Id de `DATASET_CITATIONS` (`@territorio/geo`), para armar `FUENTES.txt`. */
  datasetId: string | null;
  /** Features que van a salir. `null` en rasters y documentos. */
  featureCount: number | null;
};

export type ExportPlan = {
  analysisId: string;
  /** Nombre legible del AOI; también da nombre al ZIP. */
  aoiName: string;
  areaHa: number;
  utmEpsg: number;
  vertexCount: number;
  /** Resolución efectiva del NDVI en esta corrida. Informa el estimado. */
  ndviResolutionM: number;
  artifacts: ExportArtifactPlan[];
};

export const EXPORT_CRS_OPTIONS = ['wgs84', 'utm'] as const;
export type ExportCrsOption = (typeof EXPORT_CRS_OPTIONS)[number];

export type ExportSelection = {
  artifactIds: string[];
  /** CRS de salida de los VECTORES. Los `.geojson` siempre son WGS84 (RFC 7946). */
  crs: ExportCrsOption;
  /** Recortar los vectores al AOI antes de escribirlos. Default `true` (§7.2). */
  clipToAoi: boolean;
  /** Secciones del `reporte.md`. Vacío = todas. */
  reportSections: ReportSectionId[];
};

export const REPORT_SECTION_IDS = [
  'portada',
  'topografia',
  'vegetacion',
  'hidrologia',
  'areas-protegidas',
  'riesgo-costero',
  'contexto-rd',
  'fuentes',
] as const;
export type ReportSectionId = (typeof REPORT_SECTION_IDS)[number];

export const REPORT_SECTION_LABELS: Record<ReportSectionId, string> = {
  portada: 'Portada y resumen del AOI',
  topografia: 'Topografía',
  vegetacion: 'Vegetación',
  hidrologia: 'Hidrología',
  'areas-protegidas': 'Áreas protegidas',
  'riesgo-costero': 'Riesgo costero',
  'contexto-rd': 'Contexto RD (MEPyD)',
  fuentes: 'Fuentes y licencias',
};

export function resolveOutputEpsg(crs: ExportCrsOption, utmEpsg: number): number {
  return crs === 'utm' ? utmEpsg : 4326;
}

/** El mismo orden que el panel de capas (`layers/registry.ts::GROUP_ORDER`). */
export const EXPORT_GROUP_ORDER = [
  'Documentos',
  'Área de estudio',
  'Topografía',
  'Vegetación',
  'Hidrología',
  'Áreas protegidas',
  'Riesgo costero',
  'Contexto RD (MEPyD)',
] as const;

export type ExportGroup = { group: string; artifacts: ExportArtifactPlan[] };

/** Agrupa el plan para pintarlo como el panel de capas. */
export function groupArtifacts(artifacts: readonly ExportArtifactPlan[]): ExportGroup[] {
  const byGroup = new Map<string, ExportArtifactPlan[]>();
  for (const artifact of artifacts) {
    const bucket = byGroup.get(artifact.group);
    if (bucket === undefined) byGroup.set(artifact.group, [artifact]);
    else bucket.push(artifact);
  }

  const known: ExportGroup[] = [];
  for (const group of EXPORT_GROUP_ORDER) {
    const bucket = byGroup.get(group);
    if (bucket !== undefined) {
      known.push({ group, artifacts: bucket });
      byGroup.delete(group);
    }
  }
  // Un grupo que no está en el orden conocido se muestra igual, al final: la
  // alternativa es que una capa nueva desaparezca de la exportación en silencio.
  for (const [group, bucket] of byGroup) known.push({ group, artifacts: bucket });
  return known;
}

/** `Zona Norte, Puerto Plata` → `zona_norte_puerto_plata`, apto para archivo. */
export function fileSlug(value: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug === '' ? 'capa' : slug;
}

/**
 * Nombre de archivo de una capa MEPyD: `mepyd_<grupo>_<capa>` (§7.3).
 * El `layer_id` es `mepyd:<grupo-slug>/<capa-slug>`.
 */
export function mepydFileBase(group: string, label: string): string {
  return `mepyd_${fileSlug(group)}_${fileSlug(label)}`;
}

/** Nombre del ZIP: `territorio-base_<aoi-slug>_<YYYY-MM-DD>.zip`. */
export function bundleFilename(aoiName: string, generatedAt: Date): string {
  const slug = aoiName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `territorio-base_${slug === '' ? 'aoi' : slug}_${generatedAt.toISOString().slice(0, 10)}.zip`;
}

/*
  El estimado existe porque el §7.2 pide "ver un tamaño estimado" ANTES de
  arrancar el job, y el job puede tardar minutos. Es deliberadamente grueso y
  se rotula como estimado en la UI: en cuanto un artefacto se materializa, el
  job reporta BYTES REALES y la pantalla deja de mostrar el estimado.

  Raster: píxeles = superficie / resolución²; bytes por píxel según el dtype
  que declara `render/palettes.py` (float32 en los continuos, uint8 en los
  categóricos); factor 0,45 por la compresión DEFLATE que aplica el servicio.
*/
const DEFLATE_FACTOR = 0.45;
const M2_PER_HA = 10_000;

const RASTER_RESOLUTION_M: Record<RasterLayer, number> = {
  dem: 30,
  slope: 30,
  aspect: 30,
  ndvi: 10,
  ndvi_density: 10,
  worldcover: 10,
  coastal: 927,
};

const RASTER_BYTES_PER_PIXEL: Record<RasterLayer, number> = {
  dem: 4,
  slope: 4,
  aspect: 4,
  ndvi: 4,
  ndvi_density: 1,
  worldcover: 1,
  coastal: 4,
};

export function estimateRasterBytes(
  layer: RasterLayer,
  areaHa: number,
  ndviResolutionM: number,
): number {
  const declared = RASTER_RESOLUTION_M[layer];
  // El NDVI es la única capa cuya resolución la elige el usuario (§7.4).
  const resolution = layer === 'ndvi' || layer === 'ndvi_density' ? ndviResolutionM : declared;
  const pixels = (areaHa * M2_PER_HA) / (resolution * resolution);
  return Math.round(pixels * RASTER_BYTES_PER_PIXEL[layer] * DEFLATE_FACTOR) + 2_048;
}

/**
 * Vector: un shapefile + su GeoJSON. ~320 B por feature es lo que da la
 * geometría media de estas fuentes (líneas de `waterway`, polígonos de barrio)
 * más su fila DBF, ya comprimido.
 */
export function estimateVectorBytes(featureCount: number): number {
  return Math.round(featureCount * 320 * DEFLATE_FACTOR) + 4_096;
}

export function totalEstimatedBytes(plan: ExportPlan, selectedIds: ReadonlySet<string>): number {
  return plan.artifacts
    .filter((artifact) => selectedIds.has(artifact.id) || artifact.mandatory)
    .reduce((sum, artifact) => sum + artifact.estimatedBytes, 0);
}

/** El motivo mostrable de una fuente que no respondió durante el análisis. */
function sourceReason(status: SourceStatus | undefined, id: AnalysisSourceId): string | null {
  if (status === undefined) return SOURCE_DOWN_MESSAGES[id];
  if (status.state === 'error') return status.error ?? SOURCE_DOWN_MESSAGES[id];
  if (status.state === 'skipped') return 'No se consultó para este AOI.';
  return null;
}

/**
 * Motivo por el que un raster no está disponible. El servicio lo reporta a
 * nivel de sub-resultado (`topography.error`, `vegetation.ndvi_error`,
 * `vegetation.worldcover_error`), así que se busca el más específico primero:
 * "STAC timeout en Sentinel-2" es una frase accionable, "el raster falló" no.
 */
function rasterReason(analysis: TerritorioAnalysis, layer: RasterLayer): string {
  const { topography, vegetation } = analysis;
  switch (layer) {
    case 'dem':
    case 'slope':
    case 'aspect':
      return topography.error ?? 'El servicio no pudo generar esta capa para este AOI.';
    case 'ndvi':
    case 'ndvi_density':
      return (
        vegetation.ndvi_error ??
        vegetation.error ??
        'No hubo escenas Sentinel-2 utilizables para este AOI y esta ventana temporal.'
      );
    case 'worldcover':
      return (
        vegetation.worldcover_error ??
        vegetation.error ??
        'El servicio no pudo generar esta capa para este AOI.'
      );
    case 'coastal':
      return (
        analysis.coastal?.error ??
        'Todavía no se exploró la inundación costera en este análisis: prendé la capa en el mapa y elegí un escenario.'
      );
  }
}

const RASTER_GROUP: Record<RasterLayer, string> = {
  dem: 'Topografía',
  slope: 'Topografía',
  aspect: 'Topografía',
  ndvi: 'Vegetación',
  ndvi_density: 'Vegetación',
  worldcover: 'Vegetación',
  coastal: 'Riesgo costero',
};

const RASTER_DATASET: Record<RasterLayer, string> = {
  dem: 'dem',
  slope: 'dem',
  aspect: 'dem',
  ndvi: 'ndvi',
  ndvi_density: 'ndvi',
  worldcover: 'worldcover',
  coastal: 'aqueduct',
};

/**
 * `aspect` (orientación) se calcula, se guarda y **nunca se ofreció**: el
 * legacy no le puso botón de descarga y el inventario lo marca como "rareza a
 * decidir explícitamente" (§9). La decisión acá es exponerlo y NO
 * preseleccionarlo: esconder un archivo que el motor ya produjo es la misma
 * clase de silencio que este proyecto viene arreglando, pero meterlo por
 * default en todos los ZIP sería sumar peso que nadie pidió.
 */
const NOT_SELECTED_BY_DEFAULT = new Set<RasterLayer>(['aspect']);

export type BuildExportPlanOptions = {
  analysis: TerritorioAnalysis;
  /** Nombre legible del AOI. Sin él, un fallback estable. */
  aoiName?: string;
};

export function buildExportPlan(options: BuildExportPlanOptions): ExportPlan {
  const { analysis } = options;
  const aoiName = options.aoiName ?? `AOI ${analysis.id.slice(0, 8)}`;
  const areaHa = analysis.aoi.area_ha;
  const ndviResolutionM = analysis.params.ndvi_resolution_m;
  const artifacts: ExportArtifactPlan[] = [];

  artifacts.push(
    {
      id: 'doc:leeme',
      kind: 'documento',
      label: 'LEEME.txt — qué es cada archivo, en qué CRS y con qué AOI',
      group: 'Documentos',
      formats: 'Texto',
      selectable: false,
      reason: 'Va siempre.',
      defaultSelected: true,
      mandatory: true,
      estimatedBytes: 4_096,
      datasetId: null,
      featureCount: null,
    },
    {
      id: 'doc:fuentes',
      kind: 'documento',
      label: 'FUENTES.txt — cita, licencia y advertencias de cada capa incluida',
      group: 'Documentos',
      formats: 'Texto',
      selectable: false,
      reason: 'Va siempre.',
      defaultSelected: true,
      mandatory: true,
      estimatedBytes: 8_192,
      datasetId: null,
      featureCount: null,
    },
    {
      id: 'doc:reporte',
      kind: 'documento',
      label: 'reporte.md — el reporte territorial completo',
      group: 'Documentos',
      formats: 'Markdown',
      selectable: true,
      reason: null,
      defaultSelected: true,
      mandatory: false,
      estimatedBytes: 12_288,
      datasetId: null,
      featureCount: null,
    },
    {
      id: 'doc:resumen',
      kind: 'documento',
      label: 'resumen.csv — una fila por indicador: tema, indicador, valor, unidad, fuente',
      group: 'Documentos',
      formats: 'CSV',
      selectable: true,
      reason: null,
      defaultSelected: true,
      mandatory: false,
      estimatedBytes: 4_096,
      datasetId: null,
      featureCount: null,
    },
  );

  artifacts.push({
    id: 'vector:aoi',
    kind: 'vector',
    label: 'Límite del AOI',
    group: 'Área de estudio',
    formats: 'Shapefile + GeoJSON',
    selectable: false,
    reason: 'Va siempre: sin el polígono, ningún otro archivo del ZIP se puede ubicar.',
    defaultSelected: true,
    mandatory: true,
    estimatedBytes: estimateVectorBytes(1),
    datasetId: null,
    featureCount: 1,
  });

  const hasRasterJob = analysis.raster_job_id !== null;
  for (const layer of analysis.layers) {
    const available = layer.available && hasRasterJob;
    artifacts.push({
      id: `raster:${layer.layer}`,
      kind: 'raster',
      label: layer.label,
      group: RASTER_GROUP[layer.layer],
      formats: 'GeoTIFF',
      selectable: available,
      reason: available
        ? null
        : hasRasterJob
          ? rasterReason(analysis, layer.layer)
          : SOURCE_DOWN_MESSAGES.raster,
      defaultSelected: available && !NOT_SELECTED_BY_DEFAULT.has(layer.layer),
      mandatory: false,
      estimatedBytes: estimateRasterBytes(layer.layer, areaHa, ndviResolutionM),
      datasetId: RASTER_DATASET[layer.layer],
      featureCount: null,
    });
  }

  /*
    La costera vive fuera de `layers` porque es on-demand (§7.3 del inventario:
    en el legacy ni siquiera llegaba al reporte). Si el usuario la exploró, es
    parte del artefacto y se puede bajar; si no, la fila lo dice.
  */
  if (!analysis.layers.some((layer) => layer.layer === 'coastal')) {
    const coastal = analysis.coastal;
    const available = coastal !== null && coastal.available && coastal.raster_url !== null;
    artifacts.push({
      id: 'raster:coastal',
      kind: 'raster',
      label: 'Inundación costera (WRI Aqueduct)',
      group: 'Riesgo costero',
      formats: 'GeoTIFF',
      selectable: available,
      reason: available ? null : rasterReason(analysis, 'coastal'),
      defaultSelected: available,
      mandatory: false,
      estimatedBytes: estimateRasterBytes('coastal', areaHa, ndviResolutionM),
      datasetId: 'aqueduct',
      featureCount: null,
    });
  }

  const bySource = new Map(analysis.sources.map((source) => [source.id, source]));

  const hydroReason = sourceReason(bySource.get('hidrologia'), 'hidrologia');
  const hydroCount = analysis.hydrology.features.length;
  artifacts.push({
    id: 'vector:hidrologia',
    kind: 'vector',
    label: 'Hidrología (OSM)',
    group: 'Hidrología',
    formats: 'Shapefile + GeoJSON',
    selectable: hydroReason === null && hydroCount > 0,
    reason:
      hydroReason ??
      (hydroCount === 0 ? 'Se consultó Overpass y no hay hidrología cerca del AOI.' : null),
    defaultSelected: hydroReason === null && hydroCount > 0,
    mandatory: false,
    estimatedBytes: estimateVectorBytes(hydroCount),
    datasetId: 'hidrologia',
    featureCount: hydroCount,
  });

  const wdpaReason = sourceReason(bySource.get('areas-protegidas'), 'areas-protegidas');
  const wdpaCount = analysis.protected_areas.areas.length;
  artifacts.push({
    id: 'vector:wdpa',
    kind: 'vector',
    label: 'Áreas protegidas (WDPA)',
    group: 'Áreas protegidas',
    formats: 'Shapefile + GeoJSON',
    selectable: wdpaReason === null && wdpaCount > 0,
    reason:
      wdpaReason ??
      (wdpaCount === 0 ? 'Se consultó WDPA y no hay áreas protegidas cerca del AOI.' : null),
    defaultSelected: wdpaReason === null && wdpaCount > 0,
    mandatory: false,
    estimatedBytes: estimateVectorBytes(wdpaCount),
    datasetId: 'wdpa',
    featureCount: wdpaCount,
  });

  artifacts.push(...mepydArtifacts(analysis, bySource.get('mepyd')));

  return {
    analysisId: analysis.id,
    aoiName,
    areaHa,
    utmEpsg: analysis.aoi.utm_epsg,
    vertexCount: analysis.aoi.vertex_count,
    ndviResolutionM,
    artifacts,
  };
}

/**
 * Las capas MEPyD tienen cuatro estados y los cuatro tienen que llegar a la
 * lista distintos:
 *   - AOI fuera de RD → una sola fila `skipped`, sin capas.
 *   - la capa trajo features → exportable.
 *   - la capa falló (está en `failures`) → gris, con el motivo del servicio.
 *   - las geometrías se descartaron al persistir por tamaño
 *     (`geometries_omitted`) → gris, y el motivo dice que el resumen sí está.
 */
function mepydArtifacts(
  analysis: TerritorioAnalysis,
  status: SourceStatus | undefined,
): ExportArtifactPlan[] {
  const mepyd = analysis.mepyd_rd;
  const group = 'Contexto RD (MEPyD)';

  if (!mepyd.in_rd) {
    return [
      {
        id: 'mepyd:none',
        kind: 'vector',
        label: 'Contexto RD (MEPyD)',
        group,
        formats: 'Shapefile + GeoJSON',
        selectable: false,
        reason: 'El AOI está fuera de República Dominicana: no se consultaron los servicios MEPyD.',
        defaultSelected: false,
        mandatory: false,
        estimatedBytes: 0,
        datasetId: 'mepyd',
        featureCount: null,
      },
    ];
  }

  const down = sourceReason(status, 'mepyd');
  const artifacts: ExportArtifactPlan[] = [];

  for (const layer of mepyd.layers) {
    const usable = down === null && !mepyd.geometries_omitted && layer.features.length > 0;
    artifacts.push({
      id: `mepyd:${layer.layer_id}`,
      kind: 'vector',
      label: `${layer.group} · ${layer.label}`,
      group,
      formats: 'Shapefile + GeoJSON',
      selectable: usable,
      reason: usable
        ? null
        : (down ??
          (mepyd.geometries_omitted
            ? 'Las geometrías de esta capa no se guardaron por tamaño del resultado. El conteo y los atributos sí están en el resumen.'
            : 'La capa quedó sin features tras el recorte al AOI.')),
      // Las capas de contexto son muchas (hasta 39): se ofrecen, no se
      // preseleccionan. Un ZIP con 39 shapefiles que nadie pidió no ayuda.
      defaultSelected: false,
      mandatory: false,
      estimatedBytes: estimateVectorBytes(layer.count),
      datasetId: 'mepyd',
      featureCount: layer.count,
    });
  }

  for (const failure of mepyd.failures) {
    artifacts.push({
      id: `mepyd:fallo:${fileSlug(failure.group)}/${fileSlug(failure.label)}`,
      kind: 'vector',
      label: `${failure.group} · ${failure.label}`,
      group,
      formats: 'Shapefile + GeoJSON',
      selectable: false,
      reason: failure.reason,
      defaultSelected: false,
      mandatory: false,
      estimatedBytes: 0,
      datasetId: 'mepyd',
      featureCount: null,
    });
  }

  if (artifacts.length === 0) {
    artifacts.push({
      id: 'mepyd:none',
      kind: 'vector',
      label: 'Contexto RD (MEPyD)',
      group,
      formats: 'Shapefile + GeoJSON',
      selectable: false,
      reason: down ?? 'Ninguna capa MEPyD devolvió resultados dentro del AOI.',
      defaultSelected: false,
      mandatory: false,
      estimatedBytes: 0,
      datasetId: 'mepyd',
      featureCount: null,
    });
  }

  return artifacts;
}

export type ExportOmission = { label: string; reason: string };

/**
 * Los artefactos que el usuario pidió (o que se ofrecían) y no se pueden
 * generar, con el motivo. Va al `LEEME.txt`: la ausencia de una capa en el ZIP
 * tiene que estar explicada adentro del ZIP, no sólo en una pantalla que el
 * que abre el archivo seis meses después nunca vio.
 */
export function omissions(plan: ExportPlan, selectedIds: ReadonlySet<string>): ExportOmission[] {
  return (
    plan.artifacts
      .filter((artifact) => !artifact.selectable && artifact.reason !== null && !artifact.mandatory)
      .filter((artifact) => artifact.kind !== 'documento')
      // Se listan las que el usuario tildó Y las que ni siquiera pudo tildar: las
      // segundas son justamente las que necesita ver explicadas.
      .filter((artifact) => selectedIds.has(artifact.id) || !artifact.selectable)
      .map((artifact) => ({ label: artifact.label, reason: artifact.reason ?? '' }))
  );
}

/** Ids preseleccionados al abrir el modal. */
export function defaultSelection(plan: ExportPlan): string[] {
  return plan.artifacts
    .filter((artifact) => artifact.defaultSelected || artifact.mandatory)
    .map((artifact) => artifact.id);
}

/** Un artefacto entra al bundle si se lo tildó o si es obligatorio. */
export function isIncluded(
  artifact: ExportArtifactPlan,
  selectedIds: ReadonlySet<string>,
): boolean {
  return artifact.mandatory || (artifact.selectable && selectedIds.has(artifact.id));
}

/*
  El §7.4 es explícito en la forma, no sólo en el número: el costo se explica
  ANTES del click y nunca como un timeout post-hoc. Para la exportación el costo
  tiene dos caras que hay que mirar juntas:

    - la SUPERFICIE del AOI, que es lo que hace caro recortar y escribir
      vectores (los mismos umbrales de 500 / 2 000 ha del análisis, porque es el
      mismo polígono y el mismo trabajo geométrico), y
    - el TAMAÑO ESTIMADO del ZIP, que es lo que hace inviable la descarga aunque
      el AOI sea chico: 39 capas MEPyD tildadas producen un bundle que nadie
      quiere bajar por una conexión doméstica.

  Se aplica en el SERVIDOR, dentro de `startExport`. El chequeo del cliente es
  una cortesía para poder explicarlo con un botón al lado; éste es el que manda.
*/

/** Arriba de esto se pide confirmación explícita. */
export const EXPORT_WARN_BYTES = 250 * 1024 * 1024;

/** Tope duro: no se arma un bundle más grande que esto. */
export const EXPORT_MAX_BYTES = 2 * 1024 * 1024 * 1024;

export type ExportSizeVerdict = 'ok' | 'warn' | 'block';

export type ExportSizeDecision =
  | { allowed: true; verdict: 'ok' | 'warn'; estimatedBytes: number }
  | {
      allowed: false;
      verdict: Exclude<ExportSizeVerdict, 'ok'>;
      estimatedBytes: number;
      message: string;
    };

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

function ha(value: number): string {
  /*
    `formatNumber` y no `toLocaleString`: el resto del producto escribe
    `1 240,5 ha` (espacio fino de miles, coma decimal). `toLocaleString('es-DO')`
    devolvía `3,000 ha`, que en esa misma convención se lee «3 hectáreas». Ver
    la cabecera de `format.ts` — también evita el mismatch SSR/cliente por
    datos de locale distintos entre Node y el navegador.
  */
  return `${formatNumber(value, 0)} ha`;
}

/**
 * Decide si esta exportación puede arrancar.
 *
 * - `ok`: sigue en silencio.
 * - `warn`: pasa sólo con `confirmed` (el usuario apretó «Exportar igual»),
 *   y el mensaje dice cuánto va a pesar y cuánto puede tardar.
 * - `block`: no pasa. La salida no es "esperá más": es destildar rasters o
 *   capas de contexto, que es lo único que efectivamente baja el número.
 */
export function decideExportSize(input: {
  areaHa: number;
  estimatedBytes: number;
  artifactCount: number;
  confirmed: boolean;
}): ExportSizeDecision {
  const { areaHa, estimatedBytes } = input;

  if (estimatedBytes > EXPORT_MAX_BYTES) {
    return {
      allowed: false,
      verdict: 'block',
      estimatedBytes,
      message:
        `La selección pesa ~${mb(estimatedBytes)}, arriba del tope de ${mb(EXPORT_MAX_BYTES)}. ` +
        'Un ZIP de ese tamaño tarda más en bajarse que en generarse y se corta a la mitad. ' +
        'Destildá los rasters que no vayas a usar, o las capas de contexto RD, y volvé a intentar.',
    };
  }

  if (areaHa > AOI_SIZE_THRESHOLDS.warnHa && !input.confirmed) {
    return {
      allowed: false,
      verdict: 'block',
      estimatedBytes,
      message:
        `AOI muy grande (${ha(areaHa)}). Recortar y escribir ${String(input.artifactCount)} capas ` +
        'sobre esa superficie puede tardar varios minutos y el ZIP rondaría los ' +
        `${mb(estimatedBytes)}. Confirmá «Exportar igual» si lo necesitás así, o achicá la selección.`,
    };
  }

  if (estimatedBytes > EXPORT_WARN_BYTES && !input.confirmed) {
    return {
      allowed: false,
      verdict: 'warn',
      estimatedBytes,
      message:
        `La selección pesa ~${mb(estimatedBytes)}. Por una conexión doméstica eso es una descarga ` +
        'de varios minutos. Confirmá «Exportar igual» o destildá lo que no vayas a usar.',
    };
  }

  if (areaHa > AOI_SIZE_THRESHOLDS.quietHa && !input.confirmed) {
    return {
      allowed: false,
      verdict: 'warn',
      estimatedBytes,
      message:
        `AOI grande (${ha(areaHa)}). Preparar el bundle puede tardar un par de minutos; ` +
        'podés cerrar la pestaña, el trabajo sigue del lado del servidor.',
    };
  }

  const verdict: 'ok' | 'warn' =
    areaHa > AOI_SIZE_THRESHOLDS.quietHa || estimatedBytes > EXPORT_WARN_BYTES ? 'warn' : 'ok';
  return { allowed: true, verdict, estimatedBytes };
}
