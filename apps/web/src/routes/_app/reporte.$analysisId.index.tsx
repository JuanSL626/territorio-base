import { createFileRoute, Link } from '@tanstack/react-router';

import { ReportBody } from '~/components/report/report-body';
import { DownloadIcon, ReportIcon } from '~/components/ui/icons';
import { analysisSummaryQueryOptions } from '~/lib/analysis-queries';

/**
 * Story map del §6: mapa PEGAJOSO de un lado, narrativa scrolleable del otro.
 *
 * La ruta es deliberadamente delgada. El sidecar entero — layout, coreografía
 * del mapa, secciones — vive en `ReportBody`, porque el observador de scroll y
 * el mapa tienen que estar en el MISMO árbol de React: si el layout viviera
 * acá, cada cambio de paso obligaría a subir estado hasta la ruta y bajarlo
 * otra vez, que es exactamente el acoplamiento que el §6.3 pide evitar.
 *
 * El loader precarga el RESUMEN (sin geometrías) con `ensureQueryData`: se
 * resuelve en el servidor, viaja en el payload deshidratado del router y el
 * reporte se pinta completo en la primera pasada, sin spinner. Las geometrías
 * del mapa las pide el cuerpo desde el cliente (ver `report-body.tsx`).
 */
export const Route = createFileRoute('/_app/reporte/$analysisId/')({
  loader: async ({ context, params }) => {
    await context.queryClient.query({
      ...analysisSummaryQueryOptions(params.analysisId),
      staleTime: 'static',
    });
  },
  component: ReportPage,
});

function ReportPage() {
  const { analysisId } = Route.useParams();

  return (
    <main className="bg-surface min-h-dvh">
      <header className="no-print border-border-base bg-surface sticky top-0 z-30 flex h-12 items-center gap-3 border-b px-4">
        <Link to="/" className="text-12 text-accent font-medium underline underline-offset-2">
          ← Volver al mapa
        </Link>

        <span className="text-12 text-fg-muted hidden items-center gap-1.5 sm:flex">
          <ReportIcon size={13} />
          Reporte territorial
        </span>

        <span className="flex-1" />

        <Link
          to="/fuentes"
          className="text-12 text-fg-muted hover:text-fg font-medium underline underline-offset-2"
        >
          Fuentes y metodología
        </Link>
        <Link
          to="/reporte/$analysisId/imprimir"
          params={{ analysisId }}
          className="text-12 text-accent inline-flex items-center gap-1 font-medium underline underline-offset-2"
        >
          <DownloadIcon size={13} />
          Vista de impresión
        </Link>
      </header>

      <ReportBody analysisId={analysisId} />
    </main>
  );
}
