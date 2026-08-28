import type { LayerTable } from '~/components/map/map-canvas';

import { Dialog } from '~/components/ui/dialog';
import { formatNumber } from '~/lib/format';

/*
  Vista de tabla (§5.3). El inspector responde "¿qué es ESTE elemento?"; el
  link `Capa: {x} — N elementos` responde "el AOI intersecta 47 ríos,
  ¿cuáles?", que un panel de un feature por vez no puede contestar. Hasta
  ahora ese link era un `() => undefined`.

  Las columnas NO se inventan acá: son los alias que ya calculó
  `buildInspectorFeature`, los mismos campos y formato que muestra el
  inspector. Para MEPyD, que llega con `outFields="*"`, eso incluye las
  columnas dinámicas del servicio.
*/

/** Tope de filas que se dibujan. Una capa MEPyD puede traer miles. */
export const LAYER_TABLE_LIMIT = 200;

export type LayerTableDialogProps = {
  table: LayerTable | null;
  onClose: () => void;
};

function columnsOf(table: LayerTable): string[] {
  const seen = new Set<string>();
  const columns: string[] = [];
  for (const row of table.rows) {
    for (const field of row.fields) {
      if (seen.has(field.alias)) continue;
      seen.add(field.alias);
      columns.push(field.alias);
    }
  }
  return columns;
}

export function LayerTableDialog({ table, onClose }: LayerTableDialogProps) {
  if (table === null) return null;

  const columns = columnsOf(table);
  const shown = table.rows.length;

  return (
    <Dialog
      open
      onClose={onClose}
      width={860}
      title={table.layerLabel}
      description={`${formatNumber(table.total, 0)} elemento(s) dentro del AOI`}
    >
      {columns.length === 0 || shown === 0 ? (
        <p className="text-12 text-fg-muted">Sin atributos.</p>
      ) : (
        <>
          <div className="border-border-base rounded-panel overflow-x-auto border">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-surface-2">
                  <th className="text-11 text-fg-subtle px-2 py-1.5 font-semibold">#</th>
                  {columns.map((column) => (
                    <th
                      key={column}
                      scope="col"
                      className="text-11 text-fg-subtle px-2 py-1.5 font-semibold whitespace-nowrap"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, index) => {
                  const byAlias = new Map(row.fields.map((field) => [field.alias, field.value]));
                  return (
                    <tr key={row.featureId} className="border-border-base/60 border-t">
                      <td className="tabular text-11 text-fg-subtle px-2 py-1.5">{index + 1}</td>
                      {columns.map((column) => (
                        <td
                          key={column}
                          className="text-12 text-fg max-w-70 truncate px-2 py-1.5"
                          title={byAlias.get(column) ?? '—'}
                        >
                          {byAlias.get(column) ?? '—'}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {table.total > shown ? (
            <p className="text-11 text-fg-muted mt-2">
              Mostrando {formatNumber(shown, 0)} de {formatNumber(table.total, 0)} elementos. La
              tabla completa viaja en la exportación.
            </p>
          ) : null}
        </>
      )}
    </Dialog>
  );
}
