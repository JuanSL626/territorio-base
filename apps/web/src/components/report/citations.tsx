import type { DatasetUsage } from './report-model';

import { ExternalIcon } from '~/components/ui/icons';
import { getLayer } from '~/layers/registry';

/**
 * Citación en DOS capas, las dos obligatorias (§6.5):
 *
 *  (a) `SectionCitations` — al pie de cada sección, la cita de las capas que
 *      esa sección usó, con su caveat. Visible, no detrás de un click.
 *  (b) `SourcesTable` — la tabla fija del final, con UNA FILA POR DATASET
 *      EFECTIVAMENTE USADO en esta corrida, más la nota de los que no
 *      respondieron.
 *
 * El popover ⓘ de cada tarjeta es un tercer acceso, de conveniencia. Un reporte
 * que se usa para due diligence no puede tener la atribución sólo ahí: si hay
 * que hacer click para ver de dónde salió un número, la atribución no existe.
 *
 * Todo sale del registro de capas (§11). Ninguna cita está escrita a mano acá.
 */

export function SectionCitations({ layerIds }: { layerIds: readonly string[] }) {
  const seen = new Set<string>();
  const sources = layerIds
    .map((id) => getLayer(id)?.source)
    .filter((source) => source !== undefined)
    .filter((source) => {
      if (seen.has(source.name)) return false;
      seen.add(source.name);
      return true;
    });

  if (sources.length === 0) return null;

  return (
    <div className="border-border-base print-card border-t pt-3">
      <h4 className="text-11 text-fg-subtle font-semibold tracking-wide uppercase">
        Fuente de esta sección
      </h4>
      <ul className="mt-2 flex flex-col gap-2">
        {sources.map((source) => (
          <li key={source.name} className="text-11 text-fg-muted">
            <span className="text-fg font-medium">
              {source.url.length > 0 ? (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-accent inline-flex items-center gap-1 underline underline-offset-2"
                >
                  {source.name}
                  <ExternalIcon size={10} />
                </a>
              ) : (
                source.name
              )}
            </span>{' '}
            · {source.provider} · {source.resolution} · {source.license}
            {source.caveat == null ? null : (
              <span className="text-warning block">Nota: {source.caveat}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const COLUMNS = [
  'Dataset',
  'Cita',
  'Resolución espacial',
  'Vigencia/versión',
  'Cobertura',
  'Licencia',
] as const;

export function SourcesTable({ usage }: { usage: DatasetUsage }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-panel border-border-base bg-surface overflow-x-auto border">
        <table className="w-full min-w-3xl border-collapse text-left">
          <caption className="sr-only">
            Datasets efectivamente usados en este análisis, con su cita, resolución, vigencia,
            cobertura y licencia.
          </caption>
          <thead>
            <tr className="border-border-base bg-surface-2 border-b">
              {COLUMNS.map((heading) => (
                <th
                  key={heading}
                  scope="col"
                  className="text-11 text-fg-subtle px-3 py-2 font-semibold tracking-wide uppercase"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {usage.used.map((row) => (
              <tr
                key={row.source.name}
                className="border-border-base/60 print-card border-b align-top last:border-b-0"
              >
                <td className="text-12 px-3 py-2">
                  {row.source.url.length > 0 ? (
                    <a
                      href={row.source.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-accent font-medium underline underline-offset-2"
                    >
                      {row.source.name}
                    </a>
                  ) : (
                    <span className="text-fg font-medium">{row.source.name}</span>
                  )}
                  <span className="text-11 text-fg-subtle block">{row.source.provider}</span>
                  <span className="text-11 text-fg-subtle block">Capas: {row.layers.join(', ')}</span>
                </td>
                <td className="text-11 text-fg-muted px-3 py-2">{row.source.citation}</td>
                <td className="text-11 text-fg-muted px-3 py-2">{row.source.resolution}</td>
                <td className="text-11 text-fg-muted px-3 py-2">{row.source.vintage}</td>
                <td className="text-11 text-fg-muted px-3 py-2">{row.source.coverage}</td>
                <td className="text-11 text-fg-muted px-3 py-2">{row.source.license}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {usage.unavailable.length === 0 ? null : (
        <div className="rounded-panel border-border-base bg-danger-soft/40 print-card border border-l-2 p-3">
          <h4 className="text-13 text-fg font-semibold">No disponibles en esta corrida</h4>
          <p className="text-12 text-fg-muted mt-1">
            Estos servicios no respondieron. Lo que no aparece en el reporte por su ausencia es un
            dato faltante, no una ausencia de elementos en el terreno.
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {usage.unavailable.map((entry) => (
              <li key={entry.source.name} className="text-12 text-fg">
                <span className="font-medium">{entry.source.name}</span>{' '}
                <span className="text-fg-muted">— {entry.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-11 text-fg-subtle">
        Las capas de este reporte y sus metadatos salen del registro de capas de la aplicación. La
        tabla completa de todos los datasets disponibles, hayan participado o no de esta corrida,
        está en «Fuentes y metodología».
      </p>
    </div>
  );
}
