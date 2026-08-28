import { useEffect, useRef, useState, type RefObject } from 'react';

import { AoiParseError, parseAoiFile, type Aoi } from '@territorio/geo/aoi';

import { UploadIcon } from '~/components/ui/icons';
import { formatBytes } from '~/lib/format';

/*
  Subida de AOI — KML, KMZ y GeoJSON, parseados por `@territorio/geo`.

  Dos cosas del inventario que este archivo existe para no repetir:

  · UC-03 / TC-04: en el legacy un archivo corrupto reventaba con un traceback
    crudo de Streamlit. `parseAoiFile` lanza `AoiParseError` con texto en
    castellano mostrable, y acá se captura SIEMPRE — ningún fallo de parseo
    llega a la consola como excepción no manejada.

  · Regresión #8: el parser de KML/KMZ es una dependencia explícita y
    declarada (`@tmcw/togeojson`, `@xmldom/xmldom`, `jszip` en el package.json
    de `@territorio/geo`), no una que "estaba instalada".

  Y el §13: los límites duros se imprimen EN el dropzone, no en una página de
  ayuda. Sólo se listan los formatos que el parser realmente acepta: ofrecer
  "SHP zipeado" cuando `parseAoiFile` lo rechaza sería justamente el
  antipatrón de ofrecer un formato que el backend no puede producir/consumir.
*/

/** §7.4: el límite se dice antes del clic, no después del timeout. */
export const MAX_AOI_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_AOI_EXTENSIONS = '.kml,.kmz,.geojson,.json';
export const AOI_LIMITS_LINE = `máx. ${formatBytes(MAX_AOI_BYTES)} · KML, KMZ, GeoJSON · un solo polígono (varias geometrías se unen)`;

export type AoiUploadProps = {
  /** Lo prende el botón "Subir AOI" de la toolbar (§2, botón ②). */
  open: boolean;
  /** Contenedor del mapa: es el que recibe el `drop`. */
  containerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onLoaded: (aoi: Aoi) => void;
  onError: (message: string) => void;
};

/**
 * Lee y parsea un archivo de AOI. Exportado porque el dropzone del panel
 * (`states/empty-aoi.tsx`) tiene su PROPIO `input[type=file]` y su propio
 * `drop`: sin esto su `FileList` no tenía a dónde ir, y elegir un archivo ahí
 * no hacía absolutamente nada (o abría un segundo diálogo del sistema).
 */
export async function readAoiFile(file: File): Promise<Aoi> {
  if (file.size > MAX_AOI_BYTES) {
    throw new AoiParseError(
      `El archivo pesa ${formatBytes(file.size)} y el máximo es ${formatBytes(MAX_AOI_BYTES)}.`,
    );
  }
  const data = new Uint8Array(await file.arrayBuffer());
  return await parseAoiFile({ data, filename: file.name });
}

export function aoiErrorMessage(error: unknown): string {
  if (error instanceof AoiParseError) return error.message;
  if (error instanceof Error) return `No se pudo leer el archivo: ${error.message}`;
  return 'No se pudo leer el archivo.';
}

/**
 * Input de archivo oculto + zona de arrastre sobre el mapa.
 *
 * Los listeners de arrastre se registran sobre el CONTENEDOR del mapa, no
 * sobre un `div` superpuesto: un overlay con `pointer-events: none` no recibe
 * `dragover`, y uno sin `pointer-events: none` se comería los clics del mapa.
 */
export function AoiUpload({ open, containerRef, onClose, onLoaded, onError }: AoiUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (open) inputRef.current?.click();
  }, [open]);

  /*
    Los callbacks se leen desde un ref porque los listeners de arrastre se
    registran UNA vez sobre el nodo del mapa: por clausura verían los de la
    primera pintada. Se escriben en un efecto, nunca durante el render.
  */
  const handlersRef = useRef({ onClose, onLoaded, onError });
  useEffect(() => {
    handlersRef.current = { onClose, onLoaded, onError };
  }, [onClose, onLoaded, onError]);

  useEffect(() => {
    const node = containerRef.current;
    if (node === null) return undefined;

    const take = (file: File | undefined) => {
      handlersRef.current.onClose();
      if (file === undefined) return;
      readAoiFile(file).then(handlersRef.current.onLoaded, (error: unknown) => {
        handlersRef.current.onError(aoiErrorMessage(error));
      });
    };

    const onDragOver = (event: DragEvent) => {
      // Sin esto el navegador ABRE el archivo y se pierde la sesión entera.
      event.preventDefault();
      setDragging(true);
    };
    const onDragLeave = (event: DragEvent) => {
      if (event.relatedTarget === null || !node.contains(event.relatedTarget as Node)) {
        setDragging(false);
      }
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
      take(event.dataTransfer?.files[0]);
    };

    node.addEventListener('dragover', onDragOver);
    node.addEventListener('dragleave', onDragLeave);
    node.addEventListener('drop', onDrop);
    return () => {
      node.removeEventListener('dragover', onDragOver);
      node.removeEventListener('dragleave', onDragLeave);
      node.removeEventListener('drop', onDrop);
    };
  }, [containerRef]);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_AOI_EXTENSIONS}
        className="sr-only"
        aria-label="Subir archivo de AOI"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Se limpia el valor para que subir DOS VECES el mismo archivo
          // vuelva a disparar `change` (UC-04: reemplazar el AOI anterior).
          if (inputRef.current !== null) inputRef.current.value = '';
          handlersRef.current.onClose();
          if (file === undefined) return;
          readAoiFile(file).then(handlersRef.current.onLoaded, (error: unknown) => {
            handlersRef.current.onError(aoiErrorMessage(error));
          });
        }}
      />

      {dragging ? (
        <div
          data-testid="aoi-drop-overlay"
          className="border-accent bg-accent-soft/70 pointer-events-none absolute inset-4 z-30 flex items-center justify-center rounded-lg border-2 border-dashed"
        >
          <div className="text-13 text-accent flex flex-col items-center gap-2 text-center font-medium">
            <UploadIcon size={24} />
            Soltá el archivo para usarlo como zona de estudio
            <span className="text-11 text-fg-muted">{AOI_LIMITS_LINE}</span>
          </div>
        </div>
      ) : null}
    </>
  );
}
