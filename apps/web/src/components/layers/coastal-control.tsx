import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { LayerInfoPopover } from './layer-info-popover';

import type { LayerRuntime } from './layer-row';
import type { CoastalPreset } from '@territorio/api-client';
import type { LayerDef } from '~/layers/types';
import type { CoastalRun } from '~/lib/analysis-contract';

import { coastalConclusions, type ConclusionTone } from '~/components/report/narrative';
import { LayerStatusChip } from '~/components/states/layer-status';
import { Checkbox } from '~/components/ui/checkbox';
import { AlertIcon, CheckIcon, InfoIcon, SpinnerIcon } from '~/components/ui/icons';
import { Select } from '~/components/ui/select';
import { Slider } from '~/components/ui/slider';
import { analysisKeys, useCoastalPresets, useRequestCoastal } from '~/lib/analysis-queries';

/*
  ─────────────────────────────────────────────────────────────────────────────
  INUNDACIÓN COSTERA (WRI Aqueduct) — UC-24/UC-25, legacy TC-26..TC-31
  ─────────────────────────────────────────────────────────────────────────────
  Es la única capa del registro que NO sale del análisis inicial: se calcula
  bajo demanda por escenario, porque cada preset es una lectura distinta de un
  GeoTIFF global. Sin este control la capa `aqueduct` era inalcanzable —
  aparecía en el panel con el chip "elegí escenario" y no había ningún lugar
  donde elegirlo.

  Tres decisiones:

  1. **Los 5 presets son strings exactos del contrato** (`COASTAL_PRESETS`), no
     etiquetas que este componente inventa. Se piden al motor
     (`useCoastalPresets`) y el contrato local es el respaldo si está caído.

  2. **La caché es por preset** (`analysisKeys.coastal(id, preset)`, con
     `staleTime: Infinity`). Volver a un escenario ya visitado no dispara
     spinner ni round trip — TC-31, que era una queja explícita del legacy.

  3. **Los tres mensajes de resultado son los del reporte**
     (`coastalConclusions`), no una segunda redacción. "No hay cobertura",
     "sin inundación proyectada" y el porcentaje con profundidad máxima tienen
     que decir LO MISMO en el panel y en el reporte, o una de las dos miente.
*/

export type CoastalControlProps = {
  /** La capa `aqueduct` del registro: de ahí salen etiqueta, leyenda y fuente. */
  layer: LayerDef;
  runtime: LayerRuntime;
  /** Id del análisis. Sin él no hay a qué adjuntarle el escenario. */
  analysisId: string | undefined;
  /** La capa `aqueduct` está prendida en el mapa. */
  visible: boolean;
  opacity: number;
  onToggleVisible: (next: boolean) => void;
  onOpacityChange: (value: number) => void;
  onDownload: () => void;
  /** Sliders con stepper por debajo de 1024px (§9). */
  touch?: boolean;
};

const TONE_CLASS: Record<ConclusionTone, string> = {
  danger: 'text-danger',
  warning: 'text-warning',
  success: 'text-success',
  info: 'text-info',
  neutral: 'text-fg-muted',
};

function ToneIcon({ tone }: { tone: ConclusionTone }) {
  if (tone === 'success') return <CheckIcon size={13} />;
  if (tone === 'neutral' || tone === 'info') return <InfoIcon size={13} />;
  return <AlertIcon size={13} />;
}

export function CoastalControl({
  layer,
  runtime,
  analysisId,
  visible,
  opacity,
  onToggleVisible,
  onOpacityChange,
  onDownload,
  touch = false,
}: CoastalControlProps) {
  const [preset, setPreset] = useState<CoastalPreset | null>(null);
  const presets = useCoastalPresets();
  const request = useRequestCoastal();

  const enabled = visible && analysisId !== undefined && preset !== null;

  /*
    La query es la dueña de la caché por preset; el fetch lo hace la mutación
    existente, que además invalida el análisis para que el overlay y el reporte
    incorporen el escenario recién calculado (en el legacy la costera vivía en
    `session_state` y nunca llegaba al reporte — inventario §9).
  */
  const scenario = useQuery<CoastalRun>({
    // Misma forma que `analysisKeys.coastal(id, preset)`: la mutación escribe
    // en esta ranura y la query la lee. Con `preset` sin elegir la query está
    // deshabilitada, así que la clave nunca se usa.
    queryKey: [...analysisKeys.coastals(), analysisId ?? '', preset ?? ''],
    queryFn: async (): Promise<CoastalRun> => {
      if (analysisId === undefined || preset === null) throw new Error('Falta el escenario.');
      const result = await request.mutateAsync({ analysisId, preset });
      if (!result.ok) throw new Error(result.message);
      return result.coastal;
    },
    enabled,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
  });

  const conclusions = scenario.data === undefined ? [] : coastalConclusions(scenario.data);

  return (
    <div
      data-testid="coastal-control"
      className="border-border-base/60 flex flex-col gap-2 border-b px-3 py-3 last:border-b-0"
    >
      {/* Reemplaza a la fila genérica de la capa: mismo checkbox, mismo chip
          de estado y misma ⓘ, más lo que sólo esta capa necesita. */}
      <div className="flex items-center gap-2">
        <span className="flex min-w-0 flex-1">
          <Checkbox
            checked={visible}
            label={layer.label}
            onChange={(event) => {
              onToggleVisible(event.target.checked);
            }}
          />
        </span>
        <LayerStatusChip status={runtime.status} reason={runtime.reason} detail={runtime.detail} />
        <LayerInfoPopover
          layer={layer}
          canDownload={analysisId !== undefined}
          onDownload={onDownload}
        />
      </div>

      <label className="text-11 text-fg-muted flex flex-col gap-1">
        Escenario
        <Select
          data-testid="coastal-preset"
          aria-label="Escenario de inundación costera"
          disabled={!visible || analysisId === undefined}
          value={preset ?? ''}
          className="w-full"
          onChange={(event) => {
            const value = event.target.value;
            setPreset(value === '' ? null : (value as CoastalPreset));
          }}
        >
          <option value="">Elegí un escenario…</option>
          {(presets.data ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      </label>

      <Slider
        label={`Opacidad de ${layer.label}`}
        value={opacity}
        disabled={!visible}
        withStepper={touch}
        onChange={onOpacityChange}
      />

      {analysisId === undefined ? (
        <p className="text-11 text-fg-subtle">
          Dibujá o subí una zona de estudio para pedir un escenario.
        </p>
      ) : null}

      {enabled && scenario.isFetching ? (
        <p
          role="status"
          data-testid="coastal-status"
          className="text-11 text-fg-muted flex items-center gap-1.5"
        >
          <SpinnerIcon size={12} />
          Descargando inundación costera ({preset})…
        </p>
      ) : null}

      {scenario.isError && !scenario.isFetching ? (
        <p role="status" data-testid="coastal-status" className="text-11 text-danger">
          {scenario.error.message}
        </p>
      ) : null}

      {!scenario.isFetching && conclusions.length > 0 ? (
        <ul data-testid="coastal-status" className="flex flex-col gap-1.5">
          {conclusions.map((conclusion) => (
            <li
              key={conclusion.id}
              className={`text-11 flex items-start gap-1.5 ${TONE_CLASS[conclusion.tone]}`}
            >
              <span className="mt-0.5 shrink-0">
                <ToneIcon tone={conclusion.tone} />
              </span>
              <span>{conclusion.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
