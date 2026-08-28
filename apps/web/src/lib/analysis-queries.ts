/**
 * TanStack Query para todo el flujo del análisis: lanzar, seguir el progreso,
 * leer el resultado y pedir la inundación costera.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CLAVES
 * ─────────────────────────────────────────────────────────────────────────────
 * Todas cuelgan de `['analisis', …]` y van de lo general a lo específico, así
 * que invalidar es obvio y no hace falta acordarse de nada:
 *
 *   analysisKeys.all                  → todo
 *   analysisKeys.lists()              → la lista "mis análisis"
 *   analysisKeys.details()            → todos los resultados
 *   analysisKeys.detail(id)           → uno
 *   analysisKeys.progress(id)         → el progreso vivo de uno
 *   analysisKeys.coastal(id, preset)  → un escenario costero de uno
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SSR
 * ─────────────────────────────────────────────────────────────────────────────
 * Las *queryOptions* se exportan sueltas para que un `loader` de ruta haga
 * `queryClient.ensureQueryData(analysisQueryOptions(id))`: el resultado se
 * resuelve en el servidor, viaja dentro del payload deshidratado del router
 * (ver `~/router.tsx`) y el componente lo encuentra caliente en la primera
 * pintada — sin spinner y sin un segundo round trip.
 *
 * El progreso es la excepción: `staleTime: 0` y polling. No tiene sentido
 * hidratarlo, porque para cuando el HTML llega ya cambió.
 */
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import {
  cancelAnalysis,
  fetchAnalysis,
  fetchAnalysisProgress,
  fetchAnalysisSummary,
  fetchCoastalPresets,
  listAnalyses,
  requestCoastal,
  startAnalysis,
  type AnalysisListItem,
  type AnalysisProgressResult,
  type AnalysisRefusal,
  type CoastalResult,
  type ReadAnalysisResult,
  type StartAnalysisResult,
} from './analysis-server';

import type { TerritorioAnalysis, TerritorioAnalysisSummary } from './analysis-contract';
import type { LiveRunSnapshot } from './analysis-runtime';
import type { CoastalPreset } from '@territorio/api-client';

/* -------------------------------------------------------------------------- */
/* Claves                                                                      */
/* -------------------------------------------------------------------------- */

export const analysisKeys = {
  all: ['analisis'] as const,
  lists: () => [...analysisKeys.all, 'lista'] as const,
  details: () => [...analysisKeys.all, 'detalle'] as const,
  detail: (analysisId: string) => [...analysisKeys.details(), analysisId] as const,
  summaries: () => [...analysisKeys.all, 'resumen'] as const,
  summary: (analysisId: string) => [...analysisKeys.summaries(), analysisId] as const,
  progress: (analysisId: string) => [...analysisKeys.all, 'progreso', analysisId] as const,
  coastals: () => [...analysisKeys.all, 'costera'] as const,
  coastal: (analysisId: string, preset: CoastalPreset) =>
    [...analysisKeys.coastals(), analysisId, preset] as const,
  coastalPresets: () => [...analysisKeys.all, 'costera-presets'] as const,
};

/* -------------------------------------------------------------------------- */
/* Tiempos                                                                     */
/* -------------------------------------------------------------------------- */

/*
  Un análisis terminado es INMUTABLE (salvo que se le adjunte la capa costera,
  que invalida su clave a mano). Por eso el resultado vive mucho: refetchearlo
  sería releer varios MB de SQLite para obtener exactamente lo mismo.
*/
const RESULT_STALE_MS = 5 * 60_000;
const RESULT_GC_MS = 30 * 60_000;

/** Cadencia del progreso. El pipeline raster emite 4 pasos en 10–90 s. */
const PROGRESS_POLL_MS = 1_000;

/**
 * Cadencia del RESULTADO mientras el análisis todavía corre.
 *
 * `startAnalysis` vuelve en ~120 ms con el id y deja el pipeline corriendo de
 * fondo, así que la primera lectura del resultado casi siempre pega en
 * `no-listo`. Sin este intervalo esa respuesta se quedaba cacheada
 * `RESULT_STALE_MS` (5 min) y el análisis terminado NUNCA llegaba a la
 * pantalla: la única forma de verlo era recargar a mano.
 *
 * `useAnalysisProgress` también invalida el detalle al terminar, pero eso sólo
 * funciona mientras la corrida viva EN ESTE proceso (ver `analysis-runtime`).
 * Este poll es el que hace que el resultado aparezca igual tras un reinicio
 * del server, en una segunda instancia, o en una pestaña abierta después.
 */
const RESULT_POLL_MS = 1_500;

/**
 * `no-listo` es el único rechazo transitorio: significa "todavía está
 * corriendo". Todos los demás (`no-encontrado`, `no-autenticado`, `servicio`)
 * son terminales — insistir sobre ellos sólo genera tráfico.
 */
function pollWhileNotReady(result: { ok: true } | AnalysisRefusal | undefined): number | false {
  if (result === undefined) return false;
  return !result.ok && result.reason === 'no-listo' ? RESULT_POLL_MS : false;
}

/* -------------------------------------------------------------------------- */
/* Options                                                                     */
/* -------------------------------------------------------------------------- */

export function analysisQueryOptions(analysisId: string) {
  return queryOptions({
    queryKey: analysisKeys.detail(analysisId),
    queryFn: async (): Promise<ReadAnalysisResult> => await fetchAnalysis({ data: { analysisId } }),
    staleTime: RESULT_STALE_MS,
    gcTime: RESULT_GC_MS,
    // `refetchInterval` ignora `staleTime`: es lo que despega la lectura del
    // resultado de la caché de 5 minutos mientras el pipeline sigue corriendo.
    refetchInterval: (query) => pollWhileNotReady(query.state.data),
  });
}

export function analysisSummaryQueryOptions(analysisId: string) {
  return queryOptions({
    queryKey: analysisKeys.summary(analysisId),
    queryFn: async (): Promise<
      { ok: true; analysis: TerritorioAnalysisSummary } | AnalysisRefusal
    > => await fetchAnalysisSummary({ data: { analysisId } }),
    staleTime: RESULT_STALE_MS,
    gcTime: RESULT_GC_MS,
    refetchInterval: (query) => pollWhileNotReady(query.state.data),
  });
}

export function analysesListQueryOptions() {
  return queryOptions({
    queryKey: analysisKeys.lists(),
    queryFn: async (): Promise<AnalysisListItem[]> => await listAnalyses(),
    staleTime: 30_000,
  });
}

export function coastalPresetsQueryOptions() {
  return queryOptions({
    queryKey: analysisKeys.coastalPresets(),
    queryFn: async (): Promise<CoastalPreset[]> => await fetchCoastalPresets(),
    // Los 5 presets son constantes del contrato: no cambian dentro de una sesión.
    staleTime: Infinity,
  });
}

/**
 * Progreso vivo.
 *
 * `no-listo` no es un error: significa que esta instancia ya no tiene la
 * corrida en memoria (terminó, o la lanzó otro proceso). El polling se corta y
 * el consumidor pasa a leer el resultado de la base.
 */
export function analysisProgressQueryOptions(analysisId: string, enabled: boolean) {
  return queryOptions({
    queryKey: analysisKeys.progress(analysisId),
    queryFn: async (): Promise<AnalysisProgressResult> =>
      await fetchAnalysisProgress({ data: { analysisId } }),
    enabled,
    staleTime: 0,
    gcTime: 60_000,
    // Nunca reintentar: si la corrida no está, no va a aparecer por insistir.
    retry: false,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data === undefined) return PROGRESS_POLL_MS;
      if (!data.ok) return false;
      return data.run.finished ? false : PROGRESS_POLL_MS;
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Hooks de lectura                                                            */
/* -------------------------------------------------------------------------- */

export function useAnalysis(analysisId: string): UseQueryResult<ReadAnalysisResult> {
  return useQuery(analysisQueryOptions(analysisId));
}

export function useAnalysisSummary(
  analysisId: string,
): UseQueryResult<{ ok: true; analysis: TerritorioAnalysisSummary } | AnalysisRefusal> {
  return useQuery(analysisSummaryQueryOptions(analysisId));
}

export function useAnalysesList(): UseQueryResult<AnalysisListItem[]> {
  return useQuery(analysesListQueryOptions());
}

export function useCoastalPresets(): UseQueryResult<CoastalPreset[]> {
  return useQuery(coastalPresetsQueryOptions());
}

/**
 * Sigue el progreso y, **en cuanto termina, invalida el resultado**.
 *
 * Ese encadenado es la razón de que el hook exista en vez de dejar el
 * `useQuery` suelto: sin él, el panel se quedaría con "Análisis completo" y una
 * tarjeta vacía hasta que alguien refresque.
 */
export function useAnalysisProgress(
  analysisId: string | undefined,
  options: { enabled?: boolean } = {},
): UseQueryResult<AnalysisProgressResult> {
  const queryClient = useQueryClient();
  const enabled = (options.enabled ?? true) && analysisId !== undefined;
  const query = useQuery(analysisProgressQueryOptions(analysisId ?? '', enabled));

  const finished = query.data?.ok === true && query.data.run.finished;

  useEffect(() => {
    if (!finished || analysisId === undefined) return;
    void queryClient.invalidateQueries({ queryKey: analysisKeys.detail(analysisId) });
    void queryClient.invalidateQueries({ queryKey: analysisKeys.summary(analysisId) });
    void queryClient.invalidateQueries({ queryKey: analysisKeys.lists() });
  }, [finished, analysisId, queryClient]);

  return query;
}

/* -------------------------------------------------------------------------- */
/* El flujo completo: lanzar → seguir → resultado                              */
/* -------------------------------------------------------------------------- */

/** Las cuatro pantallas que puede mostrar la pestaña ANÁLISIS (§8). */
export type AnalysisPhase = 'sin-aoi' | 'analizando' | 'listo' | 'error';

export type AnalysisFlow = {
  phase: AnalysisPhase;
  /** El resultado, sólo en `listo`. */
  analysis: TerritorioAnalysis | null;
  /** Foto del progreso vivo, o `null` si esta instancia no tiene la corrida. */
  run: LiveRunSnapshot | null;
  /** Cronómetro del §8. Del snapshot vivo cuando existe; local si no. */
  elapsedMs: number;
  /** Mensaje del estado `error`, listo para mostrar. */
  errorMessage: string | null;
  /** Reintenta la lectura del resultado (botón «Reintentar»). */
  retry: () => void;
  /** «Cancelar análisis». */
  cancel: () => void;
  canceling: boolean;
};

/**
 * TODO el ciclo de vida de un análisis en un solo hook.
 *
 * Existe porque el cableado tiene un orden que no se puede improvisar en la
 * ruta y que, mal hecho, deja la pantalla colgada en "analizando" para siempre
 * (que es exactamente lo que pasaba):
 *
 *   1. El resultado se lee siempre; mientras vuelva `no-listo` se repolea solo
 *      (`analysisQueryOptions`). Ésa es la red de seguridad que no depende de
 *      que la corrida viva en memoria de ESTE proceso.
 *   2. Mientras corre se sigue el progreso por la server function que lee el
 *      SSE (`useAnalysisProgress`), que además invalida el detalle apenas
 *      termina — así la transición a `listo` es inmediata y no espera al poll.
 *   3. Una corrida fallida NO se queda en `analizando`: `readOwned` devuelve
 *      `servicio` con el mensaje del motor y esto pasa a `error`.
 *
 * Recargar la página en mitad de una corrida vuelve a entrar por (1) y (2) con
 * el mismo id de la URL: se retoma sola, sin estado de cliente que restaurar.
 */
export function useAnalysisFlow(analysisId: string | undefined): AnalysisFlow {
  const queryClient = useQueryClient();
  const cancelAnalysisMutation = useCancelAnalysis();

  const detail = useQuery({
    ...analysisQueryOptions(analysisId ?? ''),
    enabled: analysisId !== undefined,
  });

  const result = detail.data;
  const notReady = result !== undefined && !result.ok && result.reason === 'no-listo';
  const running = analysisId !== undefined && (result === undefined ? detail.isPending : notReady);

  const progress = useAnalysisProgress(analysisId, { enabled: running });
  const run = progress.data?.ok === true ? progress.data.run : null;

  /*
    Cronómetro de respaldo. El snapshot vivo trae el `elapsedMs` REAL; cuando
    la corrida no está en este proceso (reinicio, otra instancia) se cuenta
    desde que esta pestaña la vio por primera vez — es una aproximación, y es
    preferible a un contador congelado en 0:00.
  */
  const [localElapsedMs, setLocalElapsedMs] = useState(0);

  useEffect(() => {
    if (!running) return undefined;
    // El origen se toma DENTRO del efecto (no en el render, que tiene que ser
    // puro) y el estado sólo se escribe desde el temporizador.
    const startedAt = Date.now();
    const update = () => {
      setLocalElapsedMs(Date.now() - startedAt);
    };
    const first = setTimeout(update, 0);
    const timer = setInterval(update, 1_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [running, analysisId]);

  const retry = useCallback(() => {
    if (analysisId === undefined) return;
    void queryClient.invalidateQueries({ queryKey: analysisKeys.detail(analysisId) });
    void queryClient.invalidateQueries({ queryKey: analysisKeys.progress(analysisId) });
  }, [analysisId, queryClient]);

  const cancel = useCallback(() => {
    if (analysisId === undefined) return;
    cancelAnalysisMutation.mutate(analysisId);
  }, [analysisId, cancelAnalysisMutation]);

  const phase: AnalysisPhase =
    analysisId === undefined
      ? 'sin-aoi'
      : result === undefined
        ? detail.isError
          ? 'error'
          : 'analizando'
        : result.ok
          ? 'listo'
          : result.reason === 'no-listo'
            ? 'analizando'
            : 'error';

  const elapsedMs = run?.elapsedMs ?? (phase === 'analizando' ? localElapsedMs : 0);

  const errorMessage =
    phase !== 'error'
      ? null
      : result !== undefined && !result.ok
        ? result.message
        : (detail.error?.message ?? 'No se pudo leer el análisis.');

  return {
    phase,
    analysis: analysisFromResult(result),
    run,
    elapsedMs,
    errorMessage,
    retry,
    cancel,
    canceling: cancelAnalysisMutation.isPending,
  };
}

/* -------------------------------------------------------------------------- */
/* Mutaciones                                                                  */
/* -------------------------------------------------------------------------- */

export type StartAnalysisVariables = {
  /** GeoJSON del AOI: `Geometry`, `Feature` o `FeatureCollection`. */
  aoi: unknown;
  name?: string;
  /** 20 para "Bajar NDVI a 20 m" del guard de tamaño (§7.4). */
  ndviResolutionM?: number;
  lookbackDays?: number;
  maxCloudCover?: number;
  /** "Analizar igual" sobre un AOI de 500–2 000 ha. */
  confirmLargeAoi?: boolean;
};

/**
 * Lanza un análisis.
 *
 * El rechazo por AOI grande o AOI inválido llega como `data.ok === false`, no
 * como `error`: son estados de UI con su propio texto y sus propios botones
 * (§7.4, §8), no fallas de red.
 */
export function useStartAnalysis(): UseMutationResult<
  StartAnalysisResult,
  Error,
  StartAnalysisVariables
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: [...analysisKeys.all, 'lanzar'],
    mutationFn: async (variables: StartAnalysisVariables): Promise<StartAnalysisResult> =>
      await startAnalysis({ data: variables }),
    onSuccess: (result) => {
      if (!result.ok) return;
      void queryClient.invalidateQueries({ queryKey: analysisKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: analysisKeys.progress(result.analysisId) });
    },
  });
}

export function useCancelAnalysis(): UseMutationResult<{ ok: boolean }, Error, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: [...analysisKeys.all, 'cancelar'],
    mutationFn: async (analysisId: string): Promise<{ ok: boolean }> =>
      await cancelAnalysis({ data: { analysisId } }),
    onSuccess: (_result, analysisId) => {
      void queryClient.invalidateQueries({ queryKey: analysisKeys.progress(analysisId) });
      void queryClient.invalidateQueries({ queryKey: analysisKeys.detail(analysisId) });
    },
  });
}

export type RequestCoastalVariables = { analysisId: string; preset: CoastalPreset };

/**
 * Inundación costera on demand (UC-24 / UC-25).
 *
 * El servicio ya cachea por `(AOI, preset)`, así que reelegir un preset ya
 * visitado no recomputa nada; el `queryClient.setQueryData` de acá evita
 * incluso el round trip (TC-31, "no reaparece el spinner").
 */
export function useRequestCoastal(): UseMutationResult<
  CoastalResult,
  Error,
  RequestCoastalVariables
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: [...analysisKeys.coastals(), 'pedir'],
    mutationFn: async (variables: RequestCoastalVariables): Promise<CoastalResult> =>
      await requestCoastal({ data: variables }),
    onSuccess: (result, variables) => {
      if (!result.ok) return;
      queryClient.setQueryData(
        analysisKeys.coastal(variables.analysisId, variables.preset),
        result.coastal,
      );
      // El resultado persistido cambió: ahora la costera es parte del reporte.
      void queryClient.invalidateQueries({
        queryKey: analysisKeys.detail(variables.analysisId),
      });
      void queryClient.invalidateQueries({
        queryKey: analysisKeys.summary(variables.analysisId),
      });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Ayudas de lectura                                                           */
/* -------------------------------------------------------------------------- */

/** El análisis, o `null` si todavía no está o no es de este usuario. */
export function analysisFromResult(
  result: ReadAnalysisResult | undefined,
): TerritorioAnalysis | null {
  return result?.ok === true ? result.analysis : null;
}

/** El motivo del rechazo, para pintar la pantalla que corresponda. */
export function refusalFromResult(
  result: { ok: true } | AnalysisRefusal | undefined,
): AnalysisRefusal | null {
  return result !== undefined && !result.ok ? result : null;
}
