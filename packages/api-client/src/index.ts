/**
 * `@territorio/api-client` — el contrato tipado con el servicio raster
 * (`services/api`, FastAPI + odc-stac).
 *
 * Tres capas, en este orden:
 *
 *   1. `generated/schema.ts` — tipos derivados del `/openapi.json` REAL del
 *      servicio. No se editan a mano. Se regeneran con
 *      `pnpm --filter @territorio/api-client generate`, que además versiona el
 *      snapshot del esquema en `openapi/openapi.json`.
 *   2. `schemas.ts` — validación zod en el borde HTTP, con una prueba de tipo
 *      (`CONTRACT_PARITY`) que impide que el zod se desincronice del generado.
 *   3. `client.ts` / `sse.ts` — el cliente, con resultados como unión
 *      discriminada y el stream de progreso en español.
 *
 * Lo que este paquete NO hace: nada vectorial (eso es `@territorio/geo`), nada
 * de persistencia (eso es `@territorio/db`) y nada de mezcla raster+vector (eso
 * es `apps/web/src/lib/analysis-*`).
 */

export type {
  components,
  operations,
  paths,
  SchemaAnalysisJob,
  SchemaAnalysisRequest,
  SchemaAnalysisResult,
  SchemaAoiGeometry,
  SchemaAoiInfo,
  SchemaCoastalRequest,
  SchemaCoastalResponse,
  SchemaCoastalSummary,
  SchemaErrorResponse,
  SchemaHealthResponse,
  SchemaLayerAvailability,
  SchemaLegendEntry,
  SchemaOverlayMetadata,
  SchemaPresetsResponse,
  SchemaProgressEvent,
  SchemaProvenance,
  SchemaTopographyResult,
  SchemaTopographySummary,
  SchemaVegetationResult,
  SchemaVegetationSummary,
} from './generated/schema.ts';

export {
  ApiError,
  fail,
  isFailure,
  isOk,
  isRetryable,
  mapResult,
  ok,
  unwrapOr,
  unwrapOrThrow,
  type ApiFailure,
  type ApiFailureKind,
  type ApiResult,
  type ApiSuccess,
} from './result.ts';

export {
  analysisJobSchema,
  analysisResultSchema,
  ANALYSIS_STATUSES,
  aoiInfoSchema,
  coastalResponseSchema,
  coastalSummarySchema,
  COASTAL_PRESETS,
  CONTRACT_PARITY,
  errorResponseSchema,
  healthResponseSchema,
  layerAvailabilitySchema,
  legendEntrySchema,
  overlayMetadataSchema,
  presetsResponseSchema,
  progressEventSchema,
  provenanceSchema,
  RASTER_LAYERS,
  topographyResultSchema,
  topographySummarySchema,
  vegetationResultSchema,
  vegetationSummarySchema,
  type AnalysisJob,
  type AnalysisResult,
  type AnalysisStatus,
  type AoiInfo,
  type CoastalPreset,
  type CoastalResponse,
  type CoastalSummary,
  type ContractParity,
  type ErrorResponse,
  type HealthResponse,
  type LayerAvailability,
  type LegendEntry,
  type OverlayMetadata,
  type PresetsResponse,
  type ProgressEvent,
  type Provenance,
  type RasterLayer,
  type TopographyResult,
  type TopographySummary,
  type VegetationResult,
  type VegetationSummary,
} from './schemas.ts';

export {
  createSseParser,
  decodeFrame,
  isTerminalStreamEvent,
  streamAnalysisEvents,
  type AnalysisProgress,
  type AnalysisStreamEvent,
  type SseFetch,
  type SseFrame,
  type StreamAnalysisEventsOptions,
} from './sse.ts';

export {
  createRasterApiClient,
  type AoiGeometryInput,
  type CoastalInput,
  type CreateAnalysisInput,
  type FetchLike,
  type OverlayImage,
  type OverlayParams,
  type RasterApiClient,
  type RasterApiClientOptions,
} from './client.ts';
