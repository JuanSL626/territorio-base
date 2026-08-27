import type { ExportArtifactSnapshot, ExportJobSnapshot } from '~/lib/export-runtime';

import { Badge, type BadgeTone } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { AlertIcon, CheckIcon, RetryIcon, SpinnerIcon } from '~/components/ui/icons';
import { cn } from '~/lib/cn';
import { type ExportArtifactStatus, groupArtifacts } from '~/lib/export-contract';
import { formatBytes } from '~/lib/format';

/*
  La lista de artefactos de un trabajo en curso (§7.1).

  La regla: **cada fila falla sola**. `NDVI · error (STAC timeout) [Reintentar]`
  convive con seis filas verdes, y el bundle se puede bajar igual con lo que sí
  se generó. Un error de artefacto no es un error de trabajo.

  `omitido` y `error` se pintan distinto a propósito. `omitido` = el análisis
  nunca produjo ese dato (o el usuario lo destildó): reintentar daría lo mismo,
  así que no hay botón. `error` = la generación falló (red, disco, el servicio
  raster): ahí sí.
*/

const TONE: Record<ExportArtifactStatus, BadgeTone> = {
  pendiente: 'neutral',
  generando: 'info',
  listo: 'success',
  omitido: 'warning',
  error: 'danger',
};

const LABEL: Record<ExportArtifactStatus, string> = {
  pendiente: 'en cola',
  generando: 'generando',
  listo: 'listo',
  omitido: 'no incluido',
  error: 'error',
};

export type ExportJobPanelProps = {
  job: ExportJobSnapshot;
  onRetry: (artifactId: string) => void;
  retryingId: string | null;
};

function ArtifactRow({
  artifact,
  onRetry,
  retrying,
}: {
  artifact: ExportArtifactSnapshot;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <li className="border-border-base/60 flex items-start gap-3 border-b px-4 py-2.5 last:border-b-0">
      <span className="mt-0.5 shrink-0">
        {artifact.status === 'listo' ? (
          <span className="text-success">
            <CheckIcon size={14} />
          </span>
        ) : artifact.status === 'generando' ? (
          <span className="text-info">
            <SpinnerIcon size={14} />
          </span>
        ) : artifact.status === 'error' ? (
          <span className="text-danger">
            <AlertIcon size={14} />
          </span>
        ) : (
          <span className="text-fg-subtle">
            <AlertIcon size={14} />
          </span>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'text-13 block',
            artifact.status === 'omitido' ? 'text-fg-muted' : 'text-fg',
          )}
        >
          {artifact.label}
        </span>
        {artifact.reason !== null ? (
          <span className="text-11 text-fg-muted mt-0.5 block">{artifact.reason}</span>
        ) : null}
        {artifact.entries.length > 0 ? (
          <span className="text-11 text-fg-subtle tabular mt-0.5 block truncate">
            {artifact.entries.join(' · ')}
          </span>
        ) : null}
      </span>

      {artifact.bytes !== null ? (
        <span className="text-11 text-fg-muted tabular mt-0.5 shrink-0">
          {formatBytes(artifact.bytes)}
        </span>
      ) : null}

      <Badge tone={TONE[artifact.status]}>{LABEL[artifact.status]}</Badge>

      {artifact.retryable ? (
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<RetryIcon size={13} />}
          loading={retrying}
          onClick={onRetry}
        >
          Reintentar
        </Button>
      ) : null}
    </li>
  );
}

export function ExportJobPanel({ job, onRetry, retryingId }: ExportJobPanelProps) {
  const groups = groupArtifacts(
    job.artifacts.map((artifact) => ({
      // `groupArtifacts` sólo mira `group`; el resto del plan no viaja en el
      // snapshot y no hace falta reconstruirlo para agrupar.
      id: artifact.id,
      kind: 'vector' as const,
      label: artifact.label,
      group: artifact.group,
      formats: '',
      selectable: true,
      reason: artifact.reason,
      defaultSelected: false,
      mandatory: false,
      estimatedBytes: 0,
      datasetId: null,
      featureCount: null,
    })),
  );

  const byId = new Map(job.artifacts.map((artifact) => [artifact.id, artifact]));

  return (
    <div className="flex flex-col gap-3">
      {groups.map((entry) => (
        <section
          key={entry.group}
          className="rounded-panel border-border-base bg-surface overflow-hidden border"
        >
          <h2 className="border-border-base bg-surface-2 text-12 text-fg-subtle flex h-8 items-center border-b px-4 font-semibold tracking-wide uppercase">
            {entry.group}
          </h2>
          <ul className="flex flex-col">
            {entry.artifacts.map((plan) => {
              const artifact = byId.get(plan.id);
              if (artifact === undefined) return null;
              return (
                <ArtifactRow
                  key={artifact.id}
                  artifact={artifact}
                  retrying={retryingId === artifact.id}
                  onRetry={() => {
                    onRetry(artifact.id);
                  }}
                />
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
