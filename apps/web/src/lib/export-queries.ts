/**
 * TanStack Query para el flujo de exportación: plan, lanzar, seguir, reintentar.
 *
 * Claves:
 *   exportKeys.all              → todo
 *   exportKeys.plan(analysisId) → qué se puede bajar de ese análisis
 *   exportKeys.job(jobId)       → el estado de un trabajo
 *
 * El job se poletea mientras está generando y **se deja de poletear solo** en
 * cuanto llega a un estado terminal. `/descargas/$jobId` puede quedarse abierta
 * media hora sin seguir golpeando el servidor.
 */
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import {
  cancelExport,
  fetchExportJob,
  fetchExportPlan,
  fetchReportMarkdown,
  retryExport,
  startExport,
  type ExportJobResult,
  type ExportPlanResult,
  type ExportRefusal,
  type ReportMarkdownResult,
  type StartExportResult,
} from './export-server';

import type { ExportPlan, ExportSelection } from './export-contract';
import type { ExportJobSnapshot } from './export-runtime';

export const exportKeys = {
  all: ['exportacion'] as const,
  plans: () => [...exportKeys.all, 'plan'] as const,
  plan: (analysisId: string) => [...exportKeys.plans(), analysisId] as const,
  jobs: () => [...exportKeys.all, 'trabajo'] as const,
  job: (jobId: string) => [...exportKeys.jobs(), jobId] as const,
};

/** Cadencia del seguimiento. Un artefacto tarda de 1 a 30 s. */
const JOB_POLL_MS = 1_200;

/*
  El plan depende del resultado del análisis, que es inmutable salvo que se le
  adjunte la capa costera. 60 s es suficiente para que abrir y cerrar el modal
  dos veces no vuelva a leer varios MB de SQLite, y poco como para que una
  costera recién explorada aparezca.
*/
const PLAN_STALE_MS = 60_000;

export function exportPlanQueryOptions(analysisId: string | undefined, aoiName?: string) {
  return queryOptions({
    queryKey: exportKeys.plan(analysisId ?? ''),
    queryFn: async (): Promise<ExportPlanResult> =>
      await fetchExportPlan({ data: { analysisId: analysisId ?? '', aoiName } }),
    enabled: analysisId !== undefined && analysisId !== '',
    staleTime: PLAN_STALE_MS,
  });
}

export function exportJobQueryOptions(jobId: string) {
  return queryOptions({
    queryKey: exportKeys.job(jobId),
    queryFn: async (): Promise<ExportJobResult> => await fetchExportJob({ data: { jobId } }),
    staleTime: 0,
    // Un job que no está no va a aparecer por insistir: puede haber expirado, o
    // haberlo lanzado otro proceso.
    retry: false,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data === undefined) return JOB_POLL_MS;
      if (!data.ok) return false;
      return data.job.status === 'generando' ? JOB_POLL_MS : false;
    },
  });
}

export function useExportPlan(
  analysisId: string | undefined,
  aoiName?: string,
): UseQueryResult<ExportPlanResult> {
  return useQuery(exportPlanQueryOptions(analysisId, aoiName));
}

export function useExportJob(jobId: string): UseQueryResult<ExportJobResult> {
  return useQuery(exportJobQueryOptions(jobId));
}

export type StartExportVariables = {
  analysisId: string;
  aoiName?: string;
  selection: ExportSelection;
  /** «Exportar igual» sobre una selección grande (§7.4). */
  confirmLarge?: boolean;
};

/**
 * Lanza la exportación.
 *
 * El rechazo por selección grande o vacía llega como `data.ok === false`, no
 * como `error`: son estados con su propio texto y su propio botón, no fallas de
 * red que haya que reintentar.
 */
export function useStartExport(): UseMutationResult<
  StartExportResult,
  Error,
  StartExportVariables
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: [...exportKeys.all, 'lanzar'],
    mutationFn: async (variables: StartExportVariables): Promise<StartExportResult> =>
      await startExport({ data: variables }),
    onSuccess: (result) => {
      if (!result.ok) return;
      void queryClient.invalidateQueries({ queryKey: exportKeys.job(result.jobId) });
    },
  });
}

export function useCancelExport(): UseMutationResult<{ ok: boolean }, Error, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: [...exportKeys.all, 'cancelar'],
    mutationFn: async (jobId: string): Promise<{ ok: boolean }> =>
      await cancelExport({ data: { jobId } }),
    onSuccess: (_result, jobId) => {
      void queryClient.invalidateQueries({ queryKey: exportKeys.job(jobId) });
    },
  });
}

export type RetryExportVariables = { jobId: string; artifactId: string };

/**
 * Reintenta un artefacto. La respuesta ya trae el job entero, así que se
 * escribe directo en la caché: la fila cambia de estado sin un round trip extra.
 */
export function useRetryExport(): UseMutationResult<ExportJobResult, Error, RetryExportVariables> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: [...exportKeys.all, 'reintentar'],
    mutationFn: async (variables: RetryExportVariables): Promise<ExportJobResult> =>
      await retryExport({ data: variables }),
    onSuccess: (result, variables) => {
      if (!result.ok) return;
      queryClient.setQueryData(exportKeys.job(variables.jobId), result);
    },
  });
}

export type ReportMarkdownVariables = {
  analysisId: string;
  aoiName?: string;
  sections?: ExportSelection['reportSections'];
};

/** «Descargar reporte (Markdown)» — el botón que el legacy ya tenía. */
export function useReportMarkdown(): UseMutationResult<
  ReportMarkdownResult,
  Error,
  ReportMarkdownVariables
> {
  return useMutation({
    mutationKey: [...exportKeys.all, 'reporte-md'],
    mutationFn: async (variables: ReportMarkdownVariables): Promise<ReportMarkdownResult> =>
      await fetchReportMarkdown({ data: variables }),
  });
}

export function planFromResult(result: ExportPlanResult | undefined): ExportPlan | null {
  return result?.ok === true ? result.plan : null;
}

export function jobFromResult(result: ExportJobResult | undefined): ExportJobSnapshot | null {
  return result?.ok === true ? result.job : null;
}

export function exportRefusal(
  result: { ok: true } | ExportRefusal | undefined,
): ExportRefusal | null {
  return result !== undefined && !result.ok ? result : null;
}

/** La URL que transmite el ZIP. Es una navegación del navegador, no un fetch. */
export function bundleDownloadHref(jobId: string): string {
  return `/descargas/${encodeURIComponent(jobId)}/zip`;
}
