/**
 * Las server functions del análisis: el único camino por el que el browser
 * habla con el motor.
 *
 * Nada de esto se ejecuta en el cliente. TanStack Start reemplaza cada
 * `createServerFn(...).handler(...)` por un RPC en el bundle del browser, así
 * que se puede importar este módulo desde un componente sin arrastrar
 * better-sqlite3 ni el token del servicio raster.
 *
 * Invariantes:
 * 1. **Toda lectura está scopeada al dueño.** `getAnalysisForUser` filtra por
 *    `user_id`; no existe (ni acá ni en `@territorio/db`) un accesor por id
 *    suelto. Un id adivinado devuelve `no-encontrado`, no el AOI de otro.
 * 2. **El guard de tamaño (§7.4) se aplica en el servidor**, antes de crear la
 *    fila y antes de tocar el servicio raster. El chequeo del cliente es una
 *    cortesía; éste es el que manda.
 * 3. **Los fallos esperados vuelven como unión discriminada**, no como
 *    excepción: "no estás autenticado", "el AOI no es válido", "el AOI es
 *    demasiado grande" y "no existe" son estados de UI, no errores 500.
 */
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { COASTAL_PRESETS, type CoastalPreset } from '@territorio/api-client';
import { AoiParseError, loadAoiFromGeoJson, type Aoi } from '@territorio/geo';

import {
  DEFAULT_ANALYSIS_PARAMS,
  decideAoiSize,
  parseStoredAnalysis,
  toSummary,
  type AnalysisParams,
  type AoiSizeVerdict,
  type CoastalRun,
  type TerritorioAnalysis,
  type TerritorioAnalysisSummary,
} from './analysis-contract';
import {
  attachCoastal,
  cancelRun,
  getRunSnapshot,
  startRun,
  type LiveRunSnapshot,
} from './analysis-runtime';
import { getRasterApi } from './api';
import { getAnalysisForUser, getDb, listAnalysesForUser } from './db';
import { fetchSession, type SessionUser } from './session';

/** Motivos de rechazo. Cerrados a propósito: cada uno tiene su pantalla. */
export type AnalysisRefusalReason =
  | 'no-autenticado'
  | 'aoi-invalido'
  | 'aoi-demasiado-grande'
  | 'no-encontrado'
  | 'no-listo'
  | 'servicio';

export type AnalysisRefusal = {
  ok: false;
  reason: AnalysisRefusalReason;
  /** Español, mostrable tal cual. */
  message: string;
  /** Sólo en `aoi-demasiado-grande`: qué ofrecerle al usuario (§7.4). */
  verdict?: AoiSizeVerdict;
  areaHa?: number;
};

export type StartAnalysisResult = { ok: true; analysisId: string } | AnalysisRefusal;

export type ReadAnalysisResult = { ok: true; analysis: TerritorioAnalysis } | AnalysisRefusal;

export type AnalysisProgressResult = { ok: true; run: LiveRunSnapshot } | AnalysisRefusal;

export type CoastalResult = { ok: true; coastal: CoastalRun } | AnalysisRefusal;

function refuse(
  reason: AnalysisRefusalReason,
  message: string,
  extra?: { verdict?: AoiSizeVerdict; areaHa?: number },
): AnalysisRefusal {
  return { ok: false, reason, message, ...extra };
}

const NOT_AUTHENTICATED = refuse(
  'no-autenticado',
  'Tenés que iniciar sesión para correr o ver un análisis.',
);

const NOT_FOUND = refuse('no-encontrado', 'No existe ese análisis, o no es tuyo.');

async function currentUser(): Promise<SessionUser | null> {
  return await fetchSession();
}

/*
  El GeoJSON entra como `unknown` a propósito: quien sabe validarlo es
  `@territorio/geo` (`loadAoiFromGeoJson`, que además une varias geometrías en
  una y calcula área, bbox y zona UTM). Repetir acá un esquema zod de GeoJSON
  sería una segunda definición de "polígono válido" con la que la primera se
  desincroniza.
*/
const startAnalysisSchema = z.object({
  aoi: z.unknown(),
  name: z.string().trim().max(120).optional(),
  /** 10 m por default; 20 m es la alternativa que ofrece el guard (§7.4). */
  ndviResolutionM: z.number().int().min(10).max(60).optional(),
  lookbackDays: z.number().int().min(30).max(730).optional(),
  maxCloudCover: z.number().int().min(0).max(100).optional(),
  /** El usuario apretó "Analizar igual" sobre un AOI de 500–2 000 ha. */
  confirmLargeAoi: z.boolean().optional(),
});

const analysisIdSchema = z.object({ analysisId: z.string().min(1).max(64) });

const coastalSchema = z.object({
  analysisId: z.string().min(1).max(64),
  preset: z.enum(COASTAL_PRESETS),
});

/** `AoiParseError` trae ya el mensaje en español mostrable (UC-03 / TC-04). */
function parseAoi(value: unknown): { ok: true; aoi: Aoi } | AnalysisRefusal {
  try {
    return { ok: true, aoi: loadAoiFromGeoJson(value) };
  } catch (error) {
    if (error instanceof AoiParseError) return refuse('aoi-invalido', error.message);
    return refuse(
      'aoi-invalido',
      'No se pudo leer el área de interés. Tiene que ser un polígono o un rectángulo.',
    );
  }
}

/**
 * Valida el AOI, aplica el guard de tamaño, crea la fila y lanza las dos
 * mitades del motor **en paralelo**. Vuelve enseguida con el id: el progreso se
 * sigue con `fetchAnalysisProgress` y el resultado con `fetchAnalysis`.
 */
export const startAnalysis = createServerFn({ method: 'POST' })
  .validator(startAnalysisSchema)
  .handler(async ({ data }): Promise<StartAnalysisResult> => {
    const user = await currentUser();
    if (user === null) return NOT_AUTHENTICATED;

    const parsed = parseAoi(data.aoi);
    if (!parsed.ok) return parsed;

    const requestedResolution = data.ndviResolutionM ?? DEFAULT_ANALYSIS_PARAMS.ndvi_resolution_m;
    const decision = decideAoiSize({
      areaHa: parsed.aoi.areaHa,
      ndviResolutionM: requestedResolution,
      confirmed: data.confirmLargeAoi ?? false,
    });

    if (!decision.allowed) {
      return refuse('aoi-demasiado-grande', decision.message, {
        verdict: decision.verdict,
        areaHa: parsed.aoi.areaHa,
      });
    }

    const params: AnalysisParams = {
      ndvi_resolution_m: decision.ndviResolutionM,
      lookback_days: data.lookbackDays ?? DEFAULT_ANALYSIS_PARAMS.lookback_days,
      max_cloud_cover: data.maxCloudCover ?? DEFAULT_ANALYSIS_PARAMS.max_cloud_cover,
    };

    const { analysisId } = await startRun({
      userId: user.id,
      aoi: parsed.aoi,
      params,
      name: data.name ?? null,
    });

    return { ok: true, analysisId };
  });

/**
 * Foto del progreso vivo. Barata: no toca la base ni el servicio raster, sólo
 * lee el `Map` del proceso que alimenta el SSE.
 *
 * `no-listo` significa "esta instancia no tiene la corrida en memoria" — o
 * terminó hace rato, o la lanzó otro proceso. El llamador cae a `fetchAnalysis`,
 * que lee de la base.
 */
export const fetchAnalysisProgress = createServerFn({ method: 'GET' })
  .validator(analysisIdSchema)
  .handler(async ({ data }): Promise<AnalysisProgressResult> => {
    const user = await currentUser();
    if (user === null) return NOT_AUTHENTICATED;

    const run = getRunSnapshot(data.analysisId, user.id);
    if (run === null) {
      return refuse('no-listo', 'No hay una corrida en curso para ese análisis.');
    }
    return { ok: true, run };
  });

export const cancelAnalysis = createServerFn({ method: 'POST' })
  .validator(analysisIdSchema)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const user = await currentUser();
    if (user === null) return { ok: false };
    return { ok: cancelRun(data.analysisId, user.id) };
  });

async function readOwned(
  analysisId: string,
  userId: string,
): Promise<{ ok: true; analysis: TerritorioAnalysis } | AnalysisRefusal> {
  const row = await getAnalysisForUser(getDb(), { id: analysisId, userId });
  if (row === undefined) return NOT_FOUND;

  const analysis = parseStoredAnalysis(row.resultJson);
  if (analysis === null) {
    if (row.status === 'pending' || row.status === 'running') {
      return refuse('no-listo', 'El análisis todavía está corriendo.');
    }
    return refuse(
      'servicio',
      row.errorMessage ??
        'El resultado guardado no se puede leer con el contrato actual. Volvé a analizar la zona.',
    );
  }

  return { ok: true, analysis };
}

/**
 * El análisis completo, con geometrías. Es lo que consumen el mapa y las
 * descargas. Scopeado al dueño: un id de otra persona da `no-encontrado`.
 */
export const fetchAnalysis = createServerFn({ method: 'GET' })
  .validator(analysisIdSchema)
  .handler(async ({ data }): Promise<ReadAnalysisResult> => {
    const user = await currentUser();
    if (user === null) return NOT_AUTHENTICATED;
    return await readOwned(data.analysisId, user.id);
  });

/**
 * Lo mismo sin geometrías. Es lo que necesita `/reporte/$analysisId`, y evita
 * mandarle al SSR unos cuantos MB de polígonos MEPyD que la narrativa no usa.
 */
export const fetchAnalysisSummary = createServerFn({ method: 'GET' })
  .validator(analysisIdSchema)
  .handler(
    async ({
      data,
    }): Promise<{ ok: true; analysis: TerritorioAnalysisSummary } | AnalysisRefusal> => {
      const user = await currentUser();
      if (user === null) return NOT_AUTHENTICATED;

      const result = await readOwned(data.analysisId, user.id);
      if (!result.ok) return result;
      return { ok: true, analysis: toSummary(result.analysis) };
    },
  );

export type AnalysisListItem = {
  id: string;
  name: string | null;
  areaHa: number | null;
  status: TerritorioAnalysis['status'];
  createdAt: string;
};

/** "Mis análisis", más nuevo primero. */
export const listAnalyses = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AnalysisListItem[]> => {
    const user = await currentUser();
    if (user === null) return [];

    const rows = await listAnalysesForUser(getDb(), { userId: user.id });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      areaHa: row.areaHa,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    }));
  },
);

/**
 * Pide (o reusa de caché) la inundación costera de un análisis y **la adjunta
 * al resultado persistido**.
 *
 * Lo segundo es el arreglo de un hueco real del legacy: la capa costera vivía
 * sólo en `session_state`, así que el usuario la veía en el mapa y no aparecía
 * en el reporte (inventario §9). Acá pasa a ser parte del artefacto.
 *
 * WRI caído NO es un error de esta función: vuelve `available: false` con el
 * motivo, igual que cualquier otra fuente (regresión #3).
 */
export const requestCoastal = createServerFn({ method: 'POST' })
  .validator(coastalSchema)
  .handler(async ({ data }): Promise<CoastalResult> => {
    const user = await currentUser();
    if (user === null) return NOT_AUTHENTICATED;

    const existing = await readOwned(data.analysisId, user.id);
    if (!existing.ok) return existing;

    /*
      Si el job raster existe, se manda su id y el servicio toma el AOI de ahí:
      la clave de caché `(AOI, preset)` sale idéntica a la que ya calculó y una
      segunda consulta del mismo escenario no vuelve a leer el GeoTIFF global de
      WRI (UC-25 / TC-31). Sin job raster, va la geometría.
    */
    const api = getRasterApi();
    const rasterJobId = existing.analysis.raster_job_id;
    const response = await api.computeCoastal(
      rasterJobId === null
        ? { preset: data.preset, aoi: existing.analysis.aoi_geometry }
        : { preset: data.preset, analysis_id: rasterJobId },
    );

    if (!response.ok) {
      const coastal: CoastalRun = {
        preset: data.preset,
        cache_key: '',
        available: false,
        error: response.message,
        summary: null,
        overlay_url: null,
        raster_url: null,
      };
      return { ok: true, coastal };
    }

    const body = response.data;
    const coastal: CoastalRun = {
      preset: body.preset,
      cache_key: body.cache_key,
      available: body.available,
      error: body.error ?? null,
      summary: body.summary ?? null,
      /*
        RELATIVAS, no `api.absoluteUrl(...)`: eso pegaba la base INTERNA del
        servicio raster (`API_URL`, ej. `http://api:8787` en compose), que el
        browser no puede resolver ni con token ni sin él. Igual que
        `entry.overlay_url` de cada capa, `resolveOverlayUrl()` en
        `~/components/map/overlays.ts` antepone la base pública (el proxy de
        `~/routes/api/raster.coastal.*`, ver `~/components/map/raster-base.ts`)
        recién cuando el mapa arma la URL que le da al browser.
      */
      overlay_url: body.overlay_url ?? null,
      raster_url: body.raster_url ?? null,
    };

    await attachCoastal({
      analysisId: data.analysisId,
      userId: user.id,
      analysis: existing.analysis,
      coastal,
    });

    return { ok: true, coastal };
  });

/** Los 5 presets exactos del selectbox legacy, servidos por el motor. */
export const fetchCoastalPresets = createServerFn({ method: 'GET' }).handler(
  async (): Promise<CoastalPreset[]> => {
    const result = await getRasterApi().getCoastalPresets();
    // El orden lo define el servicio; si está caído, el contrato local alcanza.
    return result.ok ? (result.data.presets as CoastalPreset[]) : [...COASTAL_PRESETS];
  },
);
