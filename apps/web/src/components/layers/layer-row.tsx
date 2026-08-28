import { useState } from 'react';

import { LayerInfoPopover } from './layer-info-popover';
import { LegendSwatch } from './legend-swatch';

import type { LayerDef, LayerStatus } from '~/layers/types';

import { LayerStatusChip } from '~/components/states/layer-status';
import { IconButton } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import { ChartIcon, CloseIcon, OpacityIcon, PinIcon } from '~/components/ui/icons';
import { Slider } from '~/components/ui/slider';
import { cn } from '~/lib/cn';
import { formatNumber } from '~/lib/format';

export type LayerRuntime = {
  status: LayerStatus;
  /**
   * Razón CORTA del chip: "sin AOI", "sin datos", "sin escenas S2". Corta en
   * serio — la fila mide 48 px y la etiqueta de la capa tiene prioridad sobre
   * el chip; un motivo largo deja el nombre de la capa en "Ame…".
   */
  reason?: string;
  /** La explicación completa, como `title` del chip. Sin límite de largo. */
  detail?: string;
  featureCount?: number;
};

export type LayerRowProps = {
  layer: LayerDef;
  checked: boolean;
  opacity: number;
  runtime: LayerRuntime;
  pinned: boolean;
  canDownload: boolean;
  /** Sliders con stepper numérico por debajo de 1024px (§9). */
  touch: boolean;
  onToggle: (next: boolean) => void;
  onOpacityChange: (value: number) => void;
  onRemove: () => void;
  onDownload: () => void;
  onRetry: () => void;
};

/**
 * Fila de capa de 48px con el orden de controles FIJO del §4.3:
 *   muestra · checkbox+etiqueta · (espaciador) · ⓘ · ◐ · ✕
 * El slider de opacidad aparece como sub-fila de 32px debajo, no flotando.
 *
 * NO hay handle de reordenar ni editor de cortes de clase, y es deliberado:
 *   · el ⠿ prometía arrastrar para cambiar el z-order y no había ningún drag
 *     implementado detrás — un asa que no agarra nada;
 *   · los cortes de clase editables guardaban un número y no reclasificaban
 *     nada: las capas clasificadas llegan como PNG YA rasterizado por el
 *     servicio (ver la nota de `slope-classes` en `layer-runtime.ts`), así que
 *     el cliente no tiene los valores por píxel con los que reclasificar.
 * Un control visible que no hace nada es peor que un control ausente: promete
 * una capacidad que el sistema no tiene.
 */
export function LayerRow({
  layer,
  checked,
  opacity,
  runtime,
  pinned,
  canDownload,
  touch,
  onToggle,
  onOpacityChange,
  onRemove,
  onDownload,
  onRetry,
}: LayerRowProps) {
  const [opacityOpen, setOpacityOpen] = useState(false);

  const unavailable = runtime.status === 'error' || runtime.status === 'skipped';
  const locked = layer.alwaysOn === true;

  return (
    <div
      data-testid={`layer-row-${layer.id}`}
      className={cn(
        'border-border-base/60 border-b last:border-b-0',
        unavailable ? 'opacity-70' : null,
      )}
    >
      <div className="flex h-12 items-center gap-2 pr-2 pl-3">
        <LegendSwatch legend={layer.legend} />

        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <Checkbox
            checked={checked}
            disabled={unavailable || locked}
            label={
              <span className="flex items-center gap-1.5" title={layer.label}>
                <span className="truncate">{layer.label}</span>
                {layer.role === 'medicion' ? (
                  <span
                    className="text-fg-subtle shrink-0"
                    title="Medición: genera datos en el reporte"
                  >
                    <ChartIcon size={11} />
                  </span>
                ) : null}
                {pinned ? (
                  <span
                    className="text-accent shrink-0"
                    title="Prendida a mano: sobrevive el cambio de vista"
                  >
                    <PinIcon size={11} />
                  </span>
                ) : null}
              </span>
            }
            onChange={(event) => {
              onToggle(event.target.checked);
            }}
          />
        </span>

        {runtime.status === 'ok' && runtime.featureCount != null ? (
          <span className="tabular text-11 text-fg-subtle shrink-0">
            {formatNumber(runtime.featureCount, 0)}
          </span>
        ) : (
          <LayerStatusChip
            status={runtime.status}
            reason={runtime.reason}
            detail={runtime.detail}
            onRetry={onRetry}
          />
        )}

        <LayerInfoPopover layer={layer} canDownload={canDownload} onDownload={onDownload} />

        <IconButton
          label={`Opacidad de ${layer.label}`}
          icon={<OpacityIcon size={15} />}
          aria-expanded={opacityOpen}
          className={opacityOpen ? 'bg-surface-3 text-fg' : undefined}
          onClick={() => {
            setOpacityOpen((value) => !value);
          }}
        />

        {layer.removable ? (
          <IconButton
            label={`Quitar ${layer.label}`}
            icon={<CloseIcon size={15} />}
            onClick={onRemove}
          />
        ) : null}
      </div>

      {opacityOpen ? (
        <div className="px-3 pb-2">
          <Slider
            label={`Opacidad de ${layer.label}`}
            value={opacity}
            disabled={!checked}
            withStepper={touch}
            onChange={onOpacityChange}
          />
        </div>
      ) : null}
    </div>
  );
}
