/**
 * EL contrato del análisis. Un análisis = raster (servicio Python) + vector
 * (`@territorio/geo`, en proceso), fusionados en **un solo objeto** con la
 * forma exacta de `00-legacy-inventory.md` §3.
 *
 * Este módulo es la fuente de verdad para el mapa, el reporte y las descargas.
 * Es puro: sin `fetch`, sin base de datos, sin server functions. Se puede
 * importar desde un componente sin arrastrar `node:fs` al bundle.
 *
 * Lo que este archivo existe para no perder (regresión #3 del inventario):
 * en el legacy, un servicio externo caído (Overpass, WDPA) tumbaba el análisis
 * entero: topografía y vegetación ya descargadas se perdían con él. El arreglo
 * fue aislar por fuente, con un booleano `available` que distingue **"no se
 * pudo consultar"** de **"consulté y no hay nada"**. No es un detalle de
 * implementación: gobierna el color y el texto del banner (UC-13..20,
 * TC-07..14). `available: false` pinta rojo con el nombre del servicio;
 * `available: true, found: 0` pinta verde "no hay nada cerca". Colapsar los dos
 * en "lista vacía" es exactamente la regresión.
 *
 * Por eso el contrato tiene, por fuente: `available` (el booleano del §3),
 * `state` (el vocabulario del design brief §0.5) y `found`. Los tres derivan
 * uno del otro, y están los tres porque cada consumidor mira uno distinto.
 *
 * Convención de claves: `snake_case` en todo lo que viaja, porque así lo define
 * el inventario §3 y así lo emite el servicio raster. Los identificadores de
 * código siguen siendo inglés y camelCase.
 */
import { z } from 'zod';

import {
  RASTER_LAYERS,
  type AnalysisStatus,
  type CoastalPreset,
  type CoastalSummary,
  type LayerAvailability,
  type Provenance,
  type TopographyResult,
  type VegetationResult,
} from '@territorio/api-client';
import {
  hydrologySummarySchema,
  protectedAreasSummarySchema,
  type HydrologyKind,
  type HydrologySummary,
  type ProtectedAreasSummary,
  type AreaGeometry,
  type Bounds2D,
  type Geometry,
} from '@territorio/geo';

/**
 * Las cuatro fuentes que un análisis consulta, y que fallan **por separado**.
 *
 * `raster` es una sola fuente desde acá aunque adentro sean tres (DEM,
 * Sentinel-2, WorldCover): el servicio Python ya las aísla entre sí y lo
 * reporta en `topography.available` / `vegetation.ndvi_available` /
 * `vegetation.worldcover_available`.
 */
export const ANALYSIS_SOURCE_IDS = ['raster', 'hidrologia', 'areas-protegidas', 'mepyd'] as const;
export type AnalysisSourceId = (typeof ANALYSIS_SOURCE_IDS)[number];

/** El vocabulario del design brief §0.5, menos `pending` (que no se persiste). */
export const SOURCE_STATES = ['ok', 'empty', 'error', 'skipped'] as const;
export type SourceState = (typeof SOURCE_STATES)[number];

export type SourceStatus = {
  id: AnalysisSourceId;
  /** Nombre del servicio tal cual se lo nombra al usuario (§8, strip ámbar). */
  service: string;
  /**
   * `false` **sólo** si el servicio no respondió. Nunca "consulté y no hay
   * nada" — ese caso es `available: true, found: 0`. Inventario §3.
   */
  available: boolean;
  state: SourceState;
  /** Elementos encontrados. Sólo tiene sentido con `available: true`. */
  found: number;
  /** Motivo en español, listo para mostrar. `null` salvo en `state: 'error'`. */
  error: string | null;
};

/**
 * Los textos EXACTOS de TC-07 y TC-11. Viven acá y no en la UI porque el
 * mensaje es parte del resultado del análisis: el reporte impreso y el banner
 * del panel tienen que decir lo mismo.
 */
export const SOURCE_DOWN_MESSAGES: Record<AnalysisSourceId, string> = {
  raster:
    'No se pudo consultar el servicio raster — no respondió. El resto del análisis sí se completó.',
  hidrologia:
    'No se pudo consultar hidrología (Overpass API) — el servicio no respondió. El resto del análisis sí se completó.',
  'areas-protegidas':
    'No se pudo consultar áreas protegidas (WDPA) — el servicio no respondió. El resto del análisis sí se completó.',
  mepyd:
    'No se pudo consultar el contexto RD (MEPyD) — los servicios no respondieron. El resto del análisis sí se completó.',
};

export const SOURCE_SERVICE_NAMES: Record<AnalysisSourceId, string> = {
  raster: 'Servicio raster (Planetary Computer)',
  hidrologia: 'Overpass API (OpenStreetMap)',
  'areas-protegidas': 'WDPA (UNEP-WCMC)',
  mepyd: 'MEPyD — Sistema de Información para la GRD y la AC',
};

/**
 * Feature de hidrología con geometría, para el mapa. El `distance_m` ya está
 * calculado (segmento a segmento en UTM, H8), así que el mapa y la tabla
 * muestran el mismo número sin recalcular nada.
 */
export type HydrologyFeatureGeo = {
  osm_id: number;
  kind: HydrologyKind;
  name: string | null;
  distance_m: number;
  geometry: Geometry;
};

export type ProtectedAreaGeo = {
  name: string | null;
  desig: string | null;
  desig_eng: string | null;
  iucn_cat: string | null;
  status: string | null;
  /** Se trae y nunca se muestra (inventario §6). Está para la exportación. */
  mang_auth: string | null;
  distance_m: number;
  overlap_ha: number;
  geometry: Geometry;
};

/**
 * Atributos de un feature MEPyD.
 *
 * El esquema es **dinámico por capa** (`outFields="*"`, inventario §6): no
 * existe un tipo estático para "feature MEPyD". Lo que sí se puede acotar son
 * los VALORES: un FeatureServer de ArcGIS devuelve escalares JSON, así que
 * `string | number | boolean | null` es la forma real, no `unknown`.
 *
 * Acotarlo importa por dos razones concretas: la tabla de columnas dinámicas
 * puede renderizar cualquier celda sin castear, y el validador de
 * serialización de las server functions de TanStack Start rechaza `unknown` —
 * con razón, porque no puede probar que viaje.
 */
export type MepydAttributeValue = string | number | boolean | null;
export type MepydAttributes = Record<string, MepydAttributeValue>;

/**
 * Normaliza los atributos crudos de ArcGIS. Un valor no escalar (un objeto
 * anidado inesperado) se serializa a texto en vez de descartarse: la regla de
 * la casa es que nada desaparezca en silencio.
 */
export function toMepydAttributes(properties: Record<string, unknown>): MepydAttributes {
  const out: MepydAttributes = {};
  for (const [key, value] of Object.entries(properties)) {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      out[key] = value;
    } else if (value === undefined) {
      out[key] = null;
    } else {
      out[key] = JSON.stringify(value);
    }
  }
  return out;
}

export type MepydLayerSummaryEntry = { count: number; features: MepydAttributes[] };

/** `{ "<grupo>": { "<capa>": { count, features } } }` — inventario §3. */
export type AnalysisMepydSummary = Record<string, Record<string, MepydLayerSummaryEntry>>;

/** Una capa MEPyD con sus features. El esquema de atributos es dinámico (§6). */
export type MepydLayerGeo = {
  /** Id del registro de capas: `mepyd:<grupo-slug>/<capa-slug>`. */
  layer_id: string;
  group: string;
  label: string;
  count: number;
  features: { properties: MepydAttributes; geometry: Geometry }[];
};

/** Una capa MEPyD que falló. El legacy las descartaba en silencio (§5). */
export type MepydLayerFailure = { group: string; label: string; reason: string };

export type AnalysisParams = {
  /** 10 m por default; 20 m es la alternativa del guard de tamaño (§7.4). */
  ndvi_resolution_m: number;
  lookback_days: number;
  max_cloud_cover: number;
};

export const DEFAULT_ANALYSIS_PARAMS: AnalysisParams = {
  ndvi_resolution_m: 10,
  lookback_days: 180,
  max_cloud_cover: 30,
};

/** `aoi` del §3: hectáreas en UTM, bbox como TUPLA WGS84, y la zona UTM. */
export type AnalysisAoi = {
  area_ha: number;
  bbox: Bounds2D;
  utm_epsg: number;
  /** Vértices del polígono. Alimenta el guard de tamaño (§7.4). */
  vertex_count: number;
};

export type CoastalRun = {
  preset: CoastalPreset;
  cache_key: string;
  available: boolean;
  error: string | null;
  summary: CoastalSummary | null;
  overlay_url: string | null;
  raster_url: string | null;
};

/**
 * El objeto que consumen el mapa, el reporte y las descargas.
 *
 * Es exactamente el `results` del inventario §3, más lo que el rewrite agrega y
 * el legacy no podía representar: el id persistido, el id del job raster (que
 * es lo que direcciona los PNG y los GeoTIFF), el estado por fuente y la
 * inundación costera — que en el legacy vivía sólo en `session_state` y por eso
 * nunca llegaba al reporte (§9, "rarezas adicionales").
 */
export type TerritorioAnalysis = {
  /** Id en `packages/db`. Es el `$analysisId` de `/reporte/$analysisId`. */
  id: string;
  /**
   * Id del job en el servicio raster. `null` si el servicio estaba caído
   * cuando arrancó el análisis: sin él no hay overlays ni GeoTIFF, pero el
   * bloque vectorial sigue siendo válido.
   */
  raster_job_id: string | null;
  status: AnalysisStatus;
  created_at: string;
  finished_at: string | null;
  params: AnalysisParams;

  aoi: AnalysisAoi;
  /**
   * El polígono que produjo ESTOS resultados. Es la única fuente de verdad del
   * "AOI que generó estas capas" y arregla la desincronización de UC-05/TC-47:
   * el mapa nunca vuelve a dibujar un borde nuevo sobre datos viejos.
   * Siempre `Polygon` o `MultiPolygon` — `loadAoiFromGeoJson` une el resto.
   */
  aoi_geometry: AreaGeometry;

  topography: TopographyResult;
  vegetation: VegetationResult;

  hydrology: { summary: HydrologySummary; features: HydrologyFeatureGeo[] };
  protected_areas: { summary: ProtectedAreasSummary; areas: ProtectedAreaGeo[] };
  mepyd_rd: {
    in_rd: boolean;
    summary: AnalysisMepydSummary;
    layers: MepydLayerGeo[];
    failures: MepydLayerFailure[];
    /**
     * `true` si las geometrías MEPyD se descartaron al persistir por tamaño.
     * `summary` (el contrato §3) siempre sobrevive; el mapa vuelve a pedirlas.
     */
    geometries_omitted: boolean;
  };

  provenance: Provenance;
  /** Capas raster que esta corrida produjo de verdad. Maneja el §7.2 "Datos". */
  layers: LayerAvailability[];
  /** Una entrada por fuente. El insumo del §8 "Partial success". */
  sources: SourceStatus[];
  /** On-demand: se adjunta cuando el usuario prende la capa costera. */
  coastal: CoastalRun | null;
};

/** Sólo lo que el reporte necesita: sin geometrías. Para listados y SSR liviano. */
export type TerritorioAnalysisSummary = Omit<
  TerritorioAnalysis,
  'hydrology' | 'protected_areas' | 'mepyd_rd' | 'aoi_geometry'
> & {
  hydrology: { summary: HydrologySummary };
  protected_areas: { summary: ProtectedAreasSummary };
  mepyd_rd: { in_rd: boolean; summary: AnalysisMepydSummary; failures: MepydLayerFailure[] };
};

export function toSummary(analysis: TerritorioAnalysis): TerritorioAnalysisSummary {
  const { aoi_geometry: _geometry, hydrology, protected_areas, mepyd_rd, ...rest } = analysis;
  return {
    ...rest,
    hydrology: { summary: hydrology.summary },
    protected_areas: { summary: protected_areas.summary },
    mepyd_rd: { in_rd: mepyd_rd.in_rd, summary: mepyd_rd.summary, failures: mepyd_rd.failures },
  };
}

export function findSource(
  analysis: Pick<TerritorioAnalysis, 'sources'>,
  id: AnalysisSourceId,
): SourceStatus | undefined {
  return analysis.sources.find((source) => source.id === id);
}

/** Fuentes que no respondieron. Alimenta el strip ámbar del §8 y el §6.5. */
export function downSources(analysis: Pick<TerritorioAnalysis, 'sources'>): SourceStatus[] {
  return analysis.sources.filter((source) => source.state === 'error');
}

export function isTerminalStatus(status: AnalysisStatus): boolean {
  return status === 'ok' || status === 'partial' || status === 'error';
}

/*
  `analysis.result_json` es una columna JSON de SQLite: lo que salió de acá hace
  seis meses puede no tener la forma de hoy. Se valida al LEER, no sólo al
  escribir, así que un resultado viejo se rechaza con un mensaje claro en vez de
  romper el render del reporte con `undefined`.
*/

const geometrySchema: z.ZodType<Geometry> = z.looseObject({
  type: z.enum([
    'Point',
    'MultiPoint',
    'LineString',
    'MultiLineString',
    'Polygon',
    'MultiPolygon',
    'GeometryCollection',
  ]),
}) as unknown as z.ZodType<Geometry>;

const areaGeometrySchema: z.ZodType<AreaGeometry> = z.looseObject({
  type: z.enum(['Polygon', 'MultiPolygon']),
}) as unknown as z.ZodType<AreaGeometry>;

const sourceStatusSchema = z.object({
  id: z.enum(ANALYSIS_SOURCE_IDS),
  service: z.string(),
  available: z.boolean(),
  state: z.enum(SOURCE_STATES),
  found: z.number().int(),
  error: z.string().nullable(),
});

const topographyResultSchema: z.ZodType<TopographyResult> = z.object({
  available: z.boolean(),
  error: z.string().nullable().optional(),
  summary: z
    .object({
      elevation_max_m: z.number(),
      elevation_mean_m: z.number(),
      elevation_min_m: z.number(),
      elevation_range_m: z.number(),
      slope_class_pct: z.record(z.string(), z.number()),
      slope_max_pct: z.number(),
      slope_mean_pct: z.number(),
    })
    .nullable()
    .optional(),
});

const vegetationResultSchema: z.ZodType<VegetationResult> = z.object({
  available: z.boolean(),
  error: z.string().nullable().optional(),
  ndvi_available: z.boolean(),
  ndvi_error: z.string().nullable().optional(),
  worldcover_available: z.boolean(),
  worldcover_error: z.string().nullable().optional(),
  summary: z
    .object({
      ndvi_density_class_pct: z.record(z.string(), z.number()).nullable().optional(),
      ndvi_mean: z.number().nullable().optional(),
      ndvi_median: z.number().nullable().optional(),
      ndvi_p90: z.number().nullable().optional(),
      worldcover_landcover_pct: z.record(z.string(), z.number()).nullable().optional(),
      worldcover_tree_cover_pct: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
});

const provenanceSchema: z.ZodType<Provenance> = z.object({
  dem_item_count: z.number().nullable().optional(),
  dem_source: z.string().nullable().optional(),
  sentinel2_boa_offsets_applied: z.array(z.number()).nullable().optional(),
  sentinel2_lookback_days: z.number().nullable().optional(),
  sentinel2_max_cloud_cover: z.number().nullable().optional(),
  sentinel2_scene_count: z.number().nullable().optional(),
  sentinel2_scene_ids: z.array(z.string()).nullable().optional(),
  worldcover_epoch_year: z.number().nullable().optional(),
});

const layerAvailabilitySchema: z.ZodType<LayerAvailability> = z.object({
  available: z.boolean(),
  default_opacity: z.number(),
  download_filename: z.string(),
  kind: z.enum(['continuous', 'categorical']),
  label: z.string(),
  // Reusa el catálogo generado en vez de duplicarlo a mano: un layer nuevo del
  // lado del servicio (p. ej. `slope_classes`) que no aparezca acá hace fallar
  // TODO el parseo del análisis guardado, no sólo esa fila — es justo el bug
  // que agregar `slope-classes` sin tocar este archivo reintrodujo.
  layer: z.enum(RASTER_LAYERS),
  overlay_metadata_url: z.string().nullable().optional(),
  overlay_url: z.string().nullable().optional(),
  raster_url: z.string().nullable().optional(),
});

const mepydAttributesSchema: z.ZodType<MepydAttributes> = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

const mepydSummarySchema: z.ZodType<AnalysisMepydSummary> = z.record(
  z.string(),
  z.record(
    z.string(),
    z.object({ count: z.number().int(), features: z.array(mepydAttributesSchema) }),
  ),
);

export const territorioAnalysisSchema = z.object({
  id: z.string(),
  raster_job_id: z.string().nullable(),
  status: z.enum(['pending', 'running', 'ok', 'partial', 'error']),
  created_at: z.string(),
  finished_at: z.string().nullable(),
  params: z.object({
    ndvi_resolution_m: z.number(),
    lookback_days: z.number(),
    max_cloud_cover: z.number(),
  }),

  aoi: z.object({
    area_ha: z.number(),
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    utm_epsg: z.number(),
    vertex_count: z.number().int(),
  }),
  aoi_geometry: areaGeometrySchema,

  topography: topographyResultSchema,
  vegetation: vegetationResultSchema,

  hydrology: z.object({
    summary: hydrologySummarySchema,
    features: z.array(
      z.object({
        osm_id: z.number(),
        kind: z.enum(['waterway', 'water_body', 'wetland']),
        name: z.string().nullable(),
        distance_m: z.number(),
        geometry: geometrySchema,
      }),
    ),
  }),
  protected_areas: z.object({
    summary: protectedAreasSummarySchema,
    areas: z.array(
      z.object({
        name: z.string().nullable(),
        desig: z.string().nullable(),
        desig_eng: z.string().nullable(),
        iucn_cat: z.string().nullable(),
        status: z.string().nullable(),
        mang_auth: z.string().nullable(),
        distance_m: z.number(),
        overlap_ha: z.number(),
        geometry: geometrySchema,
      }),
    ),
  }),
  mepyd_rd: z.object({
    in_rd: z.boolean(),
    summary: mepydSummarySchema,
    layers: z.array(
      z.object({
        layer_id: z.string(),
        group: z.string(),
        label: z.string(),
        count: z.number().int(),
        features: z.array(
          z.object({ properties: mepydAttributesSchema, geometry: geometrySchema }),
        ),
      }),
    ),
    failures: z.array(z.object({ group: z.string(), label: z.string(), reason: z.string() })),
    geometries_omitted: z.boolean(),
  }),

  provenance: provenanceSchema,
  layers: z.array(layerAvailabilitySchema),
  sources: z.array(sourceStatusSchema),
  coastal: z
    .object({
      preset: z.string(),
      cache_key: z.string(),
      available: z.boolean(),
      error: z.string().nullable(),
      summary: z
        .object({
          has_data: z.boolean(),
          max_depth_m: z.number().nullable().optional(),
          mean_depth_where_flooded_m: z.number().nullable().optional(),
          pct_area_flooded: z.number().nullable().optional(),
          resolution_m_approx: z.number().nullable().optional(),
        })
        .nullable(),
      overlay_url: z.string().nullable(),
      raster_url: z.string().nullable(),
    })
    .nullable(),
}) satisfies z.ZodType;

/**
 * Lee un `result_json` de la base.
 *
 * `null` = la fila existe pero su resultado es de otra versión del contrato (o
 * el análisis todavía no terminó). El llamador decide si eso es "reanalizá" o
 * "todavía corriendo"; lo que NO puede pasar es que un objeto a medias se
 * cuele hasta el render.
 */
export function parseStoredAnalysis(value: unknown): TerritorioAnalysis | null {
  const parsed = territorioAnalysisSchema.safeParse(value);
  return parsed.success ? (parsed.data as TerritorioAnalysis) : null;
}

/**
 * El veredicto de tamaño, y la razón por la que vive acá y no sólo en el
 * componente: el guard tiene que aplicarse **en el servidor, antes de arrancar
 * el job**. Un chequeo que sólo existe en el cliente es una sugerencia, y la
 * regla del §7.4 es explícita en que el costo se explica *antes* del click y
 * nunca como timeout post-hoc. `components/analysis/aoi-size-guard.tsx` pinta
 * el mismo veredicto; los umbrales son estos.
 */
export const AOI_SIZE_THRESHOLDS = {
  /** ≤ 500 ha: sigue en silencio. */
  quietHa: 500,
  /** 500–2 000 ha: aviso con costo estimado y una alternativa concreta. */
  warnHa: 2_000,
  /** Resolución mínima de Sentinel-2 aceptable arriba del umbral de bloqueo. */
  downgradedResolutionM: 20,
} as const;

export type AoiSizeVerdict = 'ok' | 'warn' | 'block';

export function verdictForAreaHa(areaHa: number): AoiSizeVerdict {
  if (areaHa <= AOI_SIZE_THRESHOLDS.quietHa) return 'ok';
  if (areaHa <= AOI_SIZE_THRESHOLDS.warnHa) return 'warn';
  return 'block';
}

export type AoiSizeDecision =
  | { allowed: true; verdict: AoiSizeVerdict; ndviResolutionM: number }
  | { allowed: false; verdict: Exclude<AoiSizeVerdict, 'ok'>; message: string };

/**
 * Decide si un análisis puede arrancar con estos parámetros.
 *
 * - `ok` (≤500 ha): siempre pasa.
 * - `warn` (500–2 000 ha): pasa si el usuario dijo "Analizar igual"
 *   (`confirmed`) **o** si ya bajó el NDVI a 20 m o más.
 * - `block` (>2 000 ha): pasa **sólo** con NDVI a 20 m o más. Confirmar no
 *   alcanza: el compuesto a 10 m sobre esa superficie no termina.
 */
export function decideAoiSize(input: {
  areaHa: number;
  ndviResolutionM: number;
  confirmed: boolean;
}): AoiSizeDecision {
  const verdict = verdictForAreaHa(input.areaHa);
  const downgraded = input.ndviResolutionM >= AOI_SIZE_THRESHOLDS.downgradedResolutionM;

  if (verdict === 'ok') {
    return { allowed: true, verdict, ndviResolutionM: input.ndviResolutionM };
  }

  if (verdict === 'warn') {
    if (input.confirmed || downgraded) {
      return { allowed: true, verdict, ndviResolutionM: input.ndviResolutionM };
    }
    return {
      allowed: false,
      verdict,
      message:
        `AOI grande (${Math.round(input.areaHa).toLocaleString('es-DO')} ha). ` +
        'El análisis Sentinel-2 a 10 m puede tardar ~4 min. ' +
        'Confirmá «Analizar igual» o bajá el NDVI a 20 m.',
    };
  }

  if (downgraded) {
    return { allowed: true, verdict, ndviResolutionM: input.ndviResolutionM };
  }
  return {
    allowed: false,
    verdict,
    message:
      `AOI muy grande (${Math.round(input.areaHa).toLocaleString('es-DO')} ha). ` +
      'Arriba de 2 000 ha el compuesto Sentinel-2 a 10 m no se corre: tarda demasiado ' +
      'y suele fallar por timeout. Bajá el NDVI a 20 m o dividí el AOI.',
  };
}
