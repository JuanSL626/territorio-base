import { Link } from '@tanstack/react-router';

import { AlertIcon, DownloadIcon, SpinnerIcon } from '~/components/ui/icons';
import { cn } from '~/lib/cn';
import { jobFromResult, useExportJob } from '~/lib/export-queries';
import { formatBytes } from '~/lib/format';

/*
  El chip del topbar del §7.1.

  `Exportar` deja de ser un botón y pasa a ser estado: `Exportando… 3/7`
  mientras corre, `Descargar (18,4 MB)` cuando terminó. Clickearlo lleva a
  `/descargas/$jobId`, que es donde está el detalle por artefacto.

  El progreso es DETERMINADO, no un spinner: `done/total` sale de artefactos
  realmente terminados y los MB son bytes reales de disco. Un indeterminado
  sobre un trabajo de minutos no le dice nada a nadie.
*/

export type ExportChipProps = {
  jobId: string;
  className?: string;
};

export function ExportChip({ jobId, className }: ExportChipProps) {
  const query = useExportJob(jobId);
  const job = jobFromResult(query.data);

  if (job === null) return null;

  const running = job.status === 'generando';
  const failed = job.status === 'error' || job.status === 'expirado';

  return (
    <Link
      to="/descargas/$jobId"
      params={{ jobId }}
      className={cn(
        'rounded-chip text-12 inline-flex h-7 items-center gap-1.5 px-2 font-medium',
        failed ? 'bg-danger-soft text-danger' : null,
        running ? 'bg-info-soft text-info' : null,
        !failed && !running ? 'bg-success-soft text-success' : null,
        className,
      )}
    >
      {running ? (
        <>
          <SpinnerIcon size={13} />
          <span className="tabular">
            Exportando… {job.done}/{job.total}
          </span>
        </>
      ) : failed ? (
        <>
          <AlertIcon size={13} />
          <span>{job.status === 'expirado' ? 'Bundle expirado' : 'Exportación fallida'}</span>
        </>
      ) : (
        <>
          <DownloadIcon size={13} />
          <span className="tabular">Descargar ({formatBytes(job.bytes)})</span>
        </>
      )}
    </Link>
  );
}
