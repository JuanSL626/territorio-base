/**
 * Validación zod en el borde HTTP + prueba de que el zod y el esquema
 * **generado** dicen exactamente lo mismo.
 *
 * Por qué las dos cosas:
 *
 * - Los tipos de `./generated/schema.ts` son la fuente de verdad, pero son
 *   *tipos*: en runtime no existen. Un servicio desplegado viejo, un proxy que
 *   devuelve HTML, o un campo renombrado en Python pasan el compilador y
 *   explotan tres capas más abajo con `undefined is not a function`.
 * - zod valida en runtime, pero un zod escrito a mano se desincroniza del
 *   servicio en silencio, que es exactamente el problema que generar los tipos
 *   venía a resolver.
 *
 * `CONTRACT_PARITY` cierra el círculo: es una tabla de igualdades de tipo
 * `Exact<z.infer<typeof X>, SchemaX>`. Si alguien regenera el cliente y el
 * servicio cambió una forma, **este archivo deja de compilar** y el diff dice
 * cuál. No hay forma de que un zod desactualizado sobreviva a `pnpm typecheck`.
 *
 * El único bloque sin contraparte generada es el de SSE: FastAPI no describe el
 * cuerpo de `text/event-stream` en OpenAPI, así que los eventos `progress`,
 * `status`, `done` y `error` se validan contra un zod escrito a mano, anclado a
 * `main.py::stream_analysis_events` y a `jobs.py::_emit`.
 */
import { z } from 'zod';

import type {
  SchemaAnalysisJob,
  SchemaAnalysisResult,
  SchemaAoiInfo,
  SchemaCoastalResponse,
  SchemaCoastalSummary,
  SchemaDerivedProductProvenance,
  SchemaErrorResponse,
  SchemaHealthResponse,
  SchemaLayerAvailability,
  SchemaLegendEntry,
  SchemaLandsatNdviSummary,
  SchemaLandsatPilotResult,
  SchemaOverlayMetadata,
  SchemaPresetsResponse,
  SchemaProgressEvent,
  SchemaProvenance,
  SchemaRemoteSensingAsset,
  SchemaRemoteSensingBand,
  SchemaRemoteSensingPilotResult,
  SchemaRemoteSensingScene,
  SchemaRemoteSensingSourceInfo,
  SchemaRemoteSensingSourcesResponse,
  SchemaRemoteSensingTemporalState,
  SchemaTopographyResult,
  SchemaTopographySummary,
  SchemaVegetationResult,
  SchemaVegetationSummary,
} from './generated/schema.ts';

/**
 * Estados de un job. `partial` es un desenlace real y esperado: alguna fuente
 * falló pero hay resultado utilizable (regresión #3).
 */
export const ANALYSIS_STATUSES = ['pending', 'running', 'ok', 'partial', 'error'] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

/** Capas raster que el servicio sabe rasterizar y exportar. */
export const RASTER_LAYERS = [
  'dem',
  'slope',
  'slope_classes',
  'aspect',
  'ndvi',
  'ndvi_density',
  'worldcover',
  'coastal',
] as const;
export type RasterLayer = (typeof RASTER_LAYERS)[number];

/**
 * Los 5 presets de WRI Aqueduct, con sus strings EXACTOS (inventario §4).
 * El orden es el del selectbox legacy y es parte del contrato.
 */
export const COASTAL_PRESETS = [
  'Hoy (histórico) — 100 años de retorno',
  '2050 · RCP4.5 (optimista) — 100 años',
  '2050 · RCP8.5 (pesimista) — 100 años',
  '2080 · RCP8.5 (pesimista) — 100 años',
  '2080 · RCP8.5 (pesimista) — 1000 años (extremo)',
] as const;
export type CoastalPreset = (typeof COASTAL_PRESETS)[number];

/** `campo?: T | null` de FastAPI: puede faltar o venir en `null`. */
function nullish<T extends z.ZodType>(schema: T): z.ZodOptional<z.ZodNullable<T>> {
  return schema.nullable().optional();
}

export const errorResponseSchema = z.object({
  detail: z.string(),
});

export const healthResponseSchema = z.object({
  jobs_in_flight: z.number(),
  status: z.literal('ok'),
  version: z.string(),
});

export const aoiInfoSchema = z.object({
  area_ha: z.number(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  utm_epsg: z.number(),
});

export const topographySummarySchema = z.object({
  elevation_max_m: z.number(),
  elevation_mean_m: z.number(),
  elevation_min_m: z.number(),
  elevation_range_m: z.number(),
  slope_class_pct: z.record(z.string(), z.number()),
  slope_max_pct: z.number(),
  slope_mean_pct: z.number(),
});

export const topographyResultSchema = z.object({
  available: z.boolean(),
  error: nullish(z.string()),
  summary: nullish(topographySummarySchema),
});

export const vegetationSummarySchema = z.object({
  ndvi_density_class_pct: nullish(z.record(z.string(), z.number())),
  ndvi_mean: nullish(z.number()),
  ndvi_median: nullish(z.number()),
  ndvi_p90: nullish(z.number()),
  worldcover_landcover_pct: nullish(z.record(z.string(), z.number())),
  worldcover_tree_cover_pct: nullish(z.number()),
});

export const vegetationResultSchema = z.object({
  available: z.boolean(),
  error: nullish(z.string()),
  ndvi_available: z.boolean(),
  ndvi_error: nullish(z.string()),
  summary: nullish(vegetationSummarySchema),
  worldcover_available: z.boolean(),
  worldcover_error: nullish(z.string()),
});

export const derivedProductProvenanceSchema = z.object({
  bands_used: z.array(z.string()),
  formula: z.string(),
  metadata_origin: z.literal('derived'),
  parameters: z
    .record(z.string(), z.union([z.string(), z.number(), z.array(z.number())]))
    .optional(),
  product: z.string(),
  scene_ids: z.array(z.string()),
  source: z.string(),
});

export const provenanceSchema = z.object({
  dem_item_count: nullish(z.number()),
  dem_source: nullish(z.string()),
  derived_products: z.array(derivedProductProvenanceSchema).optional(),
  sentinel2_acquisition_datetimes: nullish(z.array(z.string())),
  sentinel2_boa_offsets_applied: nullish(z.array(z.number())),
  sentinel2_fallback_used: nullish(z.boolean()),
  sentinel2_fallback_window_days: nullish(z.number()),
  sentinel2_last_checked_at: nullish(z.string()),
  sentinel2_last_used_acquisition_datetimes: nullish(z.array(z.string())),
  sentinel2_last_used_scene_ids: nullish(z.array(z.string())),
  sentinel2_latest_acquisition_datetime: nullish(z.string()),
  sentinel2_latest_available_acquisition_datetime: nullish(z.string()),
  sentinel2_latest_available_cloud_cover_pct: nullish(z.number()),
  sentinel2_latest_available_scene_id: nullish(z.string()),
  sentinel2_latest_valid_acquisition_datetime: nullish(z.string()),
  sentinel2_latest_valid_cloud_cover_pct: nullish(z.number()),
  sentinel2_latest_valid_scene_id: nullish(z.string()),
  sentinel2_lookback_days: nullish(z.number()),
  sentinel2_max_cloud_cover: nullish(z.number()),
  sentinel2_observation_age_days: nullish(z.number()),
  sentinel2_oldest_acquisition_datetime: nullish(z.string()),
  sentinel2_primary_window_days: nullish(z.number()),
  sentinel2_scene_count: nullish(z.number()),
  sentinel2_scene_ids: nullish(z.array(z.string())),
  sentinel2_selection_window_days: nullish(z.number()),
  sentinel2_temporal_message: nullish(z.string()),
  sentinel2_temporal_status: nullish(
    z.enum(['updated', 'delayed', 'cloudy', 'no_valid_data']),
  ),
  worldcover_epoch_year: nullish(z.number()),
});

export const layerAvailabilitySchema = z.object({
  available: z.boolean(),
  default_opacity: z.number(),
  download_filename: z.string(),
  kind: z.enum(['continuous', 'categorical']),
  label: z.string(),
  layer: z.enum(RASTER_LAYERS),
  overlay_metadata_url: nullish(z.string()),
  overlay_url: nullish(z.string()),
  raster_url: nullish(z.string()),
});

export const analysisResultSchema = z.object({
  aoi: aoiInfoSchema,
  layers: z.array(layerAvailabilitySchema),
  provenance: provenanceSchema,
  topography: topographyResultSchema,
  vegetation: vegetationResultSchema,
});

export const progressEventSchema = z.object({
  at: z.string(),
  message: z.string(),
  step: z.number(),
  total: z.number(),
});

export const analysisJobSchema = z.object({
  aoi: nullish(aoiInfoSchema),
  created_at: z.string(),
  error: nullish(z.string()),
  events_url: z.string(),
  finished_at: nullish(z.string()),
  id: z.string(),
  progress: z.array(progressEventSchema).optional(),
  result: nullish(analysisResultSchema),
  self_url: z.string(),
  started_at: nullish(z.string()),
  status: z.enum(ANALYSIS_STATUSES),
});

export const legendEntrySchema = z.object({
  code: nullish(z.number()),
  color: z.string(),
  label: z.string(),
  value: nullish(z.number()),
});

export const overlayMetadataSchema = z.object({
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  coordinates: z.array(z.array(z.number())),
  height: z.number(),
  layer: z.enum(RASTER_LAYERS),
  legend: z.array(legendEntrySchema),
  legend_title: z.string(),
  opacity: z.number(),
  png_url: z.string(),
  vmax: nullish(z.number()),
  vmin: nullish(z.number()),
  width: z.number(),
});

export const coastalSummarySchema = z.object({
  has_data: z.boolean(),
  max_depth_m: nullish(z.number()),
  mean_depth_where_flooded_m: nullish(z.number()),
  pct_area_flooded: nullish(z.number()),
  resolution_m_approx: nullish(z.number()),
});

export const coastalResponseSchema = z.object({
  analysis_id: nullish(z.string()),
  available: z.boolean(),
  cache_key: z.string(),
  cached: z.boolean(),
  error: nullish(z.string()),
  overlay_metadata_url: nullish(z.string()),
  overlay_url: nullish(z.string()),
  preset: z.enum(COASTAL_PRESETS),
  raster_url: nullish(z.string()),
  summary: nullish(coastalSummarySchema),
});

export const presetsResponseSchema = z.object({
  presets: z.array(z.string()),
});

export const REMOTE_SENSING_SOURCES = [
  'planetary-computer-sentinel-2-l2a',
  'cdse-sentinel-2-l2a',
  'cdse-sentinel-1-grd',
  'usgs-m2m-landsat-9-c2-l2',
  'nasa-earthdata-viirs-nrt',
  'nasa-gibs-wmts',
] as const;

export const remoteSensingBandSchema = z.object({
  center_wavelength_um: nullish(z.number()),
  common_name: nullish(z.string()),
  full_width_half_max_um: nullish(z.number()),
  id: z.string(),
  name: nullish(z.string()),
  resolution_m: nullish(z.number()),
  wavelength_max_um: nullish(z.number()),
  wavelength_min_um: nullish(z.number()),
});

export const remoteSensingAssetSchema = z.object({
  bands: z.array(remoteSensingBandSchema).optional(),
  data_type: nullish(z.string()),
  datum: nullish(z.string()),
  effective_radiometric_resolution_bits: nullish(z.number()),
  epsg: nullish(z.number()),
  file_size_bytes: nullish(z.number()),
  format: nullish(z.string()),
  href: nullish(z.string()),
  key: z.string(),
  projection: nullish(z.string()),
  raster_dimensions_px: nullish(z.tuple([z.number(), z.number()])),
  title: nullish(z.string()),
});

export const remoteSensingSceneSchema: z.ZodType<SchemaRemoteSensingScene> = z.object({
  acquisition_datetime: nullish(z.string()),
  assets: z.array(remoteSensingAssetSchema).optional(),
  attribution: nullish(z.string()),
  cloud_cover_pct: nullish(z.number()),
  cloud_validity: z.enum(['valid', 'cloudy', 'unknown']),
  collection: z.string(),
  last_checked_at: z.string(),
  license: nullish(z.string()),
  metadata_origin: z.record(z.string(), z.enum(['provider', 'derived', 'unavailable'])).optional(),
  mission: z.string(),
  product_level: nullish(z.string()),
  published_or_processed_at: nullish(z.string()),
  scene_id: z.string(),
  sensor: nullish(z.string()),
  source: z.string(),
  spectral_range_um: nullish(z.tuple([z.number(), z.number()])),
  total_band_count: nullish(z.number()),
});

export const remoteSensingTemporalStateSchema = z.object({
  last_scene_available: nullish(remoteSensingSceneSchema),
  last_scene_used: nullish(remoteSensingSceneSchema),
  last_valid_cloud_free_scene: nullish(remoteSensingSceneSchema),
  message: z.string(),
  observation_age_hours: nullish(z.number()),
  status: z.enum([
    'updated',
    'delayed',
    'cloudy',
    'no_valid_data',
    'provider_error',
    'credentials_required',
  ]),
});

export const remoteSensingPilotResultSchema = z.object({
  cache_key: z.string(),
  cached: z.boolean(),
  checked_at: z.string(),
  credentials_required: z.array(z.string()).optional(),
  limitations: z.array(z.string()).optional(),
  preview_url: nullish(z.string()),
  source: z.enum(REMOTE_SENSING_SOURCES),
  temporal: remoteSensingTemporalStateSchema,
});

export const remoteSensingSourceInfoSchema = z.object({
  collection: z.string(),
  credentials_required: z.array(z.string()).optional(),
  free_to_use: z.boolean(),
  provider: z.string(),
  purpose: z.string(),
  source: z.enum(REMOTE_SENSING_SOURCES),
});

export const remoteSensingSourcesResponseSchema = z.object({
  sources: z.array(remoteSensingSourceInfoSchema),
});

export const landsatNdviSummarySchema = z.object({
  mean: z.number(),
  median: z.number(),
  p90: z.number(),
  valid_pixel_pct: z.number(),
});

export const landsatPilotResultSchema = z.object({
  cache_key: z.string(),
  cached: z.boolean(),
  checked_at: z.string(),
  credentials_required: z.array(z.string()).optional(),
  derived_product: nullish(derivedProductProvenanceSchema),
  message: z.string(),
  preview_url: nullish(z.string()),
  raster_url: nullish(z.string()),
  scene: nullish(remoteSensingSceneSchema),
  source_assets: z.array(remoteSensingAssetSchema).optional(),
  status: z.enum([
    'ready',
    'preparing',
    'no_valid_data',
    'provider_error',
    'credentials_required',
    'access_required',
  ]),
  summary: nullish(landsatNdviSummarySchema),
});

export type ErrorResponse = SchemaErrorResponse;
export type HealthResponse = SchemaHealthResponse;
export type AoiInfo = SchemaAoiInfo;
export type TopographySummary = SchemaTopographySummary;
export type TopographyResult = SchemaTopographyResult;
export type VegetationSummary = SchemaVegetationSummary;
export type VegetationResult = SchemaVegetationResult;
export type Provenance = SchemaProvenance;
export type DerivedProductProvenance = SchemaDerivedProductProvenance;
export type LayerAvailability = SchemaLayerAvailability;
export type AnalysisResult = SchemaAnalysisResult;
export type ProgressEvent = SchemaProgressEvent;
export type AnalysisJob = SchemaAnalysisJob;
export type LegendEntry = SchemaLegendEntry;
export type OverlayMetadata = SchemaOverlayMetadata;
export type CoastalSummary = SchemaCoastalSummary;
export type CoastalResponse = SchemaCoastalResponse;
export type PresetsResponse = SchemaPresetsResponse;
export type RemoteSensingBand = SchemaRemoteSensingBand;
export type RemoteSensingAsset = SchemaRemoteSensingAsset;
export type RemoteSensingScene = SchemaRemoteSensingScene;
export type RemoteSensingTemporalState = SchemaRemoteSensingTemporalState;
export type RemoteSensingPilotResult = SchemaRemoteSensingPilotResult;
export type RemoteSensingSourceInfo = SchemaRemoteSensingSourceInfo;
export type RemoteSensingSourcesResponse = SchemaRemoteSensingSourcesResponse;
export type LandsatNdviSummary = SchemaLandsatNdviSummary;
export type LandsatPilotResult = SchemaLandsatPilotResult;
export type RemoteSensingSource = (typeof REMOTE_SENSING_SOURCES)[number];

/**
 * Igualdad de tipos estricta (no bidireccional-por-asignabilidad: eso dejaría
 * pasar `string` vs `string | undefined`).
 */
/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters --
   El truco canónico de igualdad exacta compara dos firmas genéricas idénticas;
   que `T` aparezca una sola vez en cada una ES el mecanismo. Reescribirlo sin
   el parámetro lo convertiría en asignabilidad mutua, que da `true` para
   `string` vs `string | undefined` — justo lo que esta prueba existe para
   detectar. */
type Exact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
/* eslint-enable @typescript-eslint/no-unnecessary-type-parameters */

/**
 * Cada entrada es `true` sólo si el zod y el tipo generado son idénticos.
 * Si el servicio cambia y alguien regenera sin actualizar el zod, la
 * anotación de tipo de `CONTRACT_PARITY` deja de compilar acá.
 */
export type ContractParity = {
  errorResponse: Exact<z.infer<typeof errorResponseSchema>, ErrorResponse>;
  healthResponse: Exact<z.infer<typeof healthResponseSchema>, HealthResponse>;
  aoiInfo: Exact<z.infer<typeof aoiInfoSchema>, AoiInfo>;
  topographySummary: Exact<z.infer<typeof topographySummarySchema>, TopographySummary>;
  topographyResult: Exact<z.infer<typeof topographyResultSchema>, TopographyResult>;
  vegetationSummary: Exact<z.infer<typeof vegetationSummarySchema>, VegetationSummary>;
  vegetationResult: Exact<z.infer<typeof vegetationResultSchema>, VegetationResult>;
  provenance: Exact<z.infer<typeof provenanceSchema>, Provenance>;
  derivedProductProvenance: Exact<
    z.infer<typeof derivedProductProvenanceSchema>,
    DerivedProductProvenance
  >;
  layerAvailability: Exact<z.infer<typeof layerAvailabilitySchema>, LayerAvailability>;
  analysisResult: Exact<z.infer<typeof analysisResultSchema>, AnalysisResult>;
  progressEvent: Exact<z.infer<typeof progressEventSchema>, ProgressEvent>;
  analysisJob: Exact<z.infer<typeof analysisJobSchema>, AnalysisJob>;
  legendEntry: Exact<z.infer<typeof legendEntrySchema>, LegendEntry>;
  overlayMetadata: Exact<z.infer<typeof overlayMetadataSchema>, OverlayMetadata>;
  coastalSummary: Exact<z.infer<typeof coastalSummarySchema>, CoastalSummary>;
  coastalResponse: Exact<z.infer<typeof coastalResponseSchema>, CoastalResponse>;
  presetsResponse: Exact<z.infer<typeof presetsResponseSchema>, PresetsResponse>;
  remoteSensingBand: Exact<z.infer<typeof remoteSensingBandSchema>, RemoteSensingBand>;
  remoteSensingAsset: Exact<z.infer<typeof remoteSensingAssetSchema>, RemoteSensingAsset>;
  remoteSensingTemporal: Exact<
    z.infer<typeof remoteSensingTemporalStateSchema>,
    RemoteSensingTemporalState
  >;
  remoteSensingPilot: Exact<
    z.infer<typeof remoteSensingPilotResultSchema>,
    RemoteSensingPilotResult
  >;
  remoteSensingSourceInfo: Exact<
    z.infer<typeof remoteSensingSourceInfoSchema>,
    RemoteSensingSourceInfo
  >;
  remoteSensingSources: Exact<
    z.infer<typeof remoteSensingSourcesResponseSchema>,
    RemoteSensingSourcesResponse
  >;
  landsatNdviSummary: Exact<z.infer<typeof landsatNdviSummarySchema>, LandsatNdviSummary>;
  landsatPilot: Exact<z.infer<typeof landsatPilotResultSchema>, LandsatPilotResult>;
};

export const CONTRACT_PARITY: ContractParity = {
  errorResponse: true,
  healthResponse: true,
  aoiInfo: true,
  topographySummary: true,
  topographyResult: true,
  vegetationSummary: true,
  vegetationResult: true,
  provenance: true,
  derivedProductProvenance: true,
  layerAvailability: true,
  analysisResult: true,
  progressEvent: true,
  analysisJob: true,
  legendEntry: true,
  overlayMetadata: true,
  coastalSummary: true,
  coastalResponse: true,
  presetsResponse: true,
  remoteSensingBand: true,
  remoteSensingAsset: true,
  remoteSensingTemporal: true,
  remoteSensingPilot: true,
  remoteSensingSourceInfo: true,
  remoteSensingSources: true,
  landsatNdviSummary: true,
  landsatPilot: true,
};
