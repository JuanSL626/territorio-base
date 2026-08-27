/*
  Sistema de VISTAS — 02-design-brief.md §3.

  Una vista NO es una página: es un preset de capas + encuadre + basemap +
  pestaña por defecto del inspector. Cambiar de vista:

    1. apaga toda capa de MEDICIÓN que no pertenezca a la vista nueva,
    2. prende los defaults de la vista (tope duro de 4 capas de datos visibles),
    3. DEJA prendidas las capas de CONTEXTO que el usuario encendió a mano
       — se marcan con un alfiler en el panel para que se entienda por qué
       sobrevivieron,
    4. cambia el basemap,
    5. reordena las tarjetas del tab ANÁLISIS (nunca las esconde).
*/

import { MEPYD_IDS } from './mepyd';
import { getLayer, LAYER_REGISTRY } from './registry';

import type { ThemeId } from './types';

export type BasemapId = 'terrain' | 'satellite' | 'light';

export type VistaLayerPreset = {
  id: string;
  on: boolean;
  opacity: number;
};

export type Vista = {
  id: ThemeId;
  label: string;
  /** Frase de una línea para el tooltip del control segmentado. */
  hint: string;
  basemap: BasemapId;
  inspectorDefaultTab: 'atributos' | 'fuente';
  layers: VistaLayerPreset[];
  /** `Riesgo RD` se OCULTA entero (no se deshabilita) fuera de RD. */
  requiresRd?: boolean;
};

/** Tope duro del §3.1: más de 4-5 capas de datos y el mapa deja de leerse. */
export const MAX_VISIBLE_DATA_LAYERS = 4;

export const DEFAULT_VISTA: ThemeId = 'topografia';

export const VISTAS: Vista[] = [
  {
    id: 'topografia',
    label: 'Topografía',
    hint: 'Relieve, pendiente y sus clases sobre el DEM Copernicus GLO-30.',
    basemap: 'terrain',
    inspectorDefaultTab: 'atributos',
    layers: [
      { id: 'slope-classes', on: true, opacity: 0.7 },
      { id: 'dem', on: false, opacity: 0.5 },
      { id: 'aoi', on: true, opacity: 1 },
    ],
  },
  {
    id: 'vegetacion',
    label: 'Vegetación',
    hint: 'NDVI mediana de 180 días y cobertura ESA WorldCover.',
    basemap: 'satellite',
    inspectorDefaultTab: 'atributos',
    layers: [
      { id: 'ndvi-density', on: true, opacity: 0.75 },
      { id: 'worldcover', on: false, opacity: 0.7 },
      { id: 'aoi', on: true, opacity: 1 },
    ],
  },
  {
    id: 'hidrologia',
    label: 'Hidrología',
    hint: 'Cursos y cuerpos de agua de OSM más la red hídrica del MEPyD.',
    basemap: 'light',
    inspectorDefaultTab: 'atributos',
    layers: [
      { id: 'osm-hydro', on: true, opacity: 1 },
      { id: MEPYD_IDS.riosArroyos, on: true, opacity: 0.8 },
      { id: 'aoi', on: true, opacity: 1 },
    ],
  },
  {
    id: 'areas-protegidas',
    label: 'Áreas protegidas',
    hint: 'WDPA (UNEP-WCMC) y áreas protegidas declaradas por el MEPyD.',
    basemap: 'light',
    inspectorDefaultTab: 'atributos',
    layers: [
      { id: 'wdpa', on: true, opacity: 0.45 },
      { id: MEPYD_IDS.areaProtegida, on: true, opacity: 0.35 },
      { id: 'aoi', on: true, opacity: 1 },
    ],
  },
  {
    id: 'riesgo-rd',
    label: 'Riesgo RD',
    hint: 'Amenazas de deslizamiento, inundación y tsunami del MEPyD.',
    basemap: 'light',
    inspectorDefaultTab: 'atributos',
    requiresRd: true,
    layers: [
      { id: MEPYD_IDS.deslizamiento, on: true, opacity: 0.35 },
      { id: MEPYD_IDS.inundacion, on: true, opacity: 0.35 },
      { id: MEPYD_IDS.tsunami, on: true, opacity: 0.35 },
      { id: 'aoi', on: true, opacity: 1 },
    ],
  },
];

const FALLBACK_VISTA: Vista = {
  id: 'topografia',
  label: 'Topografía',
  hint: '',
  basemap: 'light',
  inspectorDefaultTab: 'atributos',
  layers: [],
};

export function getVista(id: ThemeId): Vista {
  const vista = VISTAS.find((candidate) => candidate.id === id);
  // El id viene de un enum validado por zod en la URL; el fallback existe para
  // que un search param manipulado a mano no rompa el render.
  return vista ?? VISTAS[0] ?? { ...FALLBACK_VISTA };
}

export type LayerVisibility = {
  visible: string[];
  /** Sólo se guardan las opacidades distintas del default (§1.1, param `op`). */
  opacity: Record<string, number>;
};

/** Cuenta capas de datos: el AOI y las capas `alwaysOn` no consumen el cupo. */
export function countVisibleDataLayers(visible: readonly string[]): number {
  return visible.filter((id) => {
    const layer = getLayer(id);
    return layer !== undefined && layer.alwaysOn !== true;
  }).length;
}

function withCap(visible: string[]): string[] {
  const capped: string[] = [];
  let dataLayers = 0;

  for (const id of visible) {
    const layer = getLayer(id);
    if (!layer) continue;
    if (layer.alwaysOn === true) {
      capped.push(id);
      continue;
    }
    if (dataLayers >= MAX_VISIBLE_DATA_LAYERS) continue;
    capped.push(id);
    dataLayers += 1;
  }

  return capped;
}

/** Estado inicial: los defaults de la vista más el contexto heredado del motor. */
export function initialVisibility(themeId: ThemeId): LayerVisibility {
  const vista = getVista(themeId);
  const opacity: Record<string, number> = {};
  const visible: string[] = [];

  for (const layer of LAYER_REGISTRY) {
    if (layer.alwaysOn === true) visible.push(layer.id);
  }

  for (const preset of vista.layers) {
    const layer = getLayer(preset.id);
    if (!layer) continue;
    if (preset.opacity !== layer.defaultOpacity) opacity[preset.id] = preset.opacity;
    if (preset.on && !visible.includes(preset.id)) visible.push(preset.id);
  }

  return { visible: withCap(visible), opacity };
}

/**
 * Cambio de vista. `previousTheme` sirve para distinguir "el usuario prendió
 * esta capa de contexto a mano" de "venía prendida por el preset anterior".
 */
export function applyVista(
  current: LayerVisibility,
  nextTheme: ThemeId,
  previousTheme: ThemeId,
): LayerVisibility {
  const nextVista = getVista(nextTheme);
  const previousVista = getVista(previousTheme);
  const presetOfPrevious = new Set(
    previousVista.layers.filter((preset) => preset.on).map((preset) => preset.id),
  );

  const kept: string[] = [];

  for (const id of current.visible) {
    const layer = getLayer(id);
    if (!layer) continue;
    if (layer.alwaysOn === true) {
      kept.push(id);
      continue;
    }
    // Regla 1: toda capa de medición fuera de la vista nueva se apaga.
    if (layer.role === 'medicion') continue;
    // Regla 2: el contexto encendido a mano sobrevive; el que venía del preset
    // anterior, no.
    if (presetOfPrevious.has(id)) continue;
    kept.push(id);
  }

  const opacity = { ...current.opacity };

  for (const preset of nextVista.layers) {
    const layer = getLayer(preset.id);
    if (!layer) continue;
    if (preset.opacity !== layer.defaultOpacity) opacity[preset.id] = preset.opacity;
    if (preset.on && !kept.includes(preset.id)) kept.push(preset.id);
  }

  return { visible: withCap(kept), opacity };
}

/**
 * Capas de contexto que sobrevivieron un cambio de vista: el panel les dibuja
 * un alfiler para que se entienda por qué siguen prendidas (§3.2).
 */
export function isPinnedContext(layerId: string, themeId: ThemeId): boolean {
  const layer = getLayer(layerId);
  if (layer?.role !== 'contexto' || layer.alwaysOn === true) return false;
  return !getVista(themeId).layers.some((preset) => preset.id === layerId && preset.on);
}
