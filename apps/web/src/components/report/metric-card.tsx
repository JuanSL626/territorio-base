import type { ReactNode } from 'react';
import type { LayerDef } from '~/layers/types';

import { LegendDetail } from '~/components/layers/legend-swatch';
import { DownloadIcon, ExpandIcon, ExternalIcon, InfoIcon } from '~/components/ui/icons';
import { Popover } from '~/components/ui/popover';
import { getLayer } from '~/layers/registry';
import { cn } from '~/lib/cn';

/**
 * LA anatomía de tarjeta del §6.4, usada idéntica por todas las métricas.
 *
 *   ┌─────────────────────────────────────────────┐
 *   │ Título                        ⓘ  ⤢  ⤓      │  h 40, iconos de 28 px
 *   │ …contenido (barras, stats, tabla)…          │
 *   │ nota al pie de 12 px                        │
 *   └─────────────────────────────────────────────┘
 *
 * Las tres acciones no son decorativas:
 *  · **ⓘ** abre la cita de la capa — fuente, proveedor, vigencia, resolución,
 *    licencia y la FRASE DE MÉTODO. Sale entera del registro (§11): agregar la
 *    capa 40 no toca este archivo.
 *  · **⤢** manda el mapa pegajoso al estado de esa tarjeta. Es la misma
 *    coreografía declarativa de las secciones, disparada a mano.
 *  · **⤓** baja EXACTAMENTE el artefacto de esa capa. Cuando la corrida no lo
 *    produjo, el botón no desaparece: se deshabilita y dice por qué (§0.5,
 *    nada falla en silencio).
 */

export type CardDownload =
  | { kind: 'ready'; href: string; filename: string }
  | { kind: 'unavailable'; reason: string };

export type MetricCardProps = {
  title: string;
  /** Capa del registro que alimenta la tarjeta. Gobierna ⓘ y la leyenda. */
  layerId?: string;
  /** ⤢ — `undefined` oculta la acción (secciones sin capa en el mapa). */
  onShowOnMap?: () => void;
  download?: CardDownload;
  /** Nota al pie de 12 px. En los gráficos es el equivalente de texto. */
  footnote?: string;
  children: ReactNode;
  /** Vista de impresión: sin controles, sin popovers, sin foco. */
  print?: boolean;
  className?: string;
};

function CardInfoPopover({ layer }: { layer: LayerDef }) {
  const { source } = layer;

  return (
    <Popover
      title={`Fuente de ${layer.label}`}
      width={320}
      trigger={(triggerProps) => (
        <button
          type="button"
          aria-label={`Fuente y método de ${layer.label}`}
          title="Fuente y método"
          className="rounded-btn text-fg-muted hover:bg-surface-3 hover:text-fg flex h-7 w-7 items-center justify-center transition-colors"
          {...triggerProps}
        >
          <InfoIcon size={15} />
        </button>
      )}
    >
      <div className="flex flex-col gap-2">
        <h4 className="text-13 text-fg font-semibold">{layer.label}</h4>
        <LegendDetail legend={layer.legend} />

        <dl className="text-11 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-fg-subtle">Fuente</dt>
          <dd className="text-fg">
            {source.url.length > 0 ? (
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-accent inline-flex items-center gap-1 underline underline-offset-2"
              >
                {source.name}
                <ExternalIcon size={11} />
              </a>
            ) : (
              source.name
            )}
          </dd>
          <dt className="text-fg-subtle">Proveedor</dt>
          <dd className="text-fg">{source.provider}</dd>
          <dt className="text-fg-subtle">Vigencia</dt>
          <dd className="text-fg">{source.vintage}</dd>
          <dt className="text-fg-subtle">Resolución</dt>
          <dd className="text-fg">{source.resolution}</dd>
          <dt className="text-fg-subtle">Licencia</dt>
          <dd className="text-fg">{source.license}</dd>
        </dl>

        <p className="text-11 text-fg-muted">{source.method}</p>
        {source.caveat != null ? <p className="text-11 text-warning">{source.caveat}</p> : null}
      </div>
    </Popover>
  );
}

export function MetricCard({
  title,
  layerId,
  onShowOnMap,
  download,
  footnote,
  children,
  print = false,
  className,
}: MetricCardProps) {
  const layer = layerId === undefined ? undefined : getLayer(layerId);

  return (
    <article
      className={cn(
        'rounded-panel border-border-base bg-surface print-card border p-4',
        className,
      )}
    >
      <header className="flex h-10 items-center gap-1">
        <h3 className="text-15 text-fg min-w-0 flex-1 truncate font-semibold">{title}</h3>

        {print ? null : (
          <div className="no-print flex shrink-0 items-center gap-0.5">
            {layer === undefined ? null : <CardInfoPopover layer={layer} />}

            {onShowOnMap === undefined ? null : (
              <button
                type="button"
                aria-label={`Ver ${title} en el mapa`}
                title="Ver en el mapa"
                onClick={onShowOnMap}
                className="rounded-btn text-fg-muted hover:bg-surface-3 hover:text-fg flex h-7 w-7 items-center justify-center transition-colors"
              >
                <ExpandIcon size={15} />
              </button>
            )}

            {download === undefined ? null : download.kind === 'ready' ? (
              <a
                href={download.href}
                download={download.filename}
                aria-label={`Descargar ${download.filename}`}
                title={`Descargar ${download.filename}`}
                className="rounded-btn text-fg-muted hover:bg-surface-3 hover:text-fg flex h-7 w-7 items-center justify-center transition-colors"
              >
                <DownloadIcon size={15} />
              </a>
            ) : (
              <span
                aria-label={download.reason}
                title={download.reason}
                className="text-fg-subtle flex h-7 w-7 cursor-not-allowed items-center justify-center opacity-45"
              >
                <DownloadIcon size={15} />
              </span>
            )}
          </div>
        )}
      </header>

      <div className="mt-1">{children}</div>

      {footnote == null ? null : <p className="text-12 text-fg-muted mt-2">{footnote}</p>}
    </article>
  );
}
