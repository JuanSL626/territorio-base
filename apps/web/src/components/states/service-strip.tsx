import { IconButton } from '~/components/ui/button';
import { AlertIcon, CloseIcon } from '~/components/ui/icons';

export type ServiceIncident = {
  service: string;
  /**
   * Reintento en curso. Ausentes cuando no hay reintento que contar: el motor
   * aísla cada fuente y devuelve su fallo una sola vez, así que anunciar
   * "reintentando (1/1)" sería inventar una recuperación que no existe.
   */
  attempt?: number;
  maxAttempts?: number;
};

export type ServiceDownStripProps = {
  incidents: ServiceIncident[];
  onDismiss: () => void;
};

export function ServiceDownStrip({ incidents, onDismiss }: ServiceDownStripProps) {
  if (incidents.length === 0) return null;

  const text = incidents
    .map((incident) =>
      incident.attempt === undefined || incident.maxAttempts === undefined
        ? `${incident.service} no responde`
        : `${incident.service} no responde — reintentando (${String(incident.attempt)}/${String(
            incident.maxAttempts,
          )})`,
    )
    .join(' · ');

  return (
    <div
      role="status"
      className="bg-warning-soft text-warning flex h-7 shrink-0 items-center gap-2 px-3"
    >
      <AlertIcon size={14} />
      <span className="text-11 min-w-0 flex-1 truncate font-medium">{text}</span>
      <IconButton
        label="Descartar aviso"
        icon={<CloseIcon size={12} />}
        onClick={onDismiss}
        className="h-5 w-5"
      />
    </div>
  );
}
