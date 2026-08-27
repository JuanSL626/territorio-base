import { Button } from '~/components/ui/button';
import { AlertIcon } from '~/components/ui/icons';
import { formatHectares } from '~/lib/format';

export type AoiSizeVerdict = 'ok' | 'warn' | 'block';

export function verdictForArea(areaHa: number): AoiSizeVerdict {
  if (areaHa <= 500) return 'ok';
  if (areaHa <= 2000) return 'warn';
  return 'block';
}

export type AoiSizeGuardProps = {
  areaHa: number;
  onProceed: () => void;
  onDowngradeResolution: () => void;
  onSplit: () => void;
};

/**
 * Guardia de tamaño del §7.4, ANTES de que arranque cualquier trabajo:
 *   ≤500 ha  → sigue en silencio,
 *   500-2000 → aviso con el costo estimado y una alternativa concreta,
 *   >2000    → bloquea el S2 a 10 m por default y explica por qué ANTES del
 *              click, nunca como timeout post-hoc.
 */
export function AoiSizeGuard({
  areaHa,
  onProceed,
  onDowngradeResolution,
  onSplit,
}: AoiSizeGuardProps) {
  const verdict = verdictForArea(areaHa);
  if (verdict === 'ok') return null;

  return (
    <div className="rounded-panel border-warning bg-warning-soft text-warning border p-4">
      <div className="flex items-center gap-2">
        <AlertIcon size={16} />
        <p className="text-13 font-semibold">
          {verdict === 'warn'
            ? `AOI grande (${formatHectares(areaHa, 0)})`
            : `AOI muy grande (${formatHectares(areaHa, 0)})`}
        </p>
      </div>

      <p className="text-12 mt-1">
        {verdict === 'warn'
          ? 'El análisis Sentinel-2 a 10 m puede tardar ~4 min.'
          : 'Arriba de 2 000 ha el compuesto Sentinel-2 a 10 m no se corre por defecto: tarda demasiado y suele fallar por timeout.'}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {verdict === 'warn' ? (
          <Button size="sm" variant="secondary" onClick={onProceed}>
            Analizar igual
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" onClick={onDowngradeResolution}>
          Bajar NDVI a 20 m
        </Button>
        {verdict === 'block' ? (
          <Button size="sm" variant="secondary" onClick={onSplit}>
            Dividir el AOI
          </Button>
        ) : null}
      </div>
    </div>
  );
}
