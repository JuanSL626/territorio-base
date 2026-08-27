import { useEffect, useState } from 'react';

import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import { DownloadIcon, InfoIcon } from '~/components/ui/icons';
import { SegmentedControl } from '~/components/ui/segmented-control';

/*
  Pestaña "Rápido" del §7.2: una imagen del mapa tal como se ve ahora.

  ─────────────────────────────────────────────────────────────────────────────
  POR QUÉ LA CAPTURA LA HACE EL MAPA Y NO ESTE COMPONENTE
  ─────────────────────────────────────────────────────────────────────────────
  Sacarle una foto a un mapa WebGL es `canvas.toDataURL()` sobre el canvas de
  MapLibre, y hay que hacerlo en el frame en que el mapa terminó de dibujar y
  con `preserveDrawingBuffer` puesto. Nada de eso se puede hacer desde acá: el
  modal no tiene la instancia del mapa, y agarrarla por un contexto global sería
  acoplar la exportación al ciclo de vida del canvas.

  Así que el contrato es al revés: el mapa expone `onCaptureMap(opciones)` y
  devuelve un data URL. Este componente es dueño de las OPCIONES, de la
  miniatura y de la descarga. Si nadie provee la función, la pestaña lo dice —
  no muestra un botón que no hace nada.
*/

export type SnapshotOptions = {
  includeLegend: boolean;
  includeScale: boolean;
  includeAoiOutline: boolean;
  /** Recortar al bbox del AOI. Default ON (§7.2). */
  clipToAoi: boolean;
  format: SnapshotFormat;
};

export type SnapshotFormat = 'png' | 'jpg';

/** La provee la ruta del mapa. Devuelve un data URL, o `null` si no pudo. */
export type CaptureMap = (options: SnapshotOptions) => Promise<string | null>;

const FORMATS = [
  { id: 'png', label: 'PNG', hint: 'sin pérdida' },
  { id: 'jpg', label: 'JPG', hint: 'más liviano' },
] as const satisfies readonly { id: SnapshotFormat; label: string; hint: string }[];

export type QuickSnapshotTabProps = {
  onCaptureMap?: CaptureMap;
  aoiName: string;
};

export function QuickSnapshotTab({ onCaptureMap, aoiName }: QuickSnapshotTabProps) {
  const [options, setOptions] = useState<SnapshotOptions>({
    includeLegend: true,
    includeScale: true,
    includeAoiOutline: true,
    clipToAoi: true,
    format: 'png',
  });
  /*
    Un solo estado para la previa. Tres `useState` sueltos harían tres renders
    por captura y dejarían estados imposibles a la vista (una miniatura vieja
    con `error` puesto, por ejemplo).
  */
  const [shot, setShot] = useState<{ preview: string | null; busy: boolean; error: string | null }>(
    { preview: null, busy: onCaptureMap !== undefined, error: null },
  );
  const { preview, busy, error } = shot;

  /*
    La miniatura se rehace cada vez que cambia una opción: el §7.2 pide una
    "vista previa en vivo fijada arriba del botón", y una previa que no refleja
    el toggle que acabás de tocar es peor que no tener previa.

    El `busy` NO se prende acá adentro: prenderlo sincrónicamente en el cuerpo
    del efecto encadena un render extra por cada captura. Lo prende el handler
    que cambió la opción (`patch`), que es donde el usuario efectivamente pidió
    una foto nueva; el efecto sólo escribe estado desde los callbacks async.
  */
  useEffect(() => {
    if (onCaptureMap === undefined) return;
    let cancelled = false;

    void onCaptureMap(options)
      .then((dataUrl) => {
        if (cancelled) return;
        setShot({
          preview: dataUrl,
          busy: false,
          error: dataUrl === null ? 'El mapa no pudo entregar una imagen en este momento.' : null,
        });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setShot({
          preview: null,
          busy: false,
          error: cause instanceof Error ? cause.message : 'No se pudo capturar el mapa.',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [onCaptureMap, options]);

  const patch = (next: Partial<SnapshotOptions>) => {
    setShot((current) => ({ ...current, busy: true, error: null }));
    setOptions((current) => ({ ...current, ...next }));
  };

  const download = () => {
    if (preview === null) return;
    const anchor = document.createElement('a');
    anchor.href = preview;
    anchor.download = `mapa_${aoiName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.${options.format}`;
    anchor.click();
  };

  if (onCaptureMap === undefined) {
    return (
      <div className="rounded-panel border-border-strong border border-dashed p-4">
        <div className="text-fg-muted flex items-center gap-2">
          <InfoIcon size={15} />
          <p className="text-13 text-fg font-semibold">La imagen se saca desde el mapa</p>
        </div>
        <p className="text-12 text-fg-muted mt-1">
          Esta pantalla no tiene el canvas del mapa, así que no puede fotografiarlo. Abrí el modal
          desde el mapa para que la captura esté disponible; mientras tanto, la pestaña{' '}
          <span className="text-fg font-medium">Datos</span> tiene el entregable real (rasters,
          shapefiles, reporte y fuentes).
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-panel border-border-base bg-surface-3 flex aspect-[16/10] items-center justify-center overflow-hidden border">
        {preview === null ? (
          <p className="text-11 text-fg-muted px-4 text-center">
            {busy ? 'Capturando el mapa…' : (error ?? 'Sin vista previa.')}
          </p>
        ) : (
          <img
            src={preview}
            alt="Vista previa de la imagen del mapa"
            className="h-full w-full object-contain"
          />
        )}
      </div>

      <div className="rounded-panel border-border-base bg-surface flex flex-col gap-2 border p-3">
        <Checkbox
          label="Incluir leyenda"
          checked={options.includeLegend}
          onChange={(event) => {
            patch({ includeLegend: event.currentTarget.checked });
          }}
        />
        <Checkbox
          label="Incluir escala"
          checked={options.includeScale}
          onChange={(event) => {
            patch({ includeScale: event.currentTarget.checked });
          }}
        />
        <Checkbox
          label="Incluir el límite del AOI"
          checked={options.includeAoiOutline}
          onChange={(event) => {
            patch({ includeAoiOutline: event.currentTarget.checked });
          }}
        />
        <Checkbox
          label="Recortar al AOI"
          description="Encuadra la imagen en el área de estudio en vez del viewport completo."
          checked={options.clipToAoi}
          onChange={(event) => {
            patch({ clipToAoi: event.currentTarget.checked });
          }}
        />

        <SegmentedControl
          options={FORMATS}
          value={options.format}
          onChange={(format) => {
            patch({ format });
          }}
          ariaLabel="Formato de la imagen"
          className="mt-1"
        />
      </div>

      {error !== null && preview !== null ? <p className="text-11 text-warning">{error}</p> : null}

      <Button
        variant="primary"
        leadingIcon={<DownloadIcon size={14} />}
        disabled={preview === null}
        loading={busy}
        onClick={download}
      >
        Descargar imagen
      </Button>

      <p className="text-11 text-fg-muted">
        Una imagen no es un dato georreferenciado: no se puede medir ni superponer en un SIG. Para
        eso está la pestaña <span className="text-fg font-medium">Datos</span>.
      </p>
    </div>
  );
}
