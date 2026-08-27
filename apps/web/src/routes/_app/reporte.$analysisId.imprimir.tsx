import { createFileRoute } from '@tanstack/react-router';

import { ReportBody } from '~/components/report/report-body';
import { LAYER_REGISTRY } from '~/layers/registry';

export const Route = createFileRoute('/_app/reporte/$analysisId/imprimir')({
  component: PrintPage,
});

/**
 * Render de impresión (§6.6). NUNCA se imprime la página GL viva: cada mapa se
 * reemplaza por un PNG pre-horneado (1600×1000 @2x, uno por sección) y la
 * hoja de estilos de impresión evita cortes dentro de las tarjetas y fuerza la
 * tabla de fuentes a su propia página.
 */
function PrintPage() {
  const { analysisId } = Route.useParams();
  const sources = [
    ...new Map(LAYER_REGISTRY.map((layer) => [layer.source.name, layer.source])).values(),
  ];

  return (
    <main className="bg-surface mx-auto w-full max-w-4xl p-8">
      <h1 className="text-18 text-fg font-semibold">Reporte territorial</h1>
      <p className="text-12 text-fg-muted mt-1">
        Análisis <span className="tabular">{analysisId}</span>
      </p>

      <div className="print-card mt-6">
        <ReportBody analysisId={analysisId} print />
      </div>

      <section className="print-page-break mt-8">
        <h2 className="text-15 text-fg font-semibold">Fuentes y metodología</h2>
        <table className="mt-2 w-full border-collapse text-left">
          <thead>
            <tr className="border-border-base border-b">
              {['Dataset', 'Resolución', 'Vigencia', 'Licencia'].map((heading) => (
                <th key={heading} scope="col" className="text-11 text-fg-subtle py-1 font-semibold">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => (
              <tr key={source.name} className="border-border-base/60 border-b">
                <td className="text-11 text-fg py-1">{source.name}</td>
                <td className="text-11 text-fg-muted py-1">{source.resolution}</td>
                <td className="text-11 text-fg-muted py-1">{source.vintage}</td>
                <td className="text-11 text-fg-muted py-1">{source.license}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
