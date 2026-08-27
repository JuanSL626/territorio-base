/**
 * Cliente tipado del servicio raster (`services/api`).
 *
 * Reglas de la casa:
 *
 * - **Todo fallo esperado vuelve como `ApiResult`**, nunca como excepción. Un
 *   404, un 422 de AOI inválido o un WRI caído son parte del dominio: la UI los
 *   pinta. Lo único que lanza son los bugs del programador (un `baseUrl` vacío).
 * - **Todo cuerpo 2xx se valida con zod antes de devolverse.** El tipo generado
 *   describe lo que el servicio *promete*; el zod verifica lo que *mandó*. Un
 *   deploy viejo o un proxy que devuelve HTML se convierten en
 *   `kind: 'contrato'` con las rutas de los campos que no validaron, en vez de
 *   un `undefined` tres capas más abajo.
 * - **Las URLs relativas del servicio se absolutizan acá.** El servicio devuelve
 *   `/analysis/{id}/overlay/dem.png`; el mapa necesita una URL que el browser
 *   pueda pedir. `absoluteUrl()` es el único lugar donde se pega la base.
 */

import { fail, ok, type ApiFailure, type ApiFailureKind, type ApiResult } from './result.ts';
import {
  analysisJobSchema,
  coastalResponseSchema,
  healthResponseSchema,
  overlayMetadataSchema,
  presetsResponseSchema,
  type AnalysisJob,
  type CoastalPreset,
  type CoastalResponse,
  type HealthResponse,
  type OverlayMetadata,
  type PresetsResponse,
  type RasterLayer,
} from './schemas.ts';
import {
  streamAnalysisEvents,
  type AnalysisStreamEvent,
  type SseFetch,
  type StreamAnalysisEventsOptions,
} from './sse.ts';

import type { SchemaAoiGeometry } from './generated/schema.ts';
import type { z } from 'zod';

/* -------------------------------------------------------------------------- */
/* Tipos de entrada                                                            */
/* -------------------------------------------------------------------------- */

/** GeoJSON del AOI: `Geometry`, `Feature` o `FeatureCollection`. */
export type AoiGeometryInput = SchemaAoiGeometry;

export type CreateAnalysisInput = {
  aoi: AoiGeometryInput;
  /** Resolución del compuesto Sentinel-2. 20 m para AOIs grandes (§7.4). */
  ndvi_resolution_m?: number;
  lookback_days?: number;
  max_cloud_cover?: number;
};

export type CoastalInput = {
  preset: CoastalPreset;
  /** Si viene, el AOI sale del análisis y el resultado se le adjunta. */
  analysis_id?: string;
  /** Requerido si no hay `analysis_id`. */
  aoi?: AoiGeometryInput;
};

/** Overrides de la rampa de color. Los defaults por capa los pone el servicio. */
export type OverlayParams = {
  /** Alfa 0–1. */
  opacity?: number;
  vmin?: number;
  vmax?: number;
};

/** El PNG del overlay más lo que MapLibre necesita para ubicarlo. */
export type OverlayImage = {
  layer: RasterLayer;
  bytes: Uint8Array;
  /** `[west, south, east, north]`, del header `X-Bounds`. */
  bounds: [number, number, number, number];
  /** Las 4 esquinas en el orden de `ImageSource`: TL, TR, BR, BL. */
  coordinates: number[][];
  /** URL absoluta del sidecar JSON con la leyenda. */
  metadataUrl: string | null;
};

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type RasterApiClientOptions = {
  /** Base del servicio. Ej. `http://localhost:8787`. */
  baseUrl: string;
  /** `TERRITORIO_API_TOKEN`. Sólo lo tiene el servidor. */
  token?: string | undefined;
  /** Timeout por request, en ms. Default 30 s. El análisis es asíncrono, así
   *  que ningún request de esta clase debería tardar más. */
  timeoutMs?: number | undefined;
  fetchImpl?: FetchLike | undefined;
};

const DEFAULT_TIMEOUT_MS = 30_000;

/* -------------------------------------------------------------------------- */
/* Normalización de fallos                                                     */
/* -------------------------------------------------------------------------- */

const STATUS_MESSAGES: Record<number, string> = {
  401: 'El servicio de análisis rechazó las credenciales (API_TOKEN).',
  403: 'El servicio de análisis rechazó las credenciales (API_TOKEN).',
  404: 'El recurso pedido no existe en el servicio de análisis.',
  409: 'El recurso todavía no está listo.',
  422: 'El área de interés no es válida para el servicio de análisis.',
};

function failureKindFor(status: number): ApiFailureKind {
  if (status === 401 || status === 403) return 'no-autorizado';
  if (status === 404) return 'no-encontrado';
  if (status === 409) return 'no-listo';
  if (status === 422) return 'aoi-invalido';
  return 'servicio';
}

/** FastAPI manda `{detail: string}` o, en 422, `{detail: ValidationError[]}`. */
function detailFrom(body: unknown, fallbackMessage: string): string {
  if (typeof body !== 'object' || body === null) return fallbackMessage;
  const detail: unknown = (body as Record<string, unknown>).detail;
  if (typeof detail === 'string' && detail.length > 0) return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((issue: unknown) => {
        if (typeof issue !== 'object' || issue === null) return '';
        const message: unknown = (issue as Record<string, unknown>).msg;
        return typeof message === 'string' ? message : '';
      })
      .filter((message) => message.length > 0);
    if (messages.length > 0) return messages.join('; ');
  }
  return fallbackMessage;
}

function issuePaths(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`);
}

function transportFailure(error: unknown, url: string, timeoutMs: number): ApiFailure {
  if (error instanceof Error && error.name === 'AbortError') {
    return fail({ kind: 'cancelado', url, cause: error, message: 'La consulta se canceló.' });
  }
  if (error instanceof Error && error.name === 'TimeoutError') {
    return fail({
      kind: 'timeout',
      url,
      cause: error,
      message: `El servicio de análisis no respondió en ${Math.round(timeoutMs / 1000)} s.`,
    });
  }
  return fail({
    kind: 'red',
    url,
    cause: error,
    message: 'No se pudo contactar el servicio de análisis.',
  });
}

/* -------------------------------------------------------------------------- */
/* Cliente                                                                     */
/* -------------------------------------------------------------------------- */

export type RasterApiClient = ReturnType<typeof createRasterApiClient>;

export function createRasterApiClient(options: RasterApiClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  if (baseUrl === '') {
    // Error de programación, no del dominio: se lanza.
    throw new Error('createRasterApiClient: `baseUrl` no puede estar vacío.');
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch: FetchLike = options.fetchImpl ?? (async (input, init) => await fetch(input, init));

  function authHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (options.token !== undefined && options.token !== '') {
      headers.authorization = `Bearer ${options.token}`;
    }
    return headers;
  }

  /** Convierte una URL relativa del servicio en una absoluta y pedible. */
  function absoluteUrl(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    return `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  function withQuery(path: string, params: OverlayParams | undefined): string {
    if (params === undefined) return path;
    const query = new URLSearchParams();
    if (params.opacity !== undefined) query.set('opacity', String(params.opacity));
    if (params.vmin !== undefined) query.set('vmin', String(params.vmin));
    if (params.vmax !== undefined) query.set('vmax', String(params.vmax));
    const suffix = query.toString();
    return suffix === '' ? path : `${path}?${suffix}`;
  }

  async function rawRequest(
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal | undefined },
    accept: string,
  ): Promise<{ ok: true; response: Response; url: string } | ApiFailure> {
    const url = absoluteUrl(path);
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init.signal === undefined ? timeout : AbortSignal.any([init.signal, timeout]);

    try {
      const response = await doFetch(url, {
        method: init.method,
        headers: authHeaders(
          init.body === undefined ? { accept } : { accept, 'content-type': 'application/json' },
        ),
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal,
      });
      return { ok: true, response, url };
    } catch (error) {
      return transportFailure(error, url, timeoutMs);
    }
  }

  async function requestJson<T>(
    path: string,
    schema: z.ZodType<T>,
    init: { method: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal | undefined },
  ): Promise<ApiResult<T>> {
    const attempt = await rawRequest(path, init, 'application/json');
    if (!attempt.ok) return attempt;

    const { response, url } = attempt;
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      if (!response.ok) {
        return fail({
          kind: failureKindFor(response.status),
          status: response.status,
          url,
          message: STATUS_MESSAGES[response.status] ?? `El servicio respondió ${response.status}.`,
        });
      }
      return fail({
        kind: 'contrato',
        status: response.status,
        url,
        cause: error,
        message: 'El servicio de análisis respondió algo que no es JSON.',
      });
    }

    if (!response.ok) {
      return fail({
        kind: failureKindFor(response.status),
        status: response.status,
        url,
        message: detailFrom(
          payload,
          STATUS_MESSAGES[response.status] ?? `El servicio respondió ${response.status}.`,
        ),
      });
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      return fail({
        kind: 'contrato',
        status: response.status,
        url,
        issues: issuePaths(parsed.error),
        cause: parsed.error,
        message:
          'La respuesta del servicio de análisis no coincide con el contrato. ' +
          'Puede ser un servicio desactualizado: regenerá el cliente con ' +
          '`pnpm --filter @territorio/api-client generate`.',
      });
    }

    return ok(parsed.data);
  }

  function parseBoundsHeader(value: string | null): [number, number, number, number] | null {
    if (value === null) return null;
    try {
      const parsed: unknown = JSON.parse(value);
      if (!Array.isArray(parsed) || parsed.length !== 4) return null;
      const numbers = parsed.map((entry: unknown) => Number(entry));
      if (numbers.some((entry) => !Number.isFinite(entry))) return null;
      return numbers as [number, number, number, number];
    } catch {
      return null;
    }
  }

  function parseCoordinatesHeader(value: string | null): number[][] {
    if (value === null) return [];
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as number[][]) : [];
    } catch {
      return [];
    }
  }

  return {
    /** Base normalizada, sin barra final. */
    baseUrl,

    absoluteUrl,

    /* -- salud ------------------------------------------------------------ */

    async health(signal?: AbortSignal): Promise<ApiResult<HealthResponse>> {
      return await requestJson('/healthz', healthResponseSchema, { method: 'GET', signal });
    },

    /* -- análisis --------------------------------------------------------- */

    /** `POST /analysis` → 202 con el job. NO espera a que termine. */
    async createAnalysis(
      input: CreateAnalysisInput,
      signal?: AbortSignal,
    ): Promise<ApiResult<AnalysisJob>> {
      return await requestJson('/analysis', analysisJobSchema, {
        method: 'POST',
        body: {
          aoi: input.aoi,
          ndvi_resolution_m: input.ndvi_resolution_m ?? 10,
          lookback_days: input.lookback_days ?? 180,
          max_cloud_cover: input.max_cloud_cover ?? 30,
        },
        signal,
      });
    },

    async getAnalysis(analysisId: string, signal?: AbortSignal): Promise<ApiResult<AnalysisJob>> {
      return await requestJson(`/analysis/${encodeURIComponent(analysisId)}`, analysisJobSchema, {
        method: 'GET',
        signal,
      });
    },

    /**
     * Progreso por SSE. Ver `./sse.ts` — reconecta, deduplica el replay y
     * suelta el socket al cerrar el `for await`.
     */
    streamAnalysisEvents(
      analysisId: string,
      streamOptions: Omit<
        StreamAnalysisEventsOptions,
        'baseUrl' | 'analysisId' | 'token' | 'fetchImpl'
      > & { fetchImpl?: SseFetch | undefined } = {},
    ): AsyncGenerator<AnalysisStreamEvent> {
      return streamAnalysisEvents({
        ...streamOptions,
        baseUrl,
        analysisId,
        token: options.token,
      });
    },

    /* -- capas ------------------------------------------------------------ */

    /** URL absoluta del PNG. Se le puede pasar directo a MapLibre. */
    overlayUrl(analysisId: string, layer: RasterLayer, params?: OverlayParams): string {
      return absoluteUrl(
        withQuery(`/analysis/${encodeURIComponent(analysisId)}/overlay/${layer}.png`, params),
      );
    },

    /** URL absoluta del GeoTIFF recortado al AOI. */
    rasterUrl(analysisId: string, layer: RasterLayer): string {
      return absoluteUrl(`/analysis/${encodeURIComponent(analysisId)}/raster/${layer}.tif`);
    },

    /** Sidecar JSON del overlay: bounds, rampa y leyenda. */
    async getOverlayMetadata(
      analysisId: string,
      layer: RasterLayer,
      params?: OverlayParams,
      signal?: AbortSignal,
    ): Promise<ApiResult<OverlayMetadata>> {
      return await requestJson(
        withQuery(`/analysis/${encodeURIComponent(analysisId)}/overlay/${layer}.json`, params),
        overlayMetadataSchema,
        { method: 'GET', signal },
      );
    },

    /**
     * El PNG con sus bounds, leyendo `X-Bounds` / `X-Overlay-Coordinates`.
     *
     * Regresión #1 del inventario (rasters espejados norte-sur): los bounds son
     * los del servicio y las esquinas vienen ya ordenadas para `ImageSource`
     * (TL, TR, BR, BL). No reordenar ni voltear nada acá.
     */
    async getOverlayImage(
      analysisId: string,
      layer: RasterLayer,
      params?: OverlayParams,
      signal?: AbortSignal,
    ): Promise<ApiResult<OverlayImage>> {
      const path = withQuery(
        `/analysis/${encodeURIComponent(analysisId)}/overlay/${layer}.png`,
        params,
      );
      const attempt = await rawRequest(path, { method: 'GET', signal }, 'image/png');
      if (!attempt.ok) return attempt;

      const { response, url } = attempt;
      if (!response.ok) {
        return fail({
          kind: failureKindFor(response.status),
          status: response.status,
          url,
          message: STATUS_MESSAGES[response.status] ?? `El servicio respondió ${response.status}.`,
        });
      }

      const bounds = parseBoundsHeader(response.headers.get('x-bounds'));
      if (bounds === null) {
        return fail({
          kind: 'contrato',
          status: response.status,
          url,
          message: 'El overlay llegó sin el header X-Bounds: no se puede ubicar en el mapa.',
        });
      }

      const metadataUrlHeader = response.headers.get('x-overlay-metadata-url');

      return ok({
        layer,
        bytes: new Uint8Array(await response.arrayBuffer()),
        bounds,
        coordinates: parseCoordinatesHeader(response.headers.get('x-overlay-coordinates')),
        metadataUrl: metadataUrlHeader === null ? null : absoluteUrl(metadataUrlHeader),
      });
    },

    /* -- inundación costera ----------------------------------------------- */

    async getCoastalPresets(signal?: AbortSignal): Promise<ApiResult<PresetsResponse>> {
      return await requestJson('/coastal/presets', presetsResponseSchema, {
        method: 'GET',
        signal,
      });
    },

    /** `POST /coastal`. Cacheado por `(AOI, preset)` del lado del servicio. */
    async computeCoastal(
      input: CoastalInput,
      signal?: AbortSignal,
    ): Promise<ApiResult<CoastalResponse>> {
      return await requestJson('/coastal', coastalResponseSchema, {
        method: 'POST',
        body: input,
        signal,
      });
    },

    coastalOverlayUrl(cacheKey: string, params?: OverlayParams): string {
      return absoluteUrl(withQuery(`/coastal/${encodeURIComponent(cacheKey)}/overlay.png`, params));
    },

    coastalRasterUrl(cacheKey: string): string {
      return absoluteUrl(`/coastal/${encodeURIComponent(cacheKey)}/raster.tif`);
    },

    async getCoastalOverlayMetadata(
      cacheKey: string,
      params?: OverlayParams,
      signal?: AbortSignal,
    ): Promise<ApiResult<OverlayMetadata>> {
      return await requestJson(
        withQuery(`/coastal/${encodeURIComponent(cacheKey)}/overlay.json`, params),
        overlayMetadataSchema,
        { method: 'GET', signal },
      );
    },
  };
}
