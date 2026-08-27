import { Link } from '@tanstack/react-router';

import { DATASET_CITATIONS } from '@territorio/geo/export/sources';

import { InfoIcon } from '~/components/ui/icons';

/*
  El bloque de atribución/licencias del §7.2: SIEMPRE visible bajo las pestañas,
  no detrás de un click.

  Es la puerta de licencias de Protected Planet suavizada a una divulgación —
  sin muro de radio-buttons que nadie lee y todos aceptan — pero con la
  contrapartida que la hace honesta: **el texto de licencia viaja adentro del
  ZIP**, en `FUENTES.txt`, tanto si el usuario leyó esto como si no.
*/

export type AttributionNoticeProps = {
  /** Ids de `DATASET_CITATIONS` de lo que está tildado ahora mismo. */
  datasetIds: ReadonlySet<string>;
};

export function AttributionNotice({ datasetIds }: AttributionNoticeProps) {
  const cited = DATASET_CITATIONS.filter((citation) => datasetIds.has(citation.id));

  return (
    <section className="rounded-panel border-border-base bg-surface-2 border p-3">
      <div className="flex items-center gap-1.5">
        <span className="text-fg-muted">
          <InfoIcon size={14} />
        </span>
        <h3 className="text-12 text-fg font-semibold">Atribución y licencias</h3>
      </div>

      {cited.length === 0 ? (
        <p className="text-11 text-fg-muted mt-1.5">Todavía no tildaste ninguna capa de datos.</p>
      ) : (
        <ul className="mt-1.5 flex flex-col gap-1">
          {cited.map((citation) => (
            <li key={citation.id} className="text-11 text-fg-muted">
              <span className="text-fg font-medium">{citation.officialName}</span> —{' '}
              {citation.provider}. <span className="italic">{citation.license}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-11 text-fg-muted mt-2">
        Se incluye <code className="tabular">FUENTES.txt</code> con fuentes, licencias, citas y
        fecha de consulta dentro del ZIP, y <code className="tabular">LEEME.txt</code> con el CRS de
        cada archivo.{' '}
        <Link to="/fuentes" className="text-accent font-medium underline underline-offset-2">
          Ver el catálogo completo de fuentes
        </Link>
        .
      </p>
    </section>
  );
}
