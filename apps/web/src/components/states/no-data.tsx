import { Button } from '~/components/ui/button';
import { AlertIcon, RetryIcon } from '~/components/ui/icons';

export type NoDataCardProps = {
  title: string;
  /** Razón en castellano llano. Nunca un stacktrace, nunca "Error 500". */
  reason: string;
  service?: string;
  onRetry?: () => void;
  retryLabel?: string;
};

/**
 * Tarjeta de falla parcial (§8). El motor ya aísla las caídas de servicios
 * externos (regresión #3): la UI tiene que MOSTRAR ese aislamiento, no un
 * error global que borre lo que sí se calculó.
 */
export function NoDataCard({
  title,
  reason,
  service,
  onRetry,
  retryLabel = 'Reintentar',
}: NoDataCardProps) {
  return (
    <article className="rounded-panel border-border-base bg-surface border p-4">
      <header className="flex items-center gap-2">
        <span className="text-warning">
          <AlertIcon size={16} />
        </span>
        <h3 className="text-13 text-fg font-semibold">{title}</h3>
      </header>
      <p className="text-12 text-fg-muted mt-2">{reason}</p>
      {service != null ? <p className="text-11 text-fg-subtle mt-1">Servicio: {service}</p> : null}
      {onRetry ? (
        <Button
          size="sm"
          variant="secondary"
          className="mt-3"
          leadingIcon={<RetryIcon size={13} />}
          onClick={onRetry}
        >
          {retryLabel}
        </Button>
      ) : null}
    </article>
  );
}

export type EmptyResultCardProps = {
  title: string;
  reason: string;
  widen?: { label: string; onClick: () => void };
};

/** Estado "sin resultados" (§8). Nunca un gráfico en blanco. */
export function EmptyResultCard({ title, reason, widen }: EmptyResultCardProps) {
  return (
    <article className="rounded-panel border-border-strong bg-surface-2 border border-dashed p-4">
      <h3 className="text-13 text-fg font-semibold">{title}</h3>
      <p className="text-12 text-fg-muted mt-1">{reason}</p>
      {widen ? (
        <Button size="sm" variant="secondary" className="mt-3" onClick={widen.onClick}>
          {widen.label}
        </Button>
      ) : null}
    </article>
  );
}
