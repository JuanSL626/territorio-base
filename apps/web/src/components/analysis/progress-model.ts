/*
  Snapshot del motor → tarjetas de progreso del §8. Módulo PURO.

  `AnalyzingState` dibuja una tarjeta por TEMA con su línea de pasos
  determinada; el motor, en cambio, reporta dos cosas distintas: los mensajes
  en español del pipeline raster (que llegan por SSE, uno por paso) y el estado
  de cada FUENTE vectorial (que no tiene pasos: consulta o no consulta).

  Traducir una cosa en la otra acá — y no dentro del componente — es lo que
  permite probar el mapeo sin montar React, y es lo que hace que la tarjeta de
  hidrología aparezca ya resuelta mientras la de raster sigue corriendo
  (regresión #3: una escena Sentinel-2 lenta nunca bloquea al resto).
*/

import type {
  AnalysisStep,
  AnalysisStepState,
  AnalysisThemeProgress,
} from '~/components/states/analyzing';
import type { LiveRunSnapshot, LiveSourceState } from '~/lib/analysis-runtime';

/** Una fuente vectorial: sin pasos internos, un solo renglón por tarjeta. */
const VECTOR_THEMES = [
  {
    id: 'hidrologia',
    label: 'Hidrología',
    step: 'Consultando cursos y cuerpos de agua en OpenStreetMap',
  },
  {
    id: 'areas-protegidas',
    label: 'Áreas protegidas',
    step: 'Consultando la WDPA (UNEP-WCMC)',
  },
  {
    id: 'mepyd',
    label: 'Contexto RD (MEPyD)',
    step: 'Consultando las capas del MEPyD',
  },
] as const;

const RASTER_THEME_LABEL = 'Topografía y vegetación';
const RASTER_FIRST_STEP = 'Preparando el compuesto Sentinel-2 y el DEM';

/**
 * Estado de una fuente → glifo del paso.
 *
 * `pending` con la corrida todavía viva es `running`, no `pending`: las dos
 * mitades del motor arrancan JUNTAS (ver `analysis-runtime`), así que una
 * fuente sin resolver está trabajando, no esperando turno. Con la corrida ya
 * terminada vuelve a `pending`, que es lo honesto para una fuente que nunca
 * llegó a reportar.
 */
export function stepStateOf(
  state: LiveSourceState | undefined,
  finished: boolean,
): AnalysisStepState {
  switch (state) {
    case 'ok':
    case 'empty':
    case 'skipped':
      return 'done';
    case 'error':
      return 'error';
    case 'pending':
    case undefined:
      return finished ? 'pending' : 'running';
  }
}

function rasterSteps(run: LiveRunSnapshot): AnalysisStep[] {
  const rasterState = run.sources.raster;
  const settled = rasterState !== 'pending' && rasterState !== undefined;

  if (run.progress.length === 0) {
    return [{ label: RASTER_FIRST_STEP, state: stepStateOf(rasterState, run.finished) }];
  }

  /*
    Los mensajes llegan en orden y sin repetidos: cada uno es un paso cumplido
    salvo el ÚLTIMO, que es el que está en curso mientras la fuente no cierre.
    Si la mitad raster falló, el último paso es el que se marca en rojo — es
    donde el pipeline se cortó.
  */
  return run.progress.map((event, index) => {
    const isLast = index === run.progress.length - 1;
    const state: AnalysisStepState = !isLast
      ? 'done'
      : rasterState === 'error'
        ? 'error'
        : settled
          ? 'done'
          : run.finished
            ? 'done'
            : 'running';
    return { label: event.message, state };
  });
}

/**
 * Las cuatro tarjetas de la fase `analizando`, en el orden en que el motor las
 * resuelve. `null` no es un caso: sin snapshot vivo se devuelve el esqueleto
 * con todo en curso, que es lo que corresponde mostrar mientras la corrida
 * existe pero este proceso no la tiene en memoria.
 */
export function analysisThemeProgress(run: LiveRunSnapshot | null): AnalysisThemeProgress[] {
  if (run === null) {
    return [
      {
        id: 'raster',
        label: RASTER_THEME_LABEL,
        steps: [{ label: RASTER_FIRST_STEP, state: 'running' }],
      },
      ...VECTOR_THEMES.map((theme) => ({
        id: theme.id,
        label: theme.label,
        steps: [{ label: theme.step, state: 'running' as const }],
      })),
    ];
  }

  return [
    { id: 'raster', label: RASTER_THEME_LABEL, steps: rasterSteps(run) },
    ...VECTOR_THEMES.map((theme) => ({
      id: theme.id,
      label: theme.label,
      steps: [{ label: theme.step, state: stepStateOf(run.sources[theme.id], run.finished) }],
    })),
  ];
}
