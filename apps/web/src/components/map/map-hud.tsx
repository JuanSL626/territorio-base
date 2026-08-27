import { BASEMAPS, BASEMAP_ORDER } from './basemaps';

import type { DrawState } from './draw';
import type { ScaleBar } from './scale';
import type { BasemapId } from '~/layers/vistas';

import { formatHectares } from '~/lib/format';

/* -------------------------------------------------------------------------- */
/* Lectura de coordenadas, zoom y escala                                       */
/* -------------------------------------------------------------------------- */

export type MapReadoutProps = {
  coordinates: string;
  zoom: number;
  scale: ScaleBar;
};

/**
  Lectura permanente abajo a la derecha: coordenadas del cursor, zoom y barra
  de escala. Va a la derecha porque el cúmulo inferior IZQUIERDO del §2 ya
  tiene escala, atribución y leyenda compacta; duplicarlo del mismo lado sería
  ruido, y el usuario que dibuja necesita el número de coordenada cerca del
  cursor sin taparle el panel.
*/
export function MapReadout({ coordinates, zoom, scale }: MapReadoutProps) {
  // `bottom-8`: justo encima del control de atribución de MapLibre, que va
  // abajo a la derecha y cuyo texto es una exigencia del proveedor, no adorno.
  return (
    <div className="pointer-events-none absolute right-3 bottom-8 z-10 flex flex-col items-end gap-1">
      <div className="rounded-chip border-border-base bg-surface/90 flex items-center gap-2 border px-2 py-1 backdrop-blur-sm">
        <span
          aria-hidden="true"
          className="border-fg-muted h-2 border-r border-b border-l"
          style={{ width: `${String(Math.max(scale.widthPx, 8))}px` }}
        />
        <span className="tabular text-11 text-fg-muted">{scale.label}</span>
      </div>

      <p className="tabular text-11 text-fg-subtle bg-surface/80 rounded-chip px-2 py-0.5">
        <span className="sr-only">Coordenadas del cursor: </span>
        {coordinates}
        <span aria-hidden="true"> · z{zoom.toFixed(1)}</span>
        <span className="sr-only"> · nivel de zoom {zoom.toFixed(1)}</span>
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* HUD del modo dibujo (§8, estado "Drawing")                                  */
/* -------------------------------------------------------------------------- */

export type DrawingHudProps = {
  state: DrawState;
};

const DRAW_HINTS: Record<DrawState['mode'], string> = {
  polygon: 'Clic para agregar vértices · clic en el primer punto o Enter para cerrar',
  rectangle: 'Arrastrá para definir el rectángulo',
};

/**
 * Lectura de área EN VIVO siguiendo el cursor, más las teclas de escape. Es la
 * mitad del estado "Drawing" del §8 que no se puede pintar dentro del canvas
 * GL: el polígono, los vértices y el pulso del primero los dibuja `draw.ts`.
 */
export function DrawingHud({ state }: DrawingHudProps) {
  return (
    <>
      {state.cursor !== null ? (
        <span
          aria-hidden="true"
          className="rounded-chip bg-surface-inverse text-fg-inverse text-11 tabular pointer-events-none absolute z-30 px-1.5 py-0.5"
          style={{ left: state.cursor.x + 14, top: state.cursor.y + 14 }}
        >
          {state.areaHa === null ? '—' : formatHectares(state.areaHa)}
        </span>
      ) : null}

      <div
        role="status"
        aria-live="polite"
        className="rounded-panel border-border-base bg-surface shadow-popover text-12 text-fg-muted pointer-events-none absolute top-4 left-1/2 z-30 -translate-x-1/2 border px-3 py-2"
      >
        <p className="text-fg font-medium">
          {state.mode === 'polygon' ? 'Dibujando polígono' : 'Dibujando rectángulo'}
          {state.areaHa === null ? '' : ` — ${formatHectares(state.areaHa)}`}
        </p>
        <p>{DRAW_HINTS[state.mode]}</p>
        <p>Esc cancela · Retroceso deshace el último vértice</p>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Selector de mapa base                                                       */
/* -------------------------------------------------------------------------- */

export type BasemapSwitcherProps = {
  value: BasemapId;
  onChange: (next: BasemapId) => void;
  onClose: () => void;
};

/**
 * Los tres mapas base, todos SIN API key (ver `basemaps.ts`). Se ancla debajo
 * de la toolbar vertical del §2, que es donde vive su botón.
 */
export function BasemapSwitcher({ value, onChange, onClose }: BasemapSwitcherProps) {
  return (
    <div
      role="dialog"
      aria-label="Mapa base"
      className="rounded-panel border-border-base bg-surface shadow-popover absolute top-4 right-16 z-30 w-60 border p-2"
    >
      <p className="text-11 text-fg-subtle px-1 pb-1 font-semibold tracking-wide uppercase">
        Mapa base
      </p>
      <ul className="flex flex-col">
        {BASEMAP_ORDER.map((id) => {
          const basemap = BASEMAPS[id];
          return (
            <li key={id}>
              <button
                type="button"
                aria-pressed={value === id}
                onClick={() => {
                  onChange(id);
                  onClose();
                }}
                className={
                  value === id
                    ? 'rounded-btn bg-accent-soft text-accent text-12 flex w-full flex-col px-2 py-1.5 text-left font-medium'
                    : 'rounded-btn hover:bg-surface-3 text-12 text-fg flex w-full flex-col px-2 py-1.5 text-left'
                }
              >
                {basemap.label}
                <span className="text-11 text-fg-subtle">{basemap.attribution}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
