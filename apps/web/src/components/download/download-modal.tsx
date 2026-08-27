import { Button } from '~/components/ui/button';
import { Dialog } from '~/components/ui/dialog';

/*
  PLACEHOLDER — el modal de exportación (§7.2) lo construye la fase siguiente:
  tres pestañas (Rápido / Datos / Impresión), lista de artefactos generada
  DESDE lo que el análisis produjo de verdad (nunca una lista estática de
  formatos, §13), selects de resolución y CRS, y el bloque de atribución con la
  nota del `LEEME.txt`.
*/

export type DownloadModalProps = {
  open: boolean;
  onClose: () => void;
  /** Sólo lo que el backend produjo para este AOI. */
  availableLayerIds: readonly string[];
  aoiSlug: string;
  onSubmit: (selection: { layerIds: string[]; crs: string; resolution: string }) => void;
};

export function DownloadModal({ open, onClose, availableLayerIds }: DownloadModalProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Exportar"
      description="Pendiente de la fase de features (§7.2)."
      footer={
        <Button variant="secondary" onClick={onClose} className="ml-auto">
          Cerrar
        </Button>
      }
    >
      <p className="text-12 text-fg-muted">
        {availableLayerIds.length} artefacto(s) disponible(s) para este AOI. Las pestañas Rápido /
        Datos / Impresión se montan en la fase siguiente.
      </p>
    </Dialog>
  );
}
