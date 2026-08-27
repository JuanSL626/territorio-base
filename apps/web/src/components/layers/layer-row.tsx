import { useState } from 'react';

import { LayerInfoPopover } from './layer-info-popover';
import { LegendSwatch } from './legend-swatch';

import type { LayerDef, LayerStatus } from '~/layers/types';

import { LayerStatusChip } from '~/components/states/layer-status';
import { IconButton } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import { ChartIcon, CloseIcon, GripIcon, OpacityIcon, PinIcon } from '~/components/ui/icons';
import { Slider } from '~/components/ui/slider';
import { cn } from '~/lib/cn';
import { formatNumber } from '~/lib/format';

export type LayerRuntime = {
  status: LayerStatus;
  /** Razón corta del chip: "sin AOI", "sin escenas S2", "servicio caído". */
  reason?: string;
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
  thresholds: number[] | undefined;
  onToggle: (next: boolean) => void;
  onOpacityChange: (value: number) => void;
  onRemove: () => void;
  onDownload: () => void;
  onRetry: () => void;
  onThresholdChange: (thresholdId: string, values: number[]) => void;
};

/**
 * Fila de capa de 48px con el orden de controles FIJO del §4.3:
 *   ⠿ handle · muestra · checkbox+etiqueta · (espaciador) · ⓘ · ◐ · ✕
 * El slider de opacidad aparece como sub-fila de 32px debajo, no flotando.
 */
export function LayerRow({
  layer,
  checked,
  opacity,
  runtime,
  pinned,
  canDownload,
  touch,
  thresholds,
  onToggle,
  onOpacityChange,
  onRemove,
  onDownload,
  onRetry,
  onThresholdChange,
}: LayerRowProps) {
  const [opacityOpen, setOpacityOpen] = useState(false);
  const [thresholdsOpen, setThresholdsOpen] = useState(false);

  const unavailable = runtime.status === 'error' || runtime.status === 'skipped';
  const locked = layer.alwaysOn === true;

  return (
    <div
      className={cn(
        'border-border-base/60 border-b last:border-b-0',
        unavailable ? 'opacity-70' : null,
      )}
    >
      <div className="flex h-12 items-center gap-2 pr-2 pl-3">
        <span
          aria-hidden="true"
          className="text-fg-subtle shrink-0 cursor-grab"
          title="Arrastrar para reordenar (z-order)"
        >
          <GripIcon size={14} />
        </span>

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
          <LayerStatusChip status={runtime.status} reason={runtime.reason} onRetry={onRetry} />
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

      {layer.thresholds != null && layer.thresholds.length > 0 ? (
        <div className="pr-3 pb-2 pl-8">
          <button
            type="button"
            aria-expanded={thresholdsOpen}
            onClick={() => {
              setThresholdsOpen((value) => !value);
            }}
            className="text-11 text-accent font-medium underline underline-offset-2"
          >
            {thresholdsOpen ? 'Ocultar cortes de clase' : 'Editar cortes de clase'}
          </button>

          {thresholdsOpen
            ? layer.thresholds.map((threshold) => {
                const values = thresholds ?? threshold.defaults;
                return (
                  <div key={threshold.id} className="mt-2 flex flex-col gap-1">
                    <span className="text-11 text-fg-muted font-medium">{threshold.label}</span>
                    {values.map((value, index) => (
                      <Slider
                        key={`${threshold.id}-${String(index)}`}
                        label={`${threshold.label} — corte ${String(index + 1)}`}
                        value={value}
                        min={threshold.min}
                        max={threshold.max}
                        step={threshold.step}
                        withStepper={touch}
                        format={(current) =>
                          `${formatNumber(current, threshold.step < 1 ? 2 : 0)}${threshold.unit}`
                        }
                        onChange={(next) => {
                          const updated = [...values];
                          updated[index] = next;
                          onThresholdChange(threshold.id, updated);
                        }}
                      />
                    ))}
                    <p className="text-11 text-fg-subtle">{threshold.help}</p>
                  </div>
                );
              })
            : null}
        </div>
      ) : null}
    </div>
  );
}
