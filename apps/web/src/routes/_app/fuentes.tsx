import { createFileRoute, Link } from '@tanstack/react-router';

import type { SourceRef } from '~/layers/types';

import { LAYER_REGISTRY } from '~/layers/registry';

export const Route = createFileRoute('/_app/fuentes')({
  component: FuentesPage,
});

/** Una fila por DATASET, no por capa: varias capas comparten fuente. */
function uniqueSources(): { source: SourceRef; layers: string[] }[] {
  const byName = new Map<string, { source: SourceRef; layers: string[] }>();

  for (const layer of LAYER_REGISTRY) {
    const key = layer.source.name;
    const existing = byName.get(key);
    if (existing) existing.layers.push(layer.label);
    else byName.set(key, { source: layer.source, layers: [layer.label] });
  }

  return [...byName.values()];
}

/**
 * Tabla fija de "Fuentes y metodología" (§6.5). Es visible SIEMPRE, no detrás
 * de un click: un reporte de due diligence no puede tener la atribución
 * escondida. Sale entera del registro (§1.2).
 */
function FuentesPage() {
  const rows = uniqueSources();

  return (
    <main className="mx-auto min-h-dvh w-full max-w-5xl p-6">
      <Link to="/" className="text-12 text-accent font-medium underline underline-offset-2">
        ← Volver al mapa
      </Link>

      <h1 className="text-18 text-fg mt-3 font-semibold">Fuentes y metodología</h1>
      <p className="text-12 text-fg-muted mt-1">
        Todos los datasets que puede usar un análisis, con su cita, resolución, vigencia, cobertura
        y licencia.
      </p>

      <div className="rounded-panel border-border-base bg-surface mt-4 overflow-x-auto border">
        <table className="w-full min-w-4xl border-collapse text-left">
          <thead>
            <tr className="border-border-base bg-surface-2 border-b">
              {[
                'Dataset',
                'Cita',
                'Resolución espacial',
                'Vigencia/versión',
                'Cobertura',
                'Licencia',
              ].map((heading) => (
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
            {rows.map(({ source, layers }) => (
              <tr
                key={source.name}
                className="border-border-base/60 border-b align-top last:border-b-0"
              >
                <td className="text-12 px-3 py-2">
                  {source.url.length > 0 ? (
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-accent font-medium underline underline-offset-2"
                    >
                      {source.name}
                    </a>
                  ) : (
                    <span className="text-fg font-medium">{source.name}</span>
                  )}
                  <span className="text-11 text-fg-subtle mt-0.5 block">
                    {layers.length} capa(s): {layers.slice(0, 3).join(', ')}
                    {layers.length > 3 ? '…' : ''}
                  </span>
                </td>
                <td className="text-11 text-fg-muted px-3 py-2">{source.citation}</td>
                <td className="text-12 text-fg px-3 py-2">{source.resolution}</td>
                <td className="text-12 text-fg px-3 py-2">{source.vintage}</td>
                <td className="text-12 text-fg px-3 py-2">{source.coverage}</td>
                <td className="text-11 text-fg-muted px-3 py-2">{source.license}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="text-15 text-fg mt-6 font-semibold">Advertencias por fuente</h2>
      <ul className="mt-2 flex flex-col gap-2">
        {rows
          .filter((row) => row.source.caveat != null)
          .map((row) => (
            <li key={row.source.name} className="text-12 text-fg-muted">
              <span className="text-fg font-semibold">{row.source.name}:</span> {row.source.caveat}
            </li>
          ))}
      </ul>
    </main>
  );
}
