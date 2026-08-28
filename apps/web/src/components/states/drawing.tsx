import { formatHectares } from '~/lib/format';

export type DrawingHudProps = {
  /** Área en vivo mientras se dibuja; `null` hasta que hay 3 vértices. */
  areaHa: number | null;
  vertexCount: number;
  onCancel: () => void;
};

export function DrawingHud({ areaHa, vertexCount, onCancel }: DrawingHudProps) {
  return (
    <div
      aria-live="polite"
      className="rounded-panel border-border-base bg-surface shadow-popover pointer-events-auto flex items-center gap-3 border px-3 py-2"
    >
      <span className="tabular text-13 text-fg font-semibold">
        {areaHa === null ? 'Marcá el primer vértice' : formatHectares(areaHa)}
      </span>
      <span className="text-11 text-fg-muted">
        {vertexCount > 2
          ? 'Clic en el primer vértice para cerrar'
          : `${String(vertexCount)} vértice(s)`}
      </span>
      <span className="bg-border-base h-4 w-px" aria-hidden="true" />
      <span className="text-11 text-fg-muted">Esc cancela · Retroceso deshace</span>
      <button
        type="button"
        onClick={onCancel}
        className="text-11 text-accent font-semibold underline underline-offset-2"
      >
        Cancelar
      </button>
    </div>
  );
}
