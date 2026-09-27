import { createFileRoute, Link } from '@tanstack/react-router';

import { RegulatoryActorMap } from '~/components/regulatory/actor-map';

/**
 * Punto de partida del catálogo normativo. La información normativa cambia y
 * tiene efectos materiales: esta pantalla publica evidencia y preguntas de
 * prefactibilidad, nunca un dictamen o una autorización.
 */
export const Route = createFileRoute('/_app/normativa')({
  head: () => ({
    meta: [
      { title: 'Normativa y gestión · Territorio Base' },
      {
        name: 'description',
        content:
          'Mapa institucional para investigar ordenamiento territorial, desarrollo, permisos y documentos de planificación en República Dominicana.',
      },
    ],
  }),
  component: NormativaPage,
});

function NormativaPage() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-6xl p-6">
      <Link to="/" className="text-12 text-accent font-medium underline underline-offset-2">
        ← Volver al mapa
      </Link>

      <header className="mt-3 max-w-4xl">
        <p className="text-12 text-fg-muted font-medium tracking-wide uppercase">
          Investigación normativa
        </p>
        <h1 className="text-18 text-fg mt-1 font-semibold">Normativa, gestión y desarrollo</h1>
        <p className="text-13 text-fg-muted mt-2">
          Tierra Base empieza por mostrar quién participa en una prefactibilidad territorial, qué
          tipo de evidencia emite cada institución y qué documentos conviene investigar antes de
          convertir una norma escrita en una regla espacial.
        </p>
      </header>

      <section
        className="border-info bg-info-soft text-info rounded-panel mt-6 border p-4"
        aria-label="Alcance de esta herramienta"
      >
        <h2 className="text-13 font-semibold">Cómo interpretar esta pantalla</h2>
        <p className="text-12 mt-1 max-w-4xl">
          Es una guía de investigación y trazabilidad para República Dominicana. No confirma la
          edificabilidad, vigencia de una zonificación, elegibilidad de un permiso ni sustituye una
          consulta ante el ayuntamiento, la autoridad competente o profesionales habilitados.
        </p>
      </section>

      <RegulatoryActorMap />

      <section className="border-border-base bg-surface rounded-panel mt-6 border p-5">
        <h2 className="text-15 text-fg font-semibold">Método para nutrir el catálogo</h2>
        <ol className="text-13 text-fg-muted mt-3 list-decimal space-y-2 pl-5">
          <li>
            Registrar el documento desde su URL oficial y conservar su fecha, versión y vigencia.
          </li>
          <li>Separar la cita normativa de la interpretación operativa que haga Tierra Base.</li>
          <li>
            Clasificar la evidencia espacial: oficial, georreferenciada, inferida o no
            espacializable.
          </li>
          <li>
            Revisar por una persona responsable antes de publicar una regla como aplicable a un AOI.
          </li>
          <li>
            Guardar la incertidumbre: una capa o un PDF ausente nunca se interpreta como ausencia de
            restricción.
          </li>
        </ol>
      </section>
    </main>
  );
}
