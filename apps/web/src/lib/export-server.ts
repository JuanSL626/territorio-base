/**
 * Las server functions de la exportación.
 *
 * El browser nunca habla con el servicio raster ni toca el disco: pide un plan,
 * lanza un job, consulta su estado y, cuando hay algo listo, navega a la ruta
 * que transmite el ZIP.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INVARIANTES (las mismas que `analysis-server.ts`, por las mismas razones)
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. **Toda lectura está scopeada al dueño.** El análisis se lee con
 *    `fetchAnalysis`, que filtra por `user_id`; el job de exportación guarda el
 *    `userId` que lo creó y `getExportSnapshot` lo compara. Un id adivinado
 *    devuelve `no-encontrado`, nunca el AOI de otra persona.
 * 2. **El guard de tamaño (§7.4) se aplica ACÁ**, antes de crear el directorio
 *    y antes de pedirle un solo byte al servicio raster. El chequeo del modal
 *    es una cortesía para poder explicarlo con un botón al lado.
 * 3. **Los fallos esperados vuelven como unión discriminada.** "El análisis no
 *    es tuyo", "el bundle expiró" y "la selección es demasiado grande" son
 *    pantallas, no errores 500.
 */
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import {
  buildExportPlan,
  decideExportSize,
  defaultSelection,
  EXPORT_CRS_OPTIONS,
  isIncluded,
  REPORT_SECTION_IDS,
  totalEstimatedBytes,
  type ExportPlan,
  type ExportSelection,
  type ExportSizeVerdict,
} from './export-contract';
import { buildReportMarkdown } from './export-documents';
import {
  cancelExportRun,
  getExportSnapshot,
  retryExportArtifact,
  startExportRun,
  type ExportJobSnapshot,
} from './export-runtime';
import { fetchSession, type SessionUser } from './session';

import type { TerritorioAnalysis } from './analysis-contract';

/* -------------------------------------------------------------------------- */
/* Resultados                                                                  */
/* -------------------------------------------------------------------------- */

export type ExportRefusalReason =
  | 'no-autenticado'
  | 'no-encontrado'
  | 'analisis-no-listo'
  | 'seleccion-vacia'
  | 'demasiado-grande'
  | 'expirado';

export type ExportRefusal = {
  ok: false;
  reason: ExportRefusalReason;
  /** Español, mostrable tal cual. */
  message: string;
  /** Sólo en `demasiado-grande`: si alcanza con confirmar o hay que achicar. */
  verdict?: ExportSizeVerdict;
  estimatedBytes?: number;
};

export type ExportPlanResult = { ok: true; plan: ExportPlan } | ExportRefusal;
export type StartExportResult = { ok: true; jobId: string } | ExportRefusal;
export type ExportJobResult = { ok: true; job: ExportJobSnapshot } | ExportRefusal;
export type ReportMarkdownResult = { ok: true; filename: string; markdown: string } | ExportRefusal;

function refuse(
  reason: ExportRefusalReason,
  message: string,
  extra?: { verdict?: ExportSizeVerdict; estimatedBytes?: number },
): ExportRefusal {
  return { ok: false, reason, message, ...extra };
}

const NOT_AUTHENTICATED = refuse(
  'no-autenticado',
  'Tenés que iniciar sesión para exportar un análisis.',
);

const JOB_NOT_FOUND = refuse(
  'no-encontrado',
  'No existe ese trabajo de exportación, o no es tuyo. Los bundles se borran una hora después de generarse.',
);

async function currentUser(): Promise<SessionUser | null> {
  return await fetchSession();
}

/* -------------------------------------------------------------------------- */
/* Validadores                                                                 */
/* -------------------------------------------------------------------------- */

const selectionSchema = z.object({
  artifactIds: z.array(z.string().min(1).max(200)).max(200),
  crs: z.enum(EXPORT_CRS_OPTIONS),
  clipToAoi: z.boolean(),
  reportSections: z.array(z.enum(REPORT_SECTION_IDS)).max(REPORT_SECTION_IDS.length),
});

const startExportSchema = z.object({
  analysisId: z.string().min(1).max(64),
  /** Nombre legible del AOI. Da nombre al ZIP. */
  aoiName: z.string().trim().max(120).optional(),
  selection: selectionSchema,
  /** El usuario apretó «Exportar igual» sobre una selección grande (§7.4). */
  confirmLarge: z.boolean().optional(),
});

const analysisIdSchema = z.object({
  analysisId: z.string().min(1).max(64),
  aoiName: z.string().trim().max(120).optional(),
});

const jobIdSchema = z.object({ jobId: z.string().min(1).max(64) });

const retrySchema = z.object({
  jobId: z.string().min(1).max(64),
  artifactId: z.string().min(1).max(200),
});

const reportSchema = z.object({
  analysisId: z.string().min(1).max(64),
  aoiName: z.string().trim().max(120).optional(),
  sections: z.array(z.enum(REPORT_SECTION_IDS)).max(REPORT_SECTION_IDS.length).optional(),
});

/* -------------------------------------------------------------------------- */
/* Lectura del análisis                                                        */
/* -------------------------------------------------------------------------- */

/*
  El análisis se lee con la server function del otro workstream, no con una
  consulta propia: hay UN solo accesor scopeado al dueño y agregar un segundo
  sería agregar una segunda definición de "este análisis es tuyo".
*/
async function readAnalysis(
  analysisId: string,
): Promise<{ ok: true; analysis: TerritorioAnalysis } | ExportRefusal> {
  const { fetchAnalysis } = await import('./analysis-server');
  const result = await fetchAnalysis({ data: { analysisId } });

  if (result.ok) return { ok: true, analysis: result.analysis };
  if (result.reason === 'no-autenticado') return NOT_AUTHENTICATED;
  if (result.reason === 'no-listo') {
    return refuse(
      'analisis-no-listo',
      'El análisis todavía está corriendo. Esperá a que termine para exportarlo.',
    );
  }
  return refuse('no-encontrado', result.message);
}

/* -------------------------------------------------------------------------- */
/* El plan                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Qué se puede bajar de ESTE análisis. La lista sale de lo que la corrida
 * produjo de verdad — nunca de una lista estática de formatos (§7.2, §13).
 */
export const fetchExportPlan = createServerFn({ method: 'GET' })
  .validator(analysisIdSchema)
  .handler(async ({ data }): Promise<ExportPlanResult> => {
    const user = await currentUser();
    if (user === null) return NOT_AUTHENTICATED;

    const read = await readAnalysis(data.analysisId);
    if (!read.ok) return read;

    return {
      ok: true,
      plan: buildExportPlan({ analysis: read.analysis, aoiName: data.aoiName }),
    };
  });

/* -------------------------------------------------------------------------- */
/* Lanzar la exportación                                                       */
/* -------------------------------------------------------------------------- */

export const startExport = createServerFn({ method: 'POST' })
  .validator(startExportSchema)
  .handler(async ({ data }): Promise<StartExportResult> => {
    const user = await currentUser();
    if (user === null) return NOT_AUTHENTICATED;

    const read = await readAnalysis(data.analysisId);
    if (!read.ok) return read;

    const plan = buildExportPlan({ analysis: read.analysis, aoiName: data.aoiName });
    const selection: ExportSelection = {
      // Si el cliente manda una selección vacía, se usa la de por defecto: es
      // más útil que un ZIP con sólo el LEEME.
      artifactIds:
        data.selection.artifactIds.length === 0
          ? defaultSelection(plan)
          : data.selection.artifactIds,
      crs: data.selection.crs,
      clipToAoi: data.selection.clipToAoi,
      reportSections: data.selection.reportSections,
    };

    const selectedIds = new Set(selection.artifactIds);
    const included = plan.artifacts.filter((artifact) => isIncluded(artifact, selectedIds));
    const withData = included.filter((artifact) => artifact.kind !== 'documento');

    if (withData.length === 0) {
      return refuse(
        'seleccion-vacia',
        'No elegiste ninguna capa. Un ZIP con sólo la documentación no sirve de mucho: ' +
          'tildá al menos un raster o una capa vectorial.',
      );
    }

    const decision = decideExportSize({
      areaHa: plan.areaHa,
      estimatedBytes: totalEstimatedBytes(plan, selectedIds),
      artifactCount: included.length,
      confirmed: data.confirmLarge ?? false,
    });

    if (!decision.allowed) {
      return refuse('demasiado-grande', decision.message, {
        verdict: decision.verdict,
        estimatedBytes: decision.estimatedBytes,
      });
    }

    const { jobId } = startExportRun({
      userId: user.id,
      analysis: read.analysis,
      plan,
      selection,
    });

    return { ok: true, jobId };
  });

/* -------------------------------------------------------------------------- */
/* Seguimiento                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Estado del job. Barata: lee el registro del proceso, no toca la base ni el
 * servicio raster.
 */
export const fetchExportJob = createServerFn({ method: 'GET' })
  .validator(jobIdSchema)
  .handler(async ({ data }): Promise<ExportJobResult> => {
    const user = await currentUser();
    if (user === null) return NOT_AUTHENTICATED;

    const job = getExportSnapshot(data.jobId, user.id);
    if (job === null) return JOB_NOT_FOUND;
    return { ok: true, job };
  });

export const cancelExport = createServerFn({ method: 'POST' })
  .validator(jobIdSchema)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const user = await currentUser();
    if (user === null) return { ok: false };
    return { ok: cancelExportRun(data.jobId, user.id) };
  });

/**
 * Reintenta UN artefacto (§7.1). El resto del bundle no se toca y sigue
 * descargable mientras tanto.
 */
export const retryExport = createServerFn({ method: 'POST' })
  .validator(retrySchema)
  .handler(async ({ data }): Promise<ExportJobResult> => {
    const user = await currentUser();
    if (user === null) return NOT_AUTHENTICATED;

    const job = await retryExportArtifact(data.jobId, user.id, data.artifactId);
    if (job === null) return JOB_NOT_FOUND;
    return { ok: true, job };
  });

/* -------------------------------------------------------------------------- */
/* El reporte suelto                                                           */
/* -------------------------------------------------------------------------- */

/**
 * El Markdown del reporte, sin pasar por un job.
 *
 * Existe porque el legacy tenía exactamente este botón —"Descargar reporte
 * (Markdown)", `reporte_territorial.md`— y bajarlo no cuesta nada: no hay red,
 * no hay disco, es una función pura sobre un análisis ya persistido. Meterlo en
 * un job asíncrono sería ceremonia sin beneficio.
 */
export const fetchReportMarkdown = createServerFn({ method: 'GET' })
  .validator(reportSchema)
  .handler(async ({ data }): Promise<ReportMarkdownResult> => {
    const user = await currentUser();
    if (user === null) return NOT_AUTHENTICATED;

    const read = await readAnalysis(data.analysisId);
    if (!read.ok) return read;

    return {
      ok: true,
      filename: 'reporte_territorial.md',
      markdown: buildReportMarkdown({
        analysis: read.analysis,
        aoiName: data.aoiName ?? `AOI ${read.analysis.id.slice(0, 8)}`,
        generatedAt: new Date(),
        sections: data.sections,
      }),
    };
  });
