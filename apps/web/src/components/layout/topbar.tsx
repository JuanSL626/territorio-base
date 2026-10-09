import type { ThemeId } from '~/layers/types';
import type { Vista } from '~/layers/vistas';

import { Button, IconButton } from '~/components/ui/button';
import { ChevronDown, CloseIcon, DownloadIcon, ReportIcon, UserIcon } from '~/components/ui/icons';
import { Popover } from '~/components/ui/popover';
import { SegmentedControl } from '~/components/ui/segmented-control';
import { Select } from '~/components/ui/select';
import { formatBytes, formatHectares } from '~/lib/format';

export type AoiAction = 'ver' | 'reemplazar' | 'descargar' | 'borrar';

export type ExportJobChip = {
  jobId: string;
  done: number;
  total: number;
  sizeBytes?: number;
};

export type TopbarUser = {
  name: string | null;
  email: string;
};

export type TopbarProps = {
  theme: ThemeId;
  /** `Riesgo RD` no llega acá si el AOI cae fuera de RD: se OCULTA, no se deshabilita (§3). */
  vistas: readonly Vista[];
  onThemeChange: (theme: ThemeId) => void;
  /** El control segmentado colapsa a desplegable entre 768 y 1023px (§9). */
  compactVistas: boolean;
  /**
   * Hay una zona de estudio (haya terminado o no de analizarse). Es distinto de
   * `areaHa !== null`: entre que se cierra el polígono y que el motor devuelve
   * el resultado hay un AOI real cuya superficie todavía no se conoce, y
   * deshabilitar el chip durante esos segundos hacía que la app pareciera
   * "sin AOI" para siempre.
   */
  hasAoi: boolean;
  areaHa: number | null;
  analysisReady: boolean;
  onAoiAction: (action: AoiAction) => void;
  onReport: () => void;
  onExport: () => void;
  exportJob: ExportJobChip | null;
  user?: TopbarUser | null;
  onSignOut?: () => void;
  signingOut?: boolean;
};

const NO_AOI_TOOLTIP = 'Dibujá o subí un AOI primero';
const RUNNING_TOOLTIP = 'El análisis todavía no terminó';

export function Topbar({
  theme,
  vistas,
  onThemeChange,
  compactVistas,
  hasAoi,
  areaHa,
  analysisReady,
  onAoiAction,
  onReport,
  onExport,
  exportJob,
  user = null,
  onSignOut,
  signingOut = false,
}: TopbarProps) {
  const options = vistas.map((vista) => ({
    id: vista.id,
    label: vista.label,
    hint: vista.hint,
  }));

  /*
    Dos motivos distintos para el mismo `disabled`, y el tooltip dice CUÁL: sin
    AOI no hay nada que reportar; con el análisis corriendo lo que falta es
    esperar. Un único "Dibujá o subí un AOI primero" sobre un AOI ya dibujado
    era, literalmente, información falsa.
  */
  const blocked = !hasAoi || !analysisReady;
  const blockedTooltip = !hasAoi ? NO_AOI_TOOLTIP : RUNNING_TOOLTIP;

  const aoiLabel = !hasAoi
    ? 'Sin AOI'
    : areaHa === null
      ? 'AOI: calculando…'
      : `AOI: ${formatHectares(areaHa)}`;

  return (
    <header className="border-border-base bg-surface flex h-12 shrink-0 items-center gap-1 border-b px-2 lg:gap-3 lg:px-3">
      <span className="text-13 text-fg w-7 shrink-0 font-semibold lg:w-40">
        <span className="lg:hidden">TB</span>
        <span className="hidden lg:inline">Territorio Base</span>
      </span>

      <div className="flex min-w-0 flex-1 justify-center">
        {compactVistas ? (
          <label className="text-12 text-fg-muted flex min-w-0 flex-1 items-center justify-center gap-2">
            <span className="sr-only">Vista:</span>
            <Select
              value={theme}
              aria-label="Vista"
              className="max-w-44 min-w-0 flex-1"
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

      <div className="flex shrink-0 items-center gap-1 lg:gap-2">
        <Popover
          title="Acciones del AOI"
          width={220}
          trigger={(triggerProps) => (
            <button
              type="button"
              disabled={!hasAoi}
              data-testid="aoi-chip"
              className="tabular rounded-btn border-border-base text-12 text-fg flex h-8 items-center gap-1 border px-2 disabled:cursor-not-allowed disabled:opacity-45 [@media(pointer:coarse)]:h-11"
              {...triggerProps}
            >
              <span className="lg:hidden">AOI</span>
              <span className="hidden lg:inline">{aoiLabel}</span>
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

        {hasAoi ? (
          <IconButton
            label="Eliminar AOI y reiniciar análisis"
            variant="secondary"
            icon={<CloseIcon size={14} />}
            className="[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
            onClick={() => {
              onAoiAction('borrar');
            }}
          />
        ) : null}

        <Button
          variant="secondary"
          aria-label="Abrir reporte"
          disabled={blocked}
          title={blocked ? blockedTooltip : undefined}
          leadingIcon={<ReportIcon size={14} />}
          className="hidden px-2 sm:inline-flex lg:px-3 [@media(pointer:coarse)]:h-11"
          onClick={onReport}
        >
          <span className="hidden lg:inline">Reporte</span>
        </Button>

        {exportJob === null ? (
          <Button
            variant="primary"
            disabled={blocked}
            title={blocked ? blockedTooltip : undefined}
            aria-label="Exportar"
            leadingIcon={<DownloadIcon size={14} />}
            className="px-2 lg:px-3 [@media(pointer:coarse)]:h-11"
            onClick={onExport}
          >
            <span className="hidden lg:inline">Exportar</span>
          </Button>
        ) : (
          /* §7.1 — el botón se vuelve un chip de progreso; el trabajo sobrevive
             navegación y recarga, así que nunca bloquea la UI. */
          <Button
            variant="primary"
            aria-label="Ver exportación"
            leadingIcon={<DownloadIcon size={14} />}
            onClick={onExport}
            className="tabular px-2 lg:px-3 [@media(pointer:coarse)]:h-11"
          >
            <span className="hidden lg:inline">
              {exportJob.sizeBytes == null
                ? `Exportando… ${String(exportJob.done)}/${String(exportJob.total)}`
                : `Descargar (${formatBytes(exportJob.sizeBytes)})`}
            </span>
          </Button>
        )}

        {/* §12 y N-20: cerrar sesión tiene que existir en la pantalla donde se
            trabaja. Vive en el topbar porque es la única barra presente en
            TODAS las rutas autenticadas. */}
        {user === null ? null : (
          <Popover
            title="Cuenta"
            width={240}
            trigger={(triggerProps) => (
              <IconButton
                label="Cuenta"
                variant="secondary"
                icon={<UserIcon size={15} />}
                className="[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
                data-testid="user-menu"
                {...triggerProps}
              />
            )}
          >
            <p className="text-12 text-fg truncate font-medium">{user.name ?? user.email}</p>
            <p className="text-11 text-fg-muted truncate">{user.email}</p>
            <Button
              variant="secondary"
              fullWidth
              loading={signingOut}
              className="mt-3"
              onClick={onSignOut}
            >
              Cerrar sesión
            </Button>
          </Popover>
        )}
      </div>
    </header>
  );
}
