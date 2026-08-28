import { IconButton } from '~/components/ui/button';
import { BasemapIcon, DrawIcon, LocateIcon, UploadIcon } from '~/components/ui/icons';

export type MapTool = 'dibujar' | 'subir' | 'basemap' | 'ubicacion';

export type MapToolbarProps = {
  activeTool: MapTool | null;
  hasAoi: boolean;
  onTool: (tool: MapTool) => void;
};

/**
 * Toolbar vertical arriba a la derecha (§2), independiente del sidebar: el AOI
 * es un objeto de primera clase, no un input de una capa. Los dos primeros
 * botones llevan etiqueta visible de 11px — esta audiencia no recibe controles
 * primarios sólo-icono (§13).
 *
 * `Medir` y `Comparar capas` NO están: existían, se marcaban `aria-pressed` y
 * no hacían absolutamente nada — ni medición, ni cortina de comparación, ni
 * consumidor en `map-canvas`. Un botón que se ilumina y no ejecuta nada le
 * enseña a la gente a desconfiar del resto de la barra, así que se quitan
 * hasta que haya implementación detrás.
 */
export function MapToolbar({ activeTool, hasAoi, onTool }: MapToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label="Herramientas del mapa"
      aria-orientation="vertical"
      className="pointer-events-auto absolute top-4 right-4 z-20 flex flex-col gap-2"
    >
      <IconButton
        label="Dibujar AOI"
        showLabel
        variant="secondary"
        icon={<DrawIcon size={18} />}
        aria-pressed={activeTool === 'dibujar'}
        className={activeTool === 'dibujar' ? 'border-accent text-accent' : undefined}
        onClick={() => {
          onTool('dibujar');
        }}
      />
      <IconButton
        label="Subir AOI"
        showLabel
        variant="secondary"
        icon={<UploadIcon size={18} />}
        onClick={() => {
          onTool('subir');
        }}
      />
      <IconButton
        label="Cambiar mapa base"
        variant="secondary"
        icon={<BasemapIcon size={18} />}
        className="h-10 w-10"
        onClick={() => {
          onTool('basemap');
        }}
      />
      <IconButton
        label="Zoom al AOI"
        variant="secondary"
        icon={<LocateIcon size={18} />}
        className="h-10 w-10"
        disabled={!hasAoi}
        onClick={() => {
          onTool('ubicacion');
        }}
      />
    </div>
  );
}
