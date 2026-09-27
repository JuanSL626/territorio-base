import { useState } from 'react';

import { Badge, type BadgeTone } from '~/components/ui/badge';
import {
  RD_REGULATORY_ACTORS,
  regulatoryActorById,
  type RegulatoryActor,
  type RegulatoryActorCategory,
} from '~/lib/regulatory/rd-actor-map';

const CATEGORY_TONES: Record<RegulatoryActorCategory, BadgeTone> = {
  'marco jurídico': 'neutral',
  ordenamiento: 'accent',
  'gestión local': 'info',
  edificación: 'warning',
  ambiental: 'success',
  infraestructura: 'accent',
  tenencia: 'neutral',
};

function evidenceTone(actor: RegulatoryActor): BadgeTone {
  return actor.evidenceStatus === 'Fuente oficial verificada' ? 'success' : 'warning';
}

/**
 * Explorador del mapa institucional. La topología es deliberadamente pequeña:
 * representa las dependencias de prefactibilidad que se verificaron, no una
 * afirmación de que exista una ventanilla única o un orden obligatorio.
 */
export function RegulatoryActorMap() {
  const [selectedId, setSelectedId] = useState<string>('mepyd');
  const selected = regulatoryActorById(selectedId) ?? RD_REGULATORY_ACTORS[0];

  if (selected === undefined) return null;

  const related = selected.relatedActorIds
    .map((id) => regulatoryActorById(id))
    .filter((actor): actor is RegulatoryActor => actor !== undefined);

  return (
    <section aria-labelledby="actor-map-title" className="mt-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="actor-map-title" className="text-18 text-fg font-semibold">
            Mapa institucional
          </h2>
          <p className="text-13 text-fg-muted mt-1 max-w-3xl">
            Seleccioná un actor para entender su rol, los documentos que conviene verificar y cómo
            se conecta con los demás. El mapa representa una prefactibilidad, no una ruta legal
            cerrada.
          </p>
        </div>
        <Badge tone="warning">Piloto: República Dominicana</Badge>
      </div>

      <div className="border-border-base bg-surface rounded-panel mt-4 border p-4">
        <p className="text-11 text-fg-muted text-center font-medium tracking-wide uppercase">
          Proyecto o área de estudio
        </p>
        <div className="border-accent bg-accent-soft text-fg rounded-panel mx-auto mt-2 flex min-h-14 max-w-sm items-center justify-center border px-4 text-center font-semibold">
          Prefactibilidad territorial, normativa y de desarrollo
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {RD_REGULATORY_ACTORS.map((actor) => {
            const selectedActor = actor.id === selected.id;
            return (
              <button
                key={actor.id}
                type="button"
                aria-pressed={selectedActor}
                onClick={() => {
                  setSelectedId(actor.id);
                }}
                className={`rounded-panel min-h-24 border p-3 text-left transition-colors ${
                  selectedActor
                    ? 'border-accent bg-accent-soft'
                    : 'border-border-base bg-surface hover:bg-surface-2'
                }`}
              >
                <span className="text-13 text-fg block font-semibold">{actor.shortName}</span>
                <span className="text-11 text-fg-muted mt-1 block">{actor.category}</span>
                <span className="text-11 text-fg-muted mt-2 block">{actor.scope}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-border-base bg-surface rounded-panel mt-4 grid overflow-hidden border lg:grid-cols-[minmax(0,1fr)_280px]">
        <article className="p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-18 text-fg font-semibold">{selected.name}</h3>
            <Badge tone={CATEGORY_TONES[selected.category]}>{selected.category}</Badge>
            <Badge tone={evidenceTone(selected)}>{selected.evidenceStatus}</Badge>
          </div>
          <p className="text-12 text-fg-muted mt-1">Alcance: {selected.scope}</p>

          <section className="mt-5">
            <h4 className="text-13 text-fg font-semibold">Responsabilidad en el ecosistema</h4>
            <p className="text-13 text-fg-muted mt-1">{selected.mandate}</p>
          </section>

          <section className="mt-4">
            <h4 className="text-13 text-fg font-semibold">Qué aporta a Tierra Base</h4>
            <p className="text-13 text-fg-muted mt-1">{selected.planningRole}</p>
          </section>

          <section className="mt-4">
            <h4 className="text-13 text-fg font-semibold">Documentos o evidencias a verificar</h4>
            <ul className="text-13 text-fg-muted mt-2 list-disc space-y-1 pl-5">
              {selected.documentsToVerify.map((document) => (
                <li key={document}>{document}</li>
              ))}
            </ul>
          </section>

          <p className="bg-warning-soft text-warning rounded-btn text-12 mt-5 px-3 py-2">
            {selected.evidenceNote}
          </p>
        </article>

        <aside className="border-border-base bg-surface-2 border-t p-5 lg:border-t-0 lg:border-l">
          <h4 className="text-13 text-fg font-semibold">Actores relacionados</h4>
          <div className="mt-2 flex flex-wrap gap-2">
            {related.map((actor) => (
              <button
                key={actor.id}
                type="button"
                onClick={() => {
                  setSelectedId(actor.id);
                }}
                className="rounded-chip border-border-base bg-surface text-12 text-fg hover:bg-surface-3 border px-2 py-1"
              >
                {actor.shortName}
              </button>
            ))}
          </div>

          <h4 className="text-13 text-fg mt-6 font-semibold">Fuentes oficiales</h4>
          <ul className="mt-2 flex flex-col gap-2">
            {selected.sources.map((source) => (
              <li key={source.url}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-12 text-accent hover:text-accent-hover underline underline-offset-2"
                >
                  {source.label}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
}
