import type { ThemeId } from '~/layers/types';
import type { Vista } from '~/layers/vistas';

import { Button } from '~/components/ui/button';
import { ChevronDown, DownloadIcon, ReportIcon } from '~/components/ui/icons';
import { Popover } from '~/components/ui/popover';
import { SegmentedControl } from '~/components/ui/segmented-control';
import { Select } from '~/components/ui/select';
import { formatBytes, formatHectares } from '~/lib/format';

export type AoiAction = 'ver' | 'reemplazar' | 'descargar' | 'borrar';

export type ExportJobChip = {
  jobId: string;
  done: number;
  total: number;
  /** Presente sólo cuando el bundle terminó. */
  sizeBytes?: number;
};

export type TopbarProps = {
  theme: ThemeId;
  /** `Riesgo RD` no llega acá si el AOI cae fuera de RD: se OCULTA, no se deshabilita (§3). */
  vistas: readonly Vista[];
  onThemeChange: (theme: ThemeId) => void;
  /** El control segmentado colapsa a desplegable entre 768 y 1023px (§9). */
  compactVistas: boolean;
  areaHa: number | null;
  onAoiAction: (action: AoiAction) => void;
  onReport: () => void;
  onExport: () => void;
  exportJob: ExportJobChip | null;
};

const NO_AOI_TOOLTIP = 'Dibujá o subí un AOI primero';

export function Topbar({
  theme,
  vistas,
  onThemeChange,
  compactVistas,
  areaHa,
  onAoiAction,
  onReport,
  onExport,
  exportJob,
}: TopbarProps) {
  const hasAoi = areaHa !== null;
  const options = vistas.map((vista) => ({
    id: vista.id,
    label: vista.label,
    hint: vista.hint,
  }));

  return (
    <header className="border-border-base bg-surface flex h-12 shrink-0 items-center gap-3 border-b px-3">
      <span className="text-13 text-fg w-40 shrink-0 truncate font-semibold">Territorio Base</span>

      <div className="flex flex-1 justify-center">
        {compactVistas ? (
          <label className="text-12 text-fg-muted flex items-center gap-2">
            Vista:
            <Select
              value={theme}
              onChange={(event) => {
                onThemeChange(event.target.value as ThemeId);
              }}
            >
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
          </label>
        ) : (
          <SegmentedControl
            ariaLabel="Vista"
            options={options}
            value={theme}
            onChange={onThemeChange}
          />
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Popover
          title="Acciones del AOI"
          width={220}
          trigger={(triggerProps) => (
            <button
              type="button"
              disabled={!hasAoi}
              className="tabular rounded-btn border-border-base text-12 text-fg flex h-8 items-center gap-1 border px-2 disabled:cursor-not-allowed disabled:opacity-45"
              {...triggerProps}
            >
              {hasAoi ? `AOI: ${formatHectares(areaHa)}` : 'Sin AOI'}
              <ChevronDown size={13} />
            </button>
          )}
        >
          <ul className="flex flex-col">
            {(
              [
                ['ver', 'Ver límites'],
                ['reemplazar', 'Reemplazar'],
                ['descargar', 'Descargar AOI'],
                ['borrar', 'Borrar'],
              ] as const
            ).map(([action, label]) => (
              <li key={action}>
                <button
                  type="button"
                  onClick={() => {
                    onAoiAction(action);
                  }}
                  className="rounded-btn text-12 text-fg hover:bg-surface-3 w-full px-2 py-1.5 text-left"
                >
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </Popover>

        <Button
          variant="secondary"
          disabled={!hasAoi}
          title={hasAoi ? undefined : NO_AOI_TOOLTIP}
          leadingIcon={<ReportIcon size={14} />}
          onClick={onReport}
        >
          Reporte
        </Button>

        {exportJob === null ? (
          <Button
            variant="primary"
            disabled={!hasAoi}
            title={hasAoi ? undefined : NO_AOI_TOOLTIP}
            leadingIcon={<DownloadIcon size={14} />}
            onClick={onExport}
          >
            Exportar
          </Button>
        ) : (
          /* §7.1 — el botón se vuelve un chip de progreso; el trabajo sobrevive
             navegación y recarga, así que nunca bloquea la UI. */
          <Button variant="primary" onClick={onExport} className="tabular">
            {exportJob.sizeBytes == null
              ? `Exportando… ${String(exportJob.done)}/${String(exportJob.total)}`
              : `Descargar (${formatBytes(exportJob.sizeBytes)})`}
          </Button>
        )}
      </div>
    </header>
  );
}
