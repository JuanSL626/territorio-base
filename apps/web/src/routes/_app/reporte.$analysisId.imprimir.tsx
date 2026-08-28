import { createFileRoute, Link } from '@tanstack/react-router';

import { ReportBody } from '~/components/report/report-body';
import { Button } from '~/components/ui/button';
import { analysisQueryOptions, useAnalysisSummary } from '~/lib/analysis-queries';
import { formatHectares } from '~/lib/format';

/**
 * Vista de impresión (§6.6).
 *
 * Por qué esta ruta existe en vez de un `window.print()` sobre el reporte:
 * nunca se imprime la página GL viva. El propio producto de Esri sigue sacando
 * recuadros grises vacíos pasados ~16 mapas vivos en una misma pasada de
 * impresión, y un reporte de ocho secciones con un mapa cada una cae justo en
 * esa zona. Acá cada mapa es una figura SVG estática — las mismas geometrías,
 * dibujadas con `<path>`, sin WebGL, sin peticiones de red y sin depender de
 * que el compositor haya terminado antes de que el navegador tome la foto.
 *
 * El loader precarga el análisis COMPLETO (con geometrías): la impresión no
 * puede depender de un fetch de cliente que quizá no termine antes de que se
 * abra el diálogo.
 *
 * La hoja de impresión vive acá, junto al marcado que gobierna, y no en
 * `styles.css`: es específica de esta ruta y así se lee de una sola vez.
 */
export const Route = createFileRoute('/_app/reporte/$analysisId/imprimir')({
  loader: async ({ context, params }) => {
    await context.queryClient.query({
      ...analysisQueryOptions(params.analysisId),
      staleTime: 'static',
    });
  },
  component: PrintPage,
});

const PRINT_CSS = `
@page {
  size: A4 portrait;
  /* Márgenes generosos arriba y abajo: ahí van el membrete y el pie. */
  margin: 22mm 14mm 20mm;
}

@media print {
  /*
    PAPEL SIEMPRE CLARO. styles.css define la paleta clara en :root y la
    oscura bajo prefers-color-scheme: dark; esa media query sigue valiendo al
    imprimir, así que quien tenga el sistema en oscuro imprimiría fondos
    negros — y con print-color-adjust: exact el navegador los mandaría a la
    impresora tal cual. Redefinir los tokens acá es la única forma de forzar
    tinta de papel desde una hoja de estilo con alcance de ruta.

    Los tres selectores son necesarios: el bloque oscuro de styles.css es
    :root:not([data-theme='light']), de especificidad (0,2,0), así que un :root
    pelado (0,1,0) pierde por más abajo que esté en la cascada.
  */
  :root,
  :root:not([data-theme='light']),
  :root[data-theme='dark'] {
    color-scheme: light;
    --surface: #ffffff;
    --surface-2: #ffffff;
    --surface-3: #f2f4f7;
    --border: #d0d5dd;
    --border-strong: #98a2b3;
    --fg: #101828;
    --fg-muted: #475467;
    --fg-subtle: #667085;
    --accent: #1f6feb;
    --accent-soft: #eef4ff;
    --danger: #b42318;
    --danger-soft: #fee4e2;
    --warning: #b54708;
    --warning-soft: #fef0c7;
    --success: #067647;
    --success-soft: #d1fadf;
    --info: #175cd3;
    --info-soft: #d1e9ff;
  }

  html, body { background: #ffffff !important; }

  /*
    MEMBRETE Y PIE CORRIENTES, con la única técnica que Chrome pagina bien.

    Lo intuitivo es «position: fixed; top: 0», y no funciona: Chrome ubica los
    elementos fijos respecto del área de contenido de CADA página, así que el
    membrete se dibuja encima del texto en todas las páginas menos la primera
    (verificado imprimiendo a PDF), y con desplazamientos negativos se va al
    margen inferior de la página anterior. Lo que sí repite correctamente es un
    «thead» / «tfoot» de tabla: el navegador reserva su altura en cada página y
    no pisa nada. Por eso todo el reporte va dentro de una tabla de una sola
    celda cuando se imprime.
  */
  .print-running-header { display: table-header-group !important; }
  .print-running-footer { display: table-footer-group !important; }
  /*
    Borde y relleno van en la CELDA, no en el grupo: un table-header-group no
    dibuja su propio borde ni respeta su padding, y sin ese aire el filete del
    pie se apoya sobre la última línea de texto de la página.
  */
  .print-running-header td,
  .print-running-footer td { font-size: 9pt; color: #444; }
  .print-running-header td { padding: 0 0 7pt; border-bottom: 0.5pt solid #bbb; }
  .print-running-footer td { padding: 7pt 0 0; border-top: 0.5pt solid #bbb; }
  /*
    Ninguna tarjeta, banner, fila de tabla o figura se parte entre páginas. La
    fila que envuelve el reporte entero queda EXCLUIDA a propósito: si se le
    pidiera no partirse, no habría paginación posible.
  */
  .print-card,
  article,
  figure,
  tr:not(.print-frame-row),
  details { break-inside: avoid; page-break-inside: avoid; }

  h2, h3 { break-after: avoid; page-break-after: avoid; }

  /*
    Nada se recorta horizontalmente en papel: un contenedor con scroll propio
    (la tabla de fuentes, las tablas de atributos del MEPyD) simplemente pierde
    lo que sobresale, porque en papel no hay barra para desplazarlo.
  */
  .print-sheet .overflow-x-auto,
  .print-sheet .overflow-auto { overflow: visible !important; max-height: none !important; }
  .print-sheet table { min-width: 0 !important; width: 100% !important; }
  .print-sheet th,
  .print-sheet td { white-space: normal !important; }
  /* Sólo las celdas de datos parten palabras: los encabezados quedan legibles. */
  .print-sheet td { overflow-wrap: anywhere; }

  /* El sidecar se vuelve una sola columna: el mapa de cada sección va arriba. */
  .print-sheet .md\\:hidden { display: block !important; }
  .print-sheet nav,
  .print-sheet .no-print { display: none !important; }

  section { break-inside: auto; }

  /* Las fuentes van a su propia página (§6.5): es la hoja que se archiva. */
  #seccion-fuentes { break-before: page; page-break-before: always; }

  /* Los colores de las clases SON el dato: sin esto la leyenda queda en gris. */
  * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }

  a[href^="http"]::after {
    content: " (" attr(href) ")";
    font-size: 8pt;
    color: #666;
    word-break: break-all;
  }
  a[href^="#"]::after { content: ""; }

  /* Los detalles del MEPyD se imprimen abiertos: un acordeón cerrado en papel
     es contenido perdido, no contenido colapsado. */
  details > div { display: block !important; }
}
`;

function PrintPage() {
  const { analysisId } = Route.useParams();
  const summaryQuery = useAnalysisSummary(analysisId);
  const analysis = summaryQuery.data?.ok === true ? summaryQuery.data.analysis : null;

  const generated = new Date();
  const stamp = `${String(generated.getUTCDate()).padStart(2, '0')}/${String(
    generated.getUTCMonth() + 1,
  ).padStart(2, '0')}/${String(generated.getUTCFullYear())}`;

  const identity =
    analysis === null
      ? `Análisis ${analysisId}`
      : `${formatHectares(analysis.aoi.area_ha)} · EPSG:${String(
          analysis.aoi.utm_epsg,
        )} · análisis ${analysisId}`;

  return (
    <main className="bg-surface mx-auto w-full max-w-4xl">
      <style>{PRINT_CSS}</style>

      <div className="no-print border-border-base bg-surface sticky top-0 z-30 flex h-12 items-center gap-3 border-b px-4">
        <Link
          to="/reporte/$analysisId"
          params={{ analysisId }}
          className="text-12 text-accent font-medium underline underline-offset-2"
        >
          ← Volver al reporte
        </Link>
        <span className="text-12 text-fg-muted hidden sm:inline">
          Vista de impresión · los mapas son figuras estáticas, no el mapa interactivo
        </span>
        <span className="flex-1" />
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            window.print();
          }}
        >
          Imprimir o guardar como PDF
        </Button>
      </div>

      {/*
        La tabla NO es maquetación: es el mecanismo de membrete y pie corrientes
        (ver PRINT_CSS). En pantalla el `thead`/`tfoot` está oculto y la tabla se
        comporta como un bloque más.
      */}
      <table className="print-sheet w-full border-collapse px-6 py-6">
        <thead className="print-running-header hidden">
          <tr>
            <td>Territorio Base — Reporte territorial · {identity}</td>
          </tr>
        </thead>

        <tbody>
          <tr className="print-frame-row">
            <td className="p-0">
              <header className="print-card border-border-base border-b px-6 pt-6 pb-4">
                <h1 className="text-18 text-fg font-semibold">Reporte territorial</h1>
                <p className="text-12 text-fg-muted mt-1">{identity}</p>
                <p className="text-12 text-fg-muted">Generado el {stamp}</p>
              </header>

              <ReportBody analysisId={analysisId} print />
            </td>
          </tr>
        </tbody>

        <tfoot className="print-running-footer hidden">
          <tr>
            <td>Generado el {stamp} · Fuentes y licencias en la última sección · territorio-base</td>
          </tr>
        </tfoot>
      </table>
    </main>
  );
}
