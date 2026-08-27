import { useState } from 'react';

import type { SourceRef } from '~/layers/types';

import { Button, IconButton } from '~/components/ui/button';
import { ChevronLeft, ChevronRight, CloseIcon, ExternalIcon } from '~/components/ui/icons';
import { Tabs } from '~/components/ui/tabs';
import { formatNumber } from '~/lib/format';

export type InspectorField = {
  alias: string;
  value: string;
};

export type InspectorFeature = {
  layerId: string;
  layerLabel: string;
  featureId: string;
  title: string;
  subtitle?: string;
  fields: InspectorField[];
  /** Total de elementos de esa capa dentro del AOI: abre la vista de tabla. */
  layerFeatureCount: number;
  source: SourceRef;
};

export type InspectorCandidate = {
  layerId: string;
  layerLabel: string;
  count: number;
};

export type InspectorProps = {
  open: boolean;
  onClose: () => void;
  /** Un click que pega en >1 capa NUNCA elige ganador: muestra la pila (§5.1). */
  candidates: readonly InspectorCandidate[];
  feature: InspectorFeature | null;
  defaultTab: 'atributos' | 'fuente';
  onPickCandidate: (layerId: string) => void;
  onBack: () => void;
  onZoom: () => void;
  onDownload: () => void;
  onOpenTable: () => void;
};

const TABS = [
  { id: 'atributos', label: 'Atributos' },
  { id: 'fuente', label: 'Fuente' },
] as const;

/**
 * Inspector acoplado de 380px (§5.3), no un popup flotante anclado al click:
 * sobrevive el pan y el zoom, tiene lugar para acciones, y resuelve el caso
 * "el AOI intersecta 47 ríos" con el link a la tabla.
 */
export function Inspector({
  open,
  onClose,
  candidates,
  feature,
  defaultTab,
  onPickCandidate,
  onBack,
  onZoom,
  onDownload,
  onOpenTable,
}: InspectorProps) {
  const [tab, setTab] = useState<'atributos' | 'fuente'>(defaultTab);

  if (!open) return null;

  return (
    <aside
      aria-label="Detalle del elemento"
      className="border-border-base bg-surface flex w-95 shrink-0 flex-col border-l"
    >
      <div className="flex h-8 shrink-0 items-center justify-end px-2 pt-2">
        <IconButton label="Cerrar detalle" icon={<CloseIcon size={16} />} onClick={onClose} />
      </div>

      {candidates.length > 1 ? (
        <div className="border-border-base border-b">
          <p className="text-11 text-fg-subtle px-4 pb-1 font-semibold tracking-wide uppercase">
            Resultados
          </p>
          <ul>
            {candidates.map((candidate) => (
              <li key={candidate.layerId}>
                <button
                  type="button"
                  onClick={() => {
                    onPickCandidate(candidate.layerId);
                  }}
                  className="text-12 text-fg hover:bg-surface-3 flex h-8 w-full items-center gap-2 px-4 text-left"
                >
                  <span className="min-w-0 flex-1 truncate">{candidate.layerLabel}</span>
                  <span className="tabular text-fg-muted">{formatNumber(candidate.count, 0)}</span>
                  <ChevronRight size={13} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {feature === null ? (
        <p className="text-12 text-fg-muted p-4">
          Clickeá un elemento del mapa para ver sus atributos.
        </p>
      ) : (
        <>
          <div className="px-4 pb-3">
            {candidates.length > 1 ? (
              <button
                type="button"
                onClick={onBack}
                className="text-11 text-accent mb-1 inline-flex items-center gap-1 font-medium"
              >
                <ChevronLeft size={12} />
                Volver a los resultados
              </button>
            ) : null}
            <h2 className="text-18 text-fg font-semibold">{feature.title}</h2>
            {feature.subtitle != null ? (
              <p className="text-12 text-fg-muted mt-0.5">{feature.subtitle}</p>
            ) : null}
          </div>

          <Tabs
            items={TABS}
            value={tab}
            onChange={setTab}
            ariaLabel="Detalle del elemento"
            size="inspector"
          />

          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'atributos' ? (
              <dl className="divide-border-base divide-y">
                {feature.fields.map((field) => (
                  <div key={field.alias} className="flex min-h-8 items-center gap-3 px-4 py-1.5">
                    <dt className="text-12 text-fg-muted w-36 shrink-0">{field.alias}</dt>
                    <dd className="tabular text-13 text-fg min-w-0 flex-1">{field.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <div className="flex flex-col gap-2 p-4">
                <a
                  href={feature.source.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-13 text-accent inline-flex items-center gap-1 font-semibold underline underline-offset-2"
                >
                  {feature.source.name}
                  <ExternalIcon size={12} />
                </a>
                <p className="text-12 text-fg-muted">{feature.source.method}</p>
                <p className="text-11 text-fg-subtle">
                  {feature.source.vintage} · {feature.source.resolution} · {feature.source.license}
                </p>
                <p className="text-11 text-fg-subtle">{feature.source.citation}</p>
              </div>
            )}
          </div>

          <div className="border-border-base flex h-11 shrink-0 items-center gap-2 border-t px-4">
            <Button size="sm" variant="secondary" onClick={onZoom}>
              Zoom a la geometría
            </Button>
            <Button size="sm" variant="secondary" onClick={onDownload}>
              Descargar
            </Button>
          </div>

          <button
            type="button"
            onClick={onOpenTable}
            className="border-border-base text-11 text-fg-muted hover:text-fg flex h-9 shrink-0 items-center gap-1 border-t px-4 text-left"
          >
            Capa: {feature.layerLabel} — {formatNumber(feature.layerFeatureCount, 0)} elementos
            <ChevronRight size={12} />
          </button>
        </>
      )}
    </aside>
  );
}
