/*
  Análisis terminado → tarjetas de la pestaña ANÁLISIS (§3.4).

  La regla que este archivo existe para respetar: **las tarjetas salen del
  MISMO cálculo que el reporte**. `executiveSummary` (una línea por tema, con
  "No se pudo consultar" cuando la fuente no respondió) ya está escrito y
  probado en `report/narrative.ts`; recalcular acá "pendiente media" o "solape
  con el AOI" habría creado una segunda verdad que se desincroniza del reporte
  con el primer cambio de copy.

  Lo único propio de este panel es el REPARTO por tema —cambiar de vista
  reordena las tarjetas, nunca las esconde— y la conversión de una fuente caída
  en una tarjeta `no-data` con su botón de reintento, en vez de en un guion mudo.
*/

import type { AnalysisCard } from './analysis-panel';
import type { ThemeId } from '~/layers/types';

import { executiveSummary, tallyMepyd } from '~/components/report/narrative';
import {
  downSources,
  toSummary,
  type AnalysisSourceId,
  type TerritorioAnalysis,
} from '~/lib/analysis-contract';
import { formatNumber } from '~/lib/format';

/** A qué vista pertenece cada línea del resumen ejecutivo. */
const LINE_THEME: Record<string, ThemeId> = {
  elevacion: 'topografia',
  vegetacion: 'vegetacion',
  cobertura: 'vegetacion',
  hidrologia: 'hidrologia',
  'areas-protegidas': 'areas-protegidas',
  costera: 'riesgo-rd',
};

/** Y qué fuente la alimenta: una fuente caída reemplaza su tarjeta por `no-data`. */
const LINE_SOURCE: Record<string, AnalysisSourceId> = {
  elevacion: 'raster',
  vegetacion: 'raster',
  cobertura: 'raster',
  hidrologia: 'hidrologia',
  'areas-protegidas': 'areas-protegidas',
  costera: 'raster',
};

const SOURCE_THEME: Record<AnalysisSourceId, ThemeId> = {
  raster: 'topografia',
  hidrologia: 'hidrologia',
  'areas-protegidas': 'areas-protegidas',
  mepyd: 'riesgo-rd',
};

function Metric({ value, note }: { value: string; note?: string }) {
  return (
    <div>
      <p className="tabular text-15 text-fg font-semibold">{value}</p>
      {note == null ? null : <p className="text-12 text-fg-muted mt-0.5">{note}</p>}
    </div>
  );
}

function MepydTally({ analysis }: { analysis: TerritorioAnalysis }) {
  const groups = tallyMepyd(analysis.mepyd_rd.summary)
    .map((group) => ({
      group: group.group,
      layers: group.layers.filter((layer) => layer.count > 0),
    }))
    .filter((group) => group.layers.length > 0);

  if (groups.length === 0) {
    return (
      <p className="text-12 text-fg-muted">
        Sin resultados (servicios sin respuesta o sin elementos cerca del AOI).
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {groups.map((group) => (
        <li key={group.group}>
          <p className="text-11 text-fg-subtle font-semibold tracking-wide uppercase">
            {group.group}
          </p>
          <ul className="mt-0.5 flex flex-col gap-0.5">
            {group.layers.map((layer) => (
              <li key={layer.label} className="text-12 text-fg-muted flex justify-between gap-2">
                <span className="min-w-0 truncate">{layer.label}</span>
                <span className="tabular text-fg shrink-0">{formatNumber(layer.count, 0)}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

export type BuildCardsInput = {
  analysis: TerritorioAnalysis;
  /** Vuelve a leer el análisis: es el «Reintentar» de una tarjeta `no-data`. */
  onRetry: () => void;
};

/**
 * Las tarjetas de la fase `listo`, en el orden natural de las vistas. El panel
 * las reordena poniendo la vista activa primero (§3.4).
 */
export function buildAnalysisCards({ analysis, onRetry }: BuildCardsInput): AnalysisCard[] {
  const summary = toSummary(analysis);
  const down = new Map(downSources(analysis).map((source) => [source.id, source]));
  const cards: AnalysisCard[] = [];

  for (const line of executiveSummary(summary)) {
    const theme = LINE_THEME[line.id] ?? 'topografia';
    const failed = down.get(LINE_SOURCE[line.id] ?? 'raster');

    cards.push(
      failed === undefined
        ? {
            id: line.id,
            theme,
            title: line.label,
            content: <Metric value={line.value} note={line.note} />,
          }
        : {
            id: line.id,
            theme,
            title: line.label,
            content: null,
            failure: {
              reason: failed.error ?? 'El servicio no respondió.',
              service: failed.service,
              onRetry,
            },
          },
    );
  }

  /*
    MEPyD no tiene línea en el resumen ejecutivo (son 39 capas, no un número),
    pero SÍ es el contenido entero de la vista Riesgo RD: sin esta tarjeta esa
    vista quedaba vacía aun con el análisis terminado.
  */
  if (analysis.mepyd_rd.in_rd) {
    const failed = down.get('mepyd');
    cards.push(
      failed === undefined
        ? {
            id: 'contexto-rd',
            theme: 'riesgo-rd',
            title: 'Contexto RD (MEPyD)',
            content: <MepydTally analysis={analysis} />,
          }
        : {
            id: 'contexto-rd',
            theme: 'riesgo-rd',
            title: 'Contexto RD (MEPyD)',
            content: null,
            failure: {
              reason: failed.error ?? 'Los servicios del MEPyD no respondieron.',
              service: failed.service,
              onRetry,
            },
          },
    );
  }

  /*
    Una fuente caída que no alimenta ninguna línea (el caso real: MEPyD fuera de
    RD, o una fuente nueva) igual tiene que verse. El §8 es explícito: nada
    falla en silencio.
  */
  for (const [id, source] of down) {
    if (cards.some((card) => card.failure?.service === source.service)) continue;
    cards.push({
      id: `fuente-${id}`,
      theme: SOURCE_THEME[id],
      title: source.service,
      content: null,
      failure: {
        reason: source.error ?? 'El servicio no respondió.',
        service: source.service,
        onRetry,
      },
    });
  }

  return cards;
}
