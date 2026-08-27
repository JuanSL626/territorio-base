import type { LayerStatus } from '~/layers/types';

import { Badge, type BadgeTone } from '~/components/ui/badge';

export type LayerStatusChipProps = {
  status: LayerStatus;
  /** Razón corta: "sin AOI", "sin escenas S2", "servicio caído". */
  reason?: string;
  onRetry?: () => void;
};

const TONE: Record<LayerStatus, BadgeTone> = {
  pending: 'neutral',
  ok: 'success',
  empty: 'neutral',
  error: 'danger',
  skipped: 'neutral',
};

const DEFAULT_LABEL: Record<LayerStatus, string> = {
  pending: 'calculando',
  ok: 'listo',
  empty: 'sin datos',
  error: 'error',
  skipped: 'omitida',
};

/**
 * Chip inline del §8: el error vive EN la fila de la capa, no en un toast.
 * Una capa sin datos se ve gris con su razón, nunca como un checkbox vivo.
 */
export function LayerStatusChip({ status, reason, onRetry }: LayerStatusChipProps) {
  if (status === 'ok') return null;

  const label = reason != null && reason.length > 0 ? reason : DEFAULT_LABEL[status];

  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={TONE[status]}>{label}</Badge>
      {status === 'error' && onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="text-11 text-accent font-semibold underline underline-offset-2"
        >
          reintentar
        </button>
      ) : null}
    </span>
  );
}
