import { z } from 'zod';

import type { ThemeId } from '~/layers/types';

import { getLayer } from '~/layers/registry';
import { DEFAULT_VISTA, type LayerVisibility } from '~/layers/vistas';

/*
  TODO el estado del mapa vive en la URL (02-design-brief.md §1.1). La regla es
  literal: si un colega pega el link, ve el mismo mapa.

  `aoi` es un id del servidor, NUNCA la geometría: un KML de 400 vértices
  reventaría el querystring.
*/

export const THEME_IDS = [
  'topografia',
  'vegetacion',
  'hidrologia',
  'areas-protegidas',
  'riesgo-rd',
] as const satisfies readonly ThemeId[];

export const mapSearchSchema = z.object({
  /** Id del AOI del lado del servidor. */
  aoi: z.string().min(1).max(64).optional(),
  theme: z.enum(THEME_IDS).default(DEFAULT_VISTA).catch(DEFAULT_VISTA),
  /** csv de ids de capa visibles. */
  layers: z.string().max(4000).optional(),
  /** csv `id:opacidad`, sólo para las opacidades distintas del default. */
  op: z.string().max(4000).optional(),
  /** `layerId:featureId` de la selección actual (§5.1). */
  sel: z.string().max(200).optional(),
  /** `minLon,minLat,maxLon,maxLat`. */
  bbox: z.string().max(120).optional(),
  /** Pestaña activa del panel izquierdo. */
  panel: z.enum(['capas', 'analisis']).default('capas').catch('capas'),
});

export type MapSearch = z.infer<typeof mapSearchSchema>;

export function parseLayerCsv(csv: string | undefined): string[] {
  if (csv == null || csv.length === 0) return [];
  return csv
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && getLayer(id) !== undefined);
}

export function serializeLayerCsv(ids: readonly string[]): string | undefined {
  return ids.length === 0 ? undefined : ids.join(',');
}

/**
 * `op` usa `id:opacidad` y los ids MEPyD ya traen `:` adentro
 * (`mepyd:agua/rios-y-arroyos`), así que se parte por el ÚLTIMO `:`.
 */
export function parseOpacityCsv(csv: string | undefined): Record<string, number> {
  if (csv == null || csv.length === 0) return {};
  const result: Record<string, number> = {};

  for (const entry of csv.split(',')) {
    const separator = entry.lastIndexOf(':');
    if (separator <= 0) continue;
    const id = entry.slice(0, separator);
    const value = Number(entry.slice(separator + 1));
    if (!Number.isFinite(value) || value < 0 || value > 1) continue;
    if (getLayer(id) === undefined) continue;
    result[id] = value;
  }

  return result;
}

export function serializeOpacityCsv(opacity: Readonly<Record<string, number>>): string | undefined {
  const entries = Object.entries(opacity).filter(([id, value]) => {
    const layer = getLayer(id);
    return layer !== undefined && value !== layer.defaultOpacity;
  });

  if (entries.length === 0) return undefined;
  return entries.map(([id, value]) => `${id}:${String(Number(value.toFixed(2)))}`).join(',');
}

export type Selection = { layerId: string; featureId: string };

export function parseSelection(sel: string | undefined): Selection | null {
  if (sel == null) return null;
  const separator = sel.lastIndexOf(':');
  if (separator <= 0) return null;
  const layerId = sel.slice(0, separator);
  const featureId = sel.slice(separator + 1);
  if (featureId.length === 0 || getLayer(layerId) === undefined) return null;
  return { layerId, featureId };
}

export function serializeSelection(selection: Selection | null): string | undefined {
  return selection === null ? undefined : `${selection.layerId}:${selection.featureId}`;
}

export type Bbox = [number, number, number, number];

export function parseBbox(bbox: string | undefined): Bbox | null {
  if (bbox == null) return null;
  const parts = bbox.split(',').map(Number);
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) return null;
  const [minLon, minLat, maxLon, maxLat] = parts as Bbox;
  return [minLon, minLat, maxLon, maxLat];
}

export function serializeBbox(bbox: Bbox | null): string | undefined {
  return bbox === null ? undefined : bbox.map((value) => value.toFixed(5)).join(',');
}

export function visibilityFromSearch(search: MapSearch): LayerVisibility {
  return {
    visible: parseLayerCsv(search.layers),
    opacity: parseOpacityCsv(search.op),
  };
}

export function visibilityToSearch(visibility: LayerVisibility): Pick<MapSearch, 'layers' | 'op'> {
  return {
    layers: serializeLayerCsv(visibility.visible),
    op: serializeOpacityCsv(visibility.opacity),
  };
}
