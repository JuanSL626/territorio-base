import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';

import { ReportBody } from '~/components/report/report-body';
import { Button } from '~/components/ui/button';
import { CompareIcon } from '~/components/ui/icons';
import { cn } from '~/lib/cn';

export const Route = createFileRoute('/_app/reporte/$analysisId/')({
  component: ReportPage,
});

/**
 * Sidecar del §6.1: mapa STICKY de un lado, narrativa scrolleable del otro.
 * Narrativa 42% (mín. 420px, máx. 620px), mapa 58% pegado a `top: 0`.
 * En tablet se apila: mapa arriba a 45vh, narrativa debajo (§9).
 *
 * El scroll-triggering con scrollama y las tarjetas de métrica los monta la
 * fase de features; el marco, el encabezado y la tabla de fuentes son de acá.
 */
function ReportPage() {
  const { analysisId } = Route.useParams();
  const [narrativeLeft, setNarrativeLeft] = useState(true);

  return (
    <main className="bg-surface-2 min-h-dvh">
      <header className="border-border-base bg-surface flex h-12 items-center gap-3 border-b px-4">
        <Link to="/" className="text-12 text-accent font-medium underline underline-offset-2">
          ← Volver al mapa
        </Link>
        <span className="flex-1" />
        <Link
          to="/reporte/$analysisId/imprimir"
          params={{ analysisId }}
          className="text-12 text-accent font-medium underline underline-offset-2"
        >
          Vista de impresión
        </Link>
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<CompareIcon size={13} />}
          onClick={() => {
            setNarrativeLeft((value) => !value);
          }}
        >
          Cambiar de lado
        </Button>
      </header>

      <div
        className={cn(
          'flex min-h-[calc(100dvh-48px)] flex-col md:flex-row',
          narrativeLeft ? null : 'md:flex-row-reverse',
        )}
      >
        <section className="w-full min-w-0 shrink-0 p-8 md:w-[42%] md:max-w-[620px] md:min-w-[420px]">
          <h1 className="text-18 text-fg font-semibold">Reporte territorial</h1>
          <p className="text-12 text-fg-muted mt-1">
            Análisis <span className="tabular">{analysisId}</span>
          </p>
          <div className="mt-6">
            <ReportBody analysisId={analysisId} />
          </div>
        </section>

        <aside className="bg-surface-3 sticky top-0 h-[45vh] w-full md:h-dvh md:flex-1">
          <div className="text-12 text-fg-muted flex h-full items-center justify-center">
            Mapa del reporte — pendiente de la fase MapLibre
          </div>
        </aside>
      </div>
    </main>
  );
}
