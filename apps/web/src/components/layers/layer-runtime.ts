/*
  Estado por capa, derivado del análisis. Módulo PURO.

  Principio 5 del brief: **nada se computa ni falla en silencio**. Toda capa
  tiene un estado explícito `pending | ok | empty | error | skipped` visible en
  su propia fila (§4.3, §8 "Layer load error"), y no un checkbox vivo sobre una
  capa que no puede pintar nada.

  La distinción que este archivo existe para preservar es la regresión #3 del
  inventario: `available: false` ("no se pudo consultar el servicio") NO es lo
  mismo que `found: 0` ("consulté y no hay nada"). La primera es `error` con el
  nombre del servicio y un reintento; la segunda es `empty` — un resultado
  válido. Colapsarlas en "lista vacía" es exactamente el bug.
*/

import { RASTER_LAYER_BY_ID } from '../map/overlays';

import type { LayerRuntime } from './layer-row';
import type { LayerDef } from '~/layers/types';

import { LAYER_REGISTRY } from '~/layers/registry';
import {
  type AnalysisSourceId,
  type TerritorioAnalysis,
  findSource,
  SOURCE_DOWN_MESSAGES,
} from '~/lib/analysis-contract';

/*
  Dos textos por fuente caída: el CHIP (cortísimo, porque compite con el nombre
  de la capa en una fila de 48 px) y el `title` (la frase entera del §8). El
  "reintentar" NO va en el chip: `LayerStatusChip` ya dibuja ese botón aparte.
*/
const DOWN_REASON: Record<AnalysisSourceId, string> = {
  raster: 'servicio caído',
  hidrologia: 'Overpass caído',
  'areas-protegidas': 'WDPA caído',
  mepyd: 'MEPyD caído',
};

const DOWN_DETAIL: Record<AnalysisSourceId, string> = {
  raster: SOURCE_DOWN_MESSAGES.raster,
  hidrologia: SOURCE_DOWN_MESSAGES.hidrologia,
  'areas-protegidas': SOURCE_DOWN_MESSAGES['areas-protegidas'],
  mepyd: SOURCE_DOWN_MESSAGES.mepyd,
};

/** "consulté y no hay nada" — la mitad BUENA de la regresión #3. */
const EMPTY_RUNTIME: LayerRuntime = {
  status: 'empty',
  reason: 'sin datos',
  detail: 'El servicio respondió, y dentro de este AOI no hay nada de esta capa.',
};

/** Qué fuente alimenta cada capa del registro. */
function sourceOf(layer: LayerDef): AnalysisSourceId {
  if (layer.id === 'osm-hydro') return 'hidrologia';
  if (layer.id === 'wdpa') return 'areas-protegidas';
  if (layer.id.startsWith('mepyd:')) return 'mepyd';
  return 'raster';
}

export type LayerRuntimeInput = {
  analysis: TerritorioAnalysis | null;
  /** Elementos por capa vectorial, del índice de `vector-data.ts`. */
  featureCounts: ReadonlyMap<string, number>;
  /** Capas raster que la corrida produjo de verdad. */
  producedRasters: ReadonlySet<string>;
};

function rasterRuntime(
  layer: LayerDef,
  input: LayerRuntimeInput,
  analysis: TerritorioAnalysis,
): LayerRuntime {
  const status = findSource(analysis, 'raster');
  if (status?.state === 'error') {
    return { status: 'error', reason: DOWN_REASON.raster, detail: DOWN_DETAIL.raster };
  }

  if (input.producedRasters.has(layer.id)) return { status: 'ok' };

  // El costero se pide bajo demanda: no haberlo pedido no es un error (§4).
  if (layer.id === 'aqueduct') {
    return {
      status: 'skipped',
      reason: 'elegí escenario',
      detail:
        'La inundación costera se calcula bajo demanda: elegí un escenario de WRI Aqueduct para pedirla.',
    };
  }

  /*
    La capa no salió, y el motivo importa: sin escenas Sentinel-2 con menos de
    30 % de nubes en 180 días, la vegetación no existe para este AOI. Es el
    texto del §8 ("Empty result"), no un "error" genérico.
  */
  if (layer.id === 'ndvi' || layer.id === 'ndvi-density') {
    return analysis.vegetation.ndvi_available
      ? EMPTY_RUNTIME
      : {
          status: 'empty',
          reason: 'sin escenas S2',
          detail:
            'No se encontraron escenas Sentinel-2 con menos de 30 % de nubes en los últimos 180 días.',
        };
  }
  if (layer.id === 'worldcover') {
    return analysis.vegetation.worldcover_available
      ? EMPTY_RUNTIME
      : { status: 'error', reason: 'sin WorldCover', detail: 'ESA WorldCover no respondió.' };
  }
  return analysis.topography.available
    ? EMPTY_RUNTIME
    : { status: 'error', reason: DOWN_REASON.raster, detail: DOWN_DETAIL.raster };
}

function vectorRuntime(
  layer: LayerDef,
  input: LayerRuntimeInput,
  analysis: TerritorioAnalysis,
  source: AnalysisSourceId,
): LayerRuntime {
  const status = findSource(analysis, source);

  if (source === 'mepyd' && !analysis.mepyd_rd.in_rd) {
    return {
      status: 'skipped',
      reason: 'fuera de RD',
      detail: 'Contexto RD no aplica: el AOI está fuera de República Dominicana.',
    };
  }
  if (status?.state === 'error') {
    return { status: 'error', reason: DOWN_REASON[source], detail: DOWN_DETAIL[source] };
  }

  const count = input.featureCounts.get(layer.id);
  if (count === undefined || count === 0) return EMPTY_RUNTIME;

  if (source === 'mepyd' && analysis.mepyd_rd.geometries_omitted) {
    // El resultado se persistió sin geometrías por el tope de 6 MB: el
    // resumen existe, el mapa no. Decirlo es mejor que un checkbox mudo.
    return {
      status: 'empty',
      reason: 'sin geometrías',
      detail:
        'El resultado superó el tope de 6 MB y se guardó sin las geometrías MEPyD. El resumen sí está.',
    };
  }

  return { status: 'ok', featureCount: count };
}

/**
 * Estado de TODAS las capas del registro.
 *
 * Sin análisis todavía, cada capa de datos reporta `skipped · sin AOI`: es el
 * estado gris con razón inline del §4.3, no un checkbox que promete algo.
 */
const NO_AOI: LayerRuntime = {
  status: 'skipped',
  reason: 'sin AOI',
  detail: 'Dibujá o subí una zona de estudio para que esta capa tenga qué mostrar.',
};

export function buildLayerRuntime(input: LayerRuntimeInput): Record<string, LayerRuntime> {
  const runtime: Record<string, LayerRuntime> = {};
  const analysis = input.analysis;

  for (const layer of LAYER_REGISTRY) {
    if (layer.alwaysOn === true) {
      runtime[layer.id] = analysis === null ? NO_AOI : { status: 'ok' };
      continue;
    }

    if (analysis === null) {
      runtime[layer.id] = NO_AOI;
      continue;
    }

    const source = sourceOf(layer);

    if (source === 'raster') {
      /*
        `slope-classes` es el caso vivo: el registro la declara (es la capa por
        defecto de la vista Topografía) pero el servicio raster NO emite un
        raster de clases de pendiente — emite `slope` continuo. El brief §4.3
        dice que se reclasifica en el cliente desde el continuo, y eso hoy no
        se puede: el PNG ya viene con la rampa aplicada y leer el GeoTIFF en el
        browser está prohibido por el memo (geoblaze/georaster, §caveats).

        Se dice con todas las letras en la fila en vez de mostrar "sin datos en
        el AOI", que sería mentir: el AOI SÍ tiene datos, lo que falta es que
        el servicio produzca esta capa.
      */
      runtime[layer.id] =
        RASTER_LAYER_BY_ID[layer.id] === undefined
          ? {
              status: 'skipped',
              reason: 'no la produce',
              detail:
                'El servicio raster no emite esta capa todavía. Sólo produce DEM, pendiente, orientación, NDVI, clases de NDVI, cobertura y la inundación costera.',
            }
          : rasterRuntime(layer, input, analysis);
      continue;
    }

    runtime[layer.id] = vectorRuntime(layer, input, analysis, source);
  }

  return runtime;
}
