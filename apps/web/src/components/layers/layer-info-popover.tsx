import { LegendDetail } from './legend-swatch';

import type { LayerDef } from '~/layers/types';

import { Button } from '~/components/ui/button';
import { DownloadIcon, ExternalIcon, InfoIcon } from '~/components/ui/icons';
import { Popover } from '~/components/ui/popover';

export type LayerInfoPopoverProps = {
  layer: LayerDef;
  canDownload: boolean;
  onDownload: () => void;
};

export function LayerInfoPopover({ layer, canDownload, onDownload }: LayerInfoPopoverProps) {
  const { source } = layer;

  return (
    <Popover
      title={`Información de ${layer.label}`}
      trigger={(triggerProps) => (
        <button
          type="button"
          aria-label={`Información de ${layer.label}`}
          title={`Información de ${layer.label}`}
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

        <Button
          size="sm"
          variant="secondary"
          fullWidth
          disabled={!canDownload}
          title={canDownload ? undefined : 'Dibujá o subí un AOI primero'}
          leadingIcon={<DownloadIcon size={13} />}
          onClick={onDownload}
        >
          Descargar esta capa recortada al AOI
        </Button>
      </div>
    </Popover>
  );
}
