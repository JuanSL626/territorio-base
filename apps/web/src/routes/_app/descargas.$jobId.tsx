import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import type { ExportJobStatus } from '~/lib/export-runtime';

import { ExportJobPanel } from '~/components/download/export-job-panel';
import { Badge, type BadgeTone } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { AlertIcon, DownloadIcon, SpinnerIcon } from '~/components/ui/icons';
import { useToast } from '~/components/ui/toast';
import {
  bundleDownloadHref,
  jobFromResult,
  useCancelExport,
  useExportJob,
  useRetryExport,
} from '~/lib/export-queries';
import { formatBytes, formatElapsed } from '~/lib/format';

/**
 * `/descargas/$jobId` — la pantalla del trabajo de exportación (§7.1).
 *
 * Por qué el id vive en la URL: porque un trabajo que dura minutos tiene que sobrevivir a un F5, a cerrar la
 * pestaña y a pegarle el link a un colega. Todo el estado que hace falta para
 * volver a encontrarlo es este id: la pantalla no guarda nada en memoria del
 * cliente y se reconstruye entera desde el servidor en cada carga.
 *
 * El progreso se poletea mientras el trabajo corre y se corta solo al terminar
 * (ver `export-queries.ts`), así que dejar esta pestaña abierta no le cuesta
 * nada al servidor.
 */
export const Route = createFileRoute('/_app/descargas/$jobId')({
  component: DescargasPage,
});

const STATUS_TONE: Record<ExportJobStatus, BadgeTone> = {
  generando: 'info',
  listo: 'success',
  parcial: 'warning',
  error: 'danger',
  cancelado: 'neutral',
  expirado: 'danger',
};

const STATUS_LABEL: Record<ExportJobStatus, string> = {
  generando: 'generando',
  listo: 'listo',
  parcial: 'listo con faltantes',
  error: 'falló',
  cancelado: 'cancelado',
  expirado: 'expirado',
};

function DescargasPage() {
  const { jobId } = Route.useParams();
  const toast = useToast();

  const query = useExportJob(jobId);
  const job = jobFromResult(query.data);
  const refusal = query.data?.ok === false ? query.data : null;

  const retry = useRetryExport();
  const cancel = useCancelExport();
  const [retryingId, setRetryingId] = useState<string | null>(null);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl p-6">
      <Link to="/" className="text-12 text-accent font-medium underline underline-offset-2">
        ← Volver al mapa
      </Link>

      <header className="mt-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-18 text-fg font-semibold">Exportación</h1>
          <p className="text-12 text-fg-muted mt-1">
            Trabajo <span className="tabular">{jobId}</span>. Podés cerrar esta pestaña: el trabajo
            sigue corriendo del lado del servidor.
          </p>
        </div>
        {job !== null ? (
          <Badge tone={STATUS_TONE[job.status]}>{STATUS_LABEL[job.status]}</Badge>
        ) : null}
      </header>

      {query.isPending ? (
        <p className="text-12 text-fg-muted mt-6">Buscando el trabajo…</p>
      ) : refusal !== null ? (
        <MissingJob message={refusal.message} />
      ) : job === null ? (
        <MissingJob />
      ) : (
        <>
          {job.status === 'generando' ? (
            <Progress done={job.done} total={job.total} startedAt={job.createdAt} />
          ) : null}

          {job.error !== null ? (
            <div className="rounded-panel border-danger bg-danger-soft text-danger mt-4 border p-3">
              <div className="flex items-center gap-2">
                <AlertIcon size={15} />
                <p className="text-13 font-semibold">{job.error}</p>
              </div>
            </div>
          ) : null}

          {job.status === 'parcial' ? (
            <div className="rounded-panel border-warning bg-warning-soft text-warning mt-4 border p-3">
              <div className="flex items-center gap-2">
                <AlertIcon size={15} />
                <p className="text-13 font-semibold">El bundle está incompleto</p>
              </div>
              <p className="text-11 mt-1">
                Algunas capas no se pudieron generar. Podés bajar el ZIP igual —lo que falta está
                anotado adentro, en <code className="tabular">LEEME.txt</code> y{' '}
                <code className="tabular">FUENTES.txt</code>, con el motivo— o reintentar las filas
                en rojo y volver a bajarlo.
              </p>
            </div>
          ) : null}

          <div className="mt-4">
            <ExportJobPanel
              job={job}
              retryingId={retryingId}
              onRetry={(artifactId) => {
                setRetryingId(artifactId);
                retry.mutate(
                  { jobId, artifactId },
                  {
                    onSettled: () => {
                      setRetryingId(null);
                    },
                    onError: (error) => {
                      toast.push({
                        tone: 'error',
                        title: 'No se pudo reintentar',
                        description: error.message,
                      });
                    },
                  },
                );
              }}
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {job.downloadable ? (
              /*
                Es un <a>, no un <Link>: la ruta del ZIP es un handler de
                servidor y esto tiene que ser una navegación real del navegador
                para que dispare la descarga con `Content-Disposition`.
              */
              <a
                href={bundleDownloadHref(jobId)}
                className="rounded-btn bg-accent text-accent-fg text-13 inline-flex h-8 items-center gap-1.5 px-3 font-medium"
              >
                <DownloadIcon size={14} />
                Descargar bundle ({formatBytes(job.bytes)})
              </a>
            ) : (
              <Button variant="primary" disabled leadingIcon={<DownloadIcon size={14} />}>
                Descargar bundle
              </Button>
            )}

            {job.status === 'generando' ? (
              <Button
                variant="secondary"
                loading={cancel.isPending}
                onClick={() => {
                  cancel.mutate(jobId);
                }}
              >
                Cancelar
              </Button>
            ) : null}
          </div>

          <p className="text-11 text-fg-muted mt-3">
            El ZIP incluye <code className="tabular">FUENTES.txt</code> con fuentes, licencias,
            citas y fecha de consulta, y <code className="tabular">LEEME.txt</code> con el CRS de
            cada archivo y el AOI que produjo estos datos.
          </p>
          <p className="text-11 text-fg-subtle mt-1">
            El bundle se borra del servidor{' '}
            <time dateTime={job.expiresAt}>
              el {new Date(job.expiresAt).toLocaleString('es-DO')}
            </time>
            . Después de eso hay que volver a exportar.
          </p>
        </>
      )}
    </main>
  );
}

/**
 * Cronómetro. `Date.now()` es impuro y no puede vivir en el render, así que el
 * reloj entra por un intervalo: el primer tick llega en el siguiente turno del
 * bucle de eventos (no sincrónicamente dentro del efecto, que encadenaría un
 * render), y de ahí en más una vez por segundo.
 */
function useElapsedMs(startedAt: string): number {
  const [now, setNow] = useState(0);

  useEffect(() => {
    const tick = () => {
      setNow(Date.now());
    };
    const first = setTimeout(tick, 0);
    const interval = setInterval(tick, 1_000);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, []);

  return now === 0 ? 0 : now - new Date(startedAt).getTime();
}

/** Progreso determinado del §7.1: `3/7`, con barra y cronómetro. */
function Progress({ done, total, startedAt }: { done: number; total: number; startedAt: string }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const elapsed = useElapsedMs(startedAt);

  return (
    <section className="rounded-panel border-border-base bg-surface mt-4 border p-4">
      <div className="flex items-center gap-2">
        <span className="text-info">
          <SpinnerIcon size={14} />
        </span>
        <p className="text-13 text-fg tabular font-semibold">
          Exportando… {done}/{total}
        </p>
        <span className="flex-1" />
        <p className="text-11 text-fg-muted tabular">{formatElapsed(elapsed)}</p>
      </div>

      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Progreso de la exportación"
        className="bg-surface-3 mt-3 h-1.5 w-full overflow-hidden rounded-full"
      >
        <div className="bg-accent h-full transition-all" style={{ width: `${String(pct)}%` }} />
      </div>
    </section>
  );
}

function MissingJob({ message }: { message?: string }) {
  return (
    <section className="rounded-panel border-border-strong mt-6 border border-dashed p-6">
      <div className="text-fg-muted flex items-center gap-2">
        <AlertIcon size={16} />
        <p className="text-13 text-fg font-semibold">No encontramos ese trabajo</p>
      </div>
      <p className="text-12 text-fg-muted mt-1">
        {message ??
          'No existe ese trabajo de exportación, o no es tuyo. Los bundles se borran una hora después de generarse.'}
      </p>
      <p className="text-12 text-fg-muted mt-2">
        Volvé al mapa, abrí <span className="text-fg font-medium">Exportar</span> y generá el bundle
        de nuevo: el análisis sigue guardado, así que no hay que volver a correrlo.
      </p>
      <Link
        to="/"
        className="text-12 text-accent mt-3 inline-block font-medium underline underline-offset-2"
      >
        Ir al mapa
      </Link>
    </section>
  );
}
