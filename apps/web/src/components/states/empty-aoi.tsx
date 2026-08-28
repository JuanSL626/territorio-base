import { useState, type DragEvent } from 'react';

import { ACCEPTED_AOI_EXTENSIONS, AOI_LIMITS_LINE } from '~/components/map/aoi-upload';
import { DrawIcon, UploadIcon } from '~/components/ui/icons';
import { cn } from '~/lib/cn';

export type EmptyAoiStateProps = {
  onDraw: () => void;
  onFiles: (files: FileList) => void;
};

/**
 * Estado "sin AOI" (§8): sin selector de datasets ni botón de enviar — el
 * análisis arranca solo al cerrar el polígono. Límites de tamaño y formato
 * van acá, no en una ayuda aparte (§13).
 */
export function EmptyAoiState({ onDraw, onFiles }: EmptyAoiStateProps) {
  const [dragging, setDragging] = useState(false);

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length > 0) onFiles(event.dataTransfer.files);
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <div>
        <h2 className="text-15 text-fg font-semibold">Definí la zona de estudio</h2>
        <p className="text-12 text-fg-muted mt-1">
          El análisis arranca solo, apenas se cierra el polígono.
        </p>
      </div>

      <button
        type="button"
        onClick={onDraw}
        className="rounded-panel border-border-base bg-surface hover:border-accent hover:bg-accent-soft flex h-18 items-center gap-3 border px-4 text-left transition-colors"
      >
        <span className="text-accent">
          <DrawIcon size={22} />
        </span>
        <span>
          <span className="text-13 text-fg block font-semibold">Dibujar en el mapa</span>
          <span className="text-12 text-fg-muted block">Polígono o rectángulo</span>
        </span>
      </button>

      <label
        data-testid="aoi-dropzone-panel"
        data-dragging={dragging ? 'true' : 'false'}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => {
          setDragging(false);
        }}
        onDrop={handleDrop}
        className={cn(
          'rounded-panel flex min-h-18 cursor-pointer items-center gap-3 border px-4 py-3 text-left transition-colors',
          dragging
            ? 'border-accent bg-accent-soft border-dashed'
            : 'border-border-base bg-surface hover:border-accent hover:bg-accent-soft',
        )}
      >
        <span className="text-accent">
          <UploadIcon size={22} />
        </span>
        <span className="min-w-0">
          <span className="text-13 text-fg block font-semibold">Subir un archivo</span>
          <span className="text-11 text-fg-muted block">{AOI_LIMITS_LINE}</span>
        </span>
        <input
          type="file"
          accept={ACCEPTED_AOI_EXTENSIONS}
          className="sr-only"
          data-testid="aoi-file-input-panel"
          aria-label="Subir archivo de AOI desde el panel"
          onChange={(event) => {
            const { files } = event.target;
            if (files && files.length > 0) onFiles(files);
          }}
        />
      </label>
    </div>
  );
}
