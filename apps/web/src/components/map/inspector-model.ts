/*
  Feature clickeado → contenido del inspector (§5.2 y §5.3). Módulo PURO.

  Regla del §5.2: visibilidad opt-in con alias. Un `IUCN_CAT`, un `desig_eng`
  o un `waterway=stream` crudo no llega jamás a la pantalla; se muestra lo
  que el `PopupConfig` de la capa nombra, con su alias en castellano y su
  formato.

  Excepción explícita: MEPyD. Sus capas declaran `allowDynamicFields: true`
  porque llegan con `outFields="*"` y un esquema distinto por capa
  (inventario §6) — ahí se renderiza defensivamente TODA columna que
  devolvió el servicio, con su nombre de columna como etiqueta, que es lo
  que hacía el legacy y lo único honesto: inventar un alias para una
  columna que no conocemos sería peor que mostrar su nombre.
*/

import { FEATURE_ID_KEY } from './layer-style';

import type {
  InspectorCandidate,
  InspectorFeature,
  InspectorField,
} from '~/components/layout/inspector';
import type { AoiContext, FeatureProperties, LayerDef, PopupField } from '~/layers/types';

import { getLayer } from '~/layers/registry';
import { formatDistance, formatHectares, formatNumber } from '~/lib/format';

/** Valor vacío: el §5.3 muestra una fila con guion, nunca una fila fantasma. */
const EMPTY_VALUE = '—';

/** Título de un feature sin nombre. Texto exacto del §5.2. */
const UNNAMED = 'Sin nombre';

/**
 * `layerId` no se infiere del feature: lo pone quien registró la capa de
 * estilo en el mapa (§12.6, identidad de capa estructural). Este módulo
 * nunca adivina de qué capa vino nada.
 */
export type FeatureHit = {
  layerId: string;
  featureId: string;
  properties: FeatureProperties;
};

function isEmpty(value: unknown): boolean {
  return value == null || (typeof value === 'string' && value.trim().length === 0);
}

/** Formatea según el `format` declarado. Nunca lanza: un dato raro sale como texto. */
export function formatFieldValue(value: unknown, field?: PopupField): string {
  if (isEmpty(value)) return EMPTY_VALUE;

  if (field?.valueLabels !== undefined && typeof value === 'string') {
    const label = field.valueLabels[value];
    if (label !== undefined) return label;
  }

  switch (field?.format) {
    case 'number':
      return typeof value === 'number' ? formatNumber(value, field.decimals ?? 1) : String(value);
    case 'area-ha':
      return typeof value === 'number' ? formatHectares(value, field.decimals ?? 1) : String(value);
    case 'distance-m':
      return typeof value === 'number' ? formatDistance(value) : String(value);
    case 'date': {
      const date = new Date(String(value));
      return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
    }
    case 'text':
    case undefined:
    default:
      /*
        Sin `format` declarado no se sabe si el número es una MEDIDA o un
        IDENTIFICADOR: `OSM 24 193` y `OBJECTID 1 240` son mentiras
        tipográficas. Un entero se muestra crudo (ids y códigos de ArcGIS son
        enteros) y sólo los decimales reciben formato español — la heurística
        que menos daño hace sobre el esquema dinámico de MEPyD.
      */
      if (typeof value === 'number') {
        return Number.isInteger(value) ? String(value) : formatNumber(value, 2);
      }
      if (typeof value === 'boolean') return value ? 'Sí' : 'No';
      return String(value);
  }
}

/**
 * Resuelve una clave con alternativas separadas por `|`. Es el heurístico de
 * display de MEPyD (inventario §6), escrito como dato en el registro
 * (`{MUN_NOM|NOMBRE|nombre|name}`) en vez de un `if` acá: la capa 40 declara
 * su propio orden de preferencia sin tocar ningún componente.
 */
function readKey(properties: FeatureProperties, key: string): unknown {
  for (const candidate of key.split('|')) {
    const value = properties[candidate];
    if (!isEmpty(value)) return value;
  }
  return undefined;
}

/**
 * Sustituye `{clave}` en una plantilla de título o subtítulo.
 * Un token sin valor colapsa a vacío y los separadores sobrantes se limpian,
 * para que `"{kind} · OSM {osm_id}"` no quede como `" · OSM "`.
 */
function renderTemplate(
  template: string,
  properties: FeatureProperties,
  fieldsByKey: ReadonlyMap<string, PopupField>,
): string {
  const filled = template.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    const value = readKey(properties, key);
    if (value === undefined) return '';
    return formatFieldValue(value, fieldsByKey.get(key));
  });

  return filled
    .replace(/\s*·\s*(?=·|$)/g, '')
    .replace(/^\s*·\s*/, '')
    .trim();
}

/** Claves internas que nunca se muestran: son plomería, no atributos. */
const INTERNAL_KEYS = new Set([FEATURE_ID_KEY, 'geometry', 'bbox']);

function dynamicFieldsOf(
  properties: FeatureProperties,
  aliased: ReadonlySet<string>,
): InspectorField[] {
  const rows: InspectorField[] = [];
  for (const [key, value] of Object.entries(properties)) {
    if (INTERNAL_KEYS.has(key) || aliased.has(key)) continue;
    rows.push({ alias: key, value: formatFieldValue(value) });
  }
  return rows;
}

export type BuildFeatureInput = {
  hit: FeatureHit;
  aoi: AoiContext;
  layerFeatureCount: number;
};

/**
 * `null` si la capa no está en el registro o no declara popup. El §11 exige
 * que toda capa vectorial tenga `popup.fields`, así que `null` acá significa
 * "clickearon algo que no es una capa de datos", no "faltó configurar".
 */
export function buildInspectorFeature(input: BuildFeatureInput): InspectorFeature | null {
  const layer = getLayer(input.hit.layerId);
  if (layer === undefined) return null;
  const popup = layer.popup;
  if (popup === undefined) return null;

  const properties = input.hit.properties;
  const fieldsByKey = new Map(popup.fields.map((field) => [field.key, field]));

  const fields: InspectorField[] = popup.fields.map((field) => ({
    alias: field.alias,
    value: formatFieldValue(readKey(properties, field.key), field),
  }));

  for (const derived of popup.derived ?? []) {
    fields.push({ alias: derived.alias, value: derived.compute(properties, input.aoi) });
  }

  if (popup.allowDynamicFields === true) {
    const aliased = new Set(popup.fields.flatMap((field) => field.key.split('|')));
    fields.push(...dynamicFieldsOf(properties, aliased));
  }

  const title = renderTemplate(popup.title, properties, fieldsByKey);
  const subtitle =
    popup.subtitle === undefined
      ? undefined
      : renderTemplate(popup.subtitle, properties, fieldsByKey);

  return {
    layerId: layer.id,
    layerLabel: layer.label,
    featureId: input.hit.featureId,
    // Sin nombre → el §5.2 pide un fallback explícito, y para MEPyD el
    // fallback es la etiqueta de la capa (inventario §6).
    title: title.length > 0 ? title : popup.allowDynamicFields === true ? layer.label : UNNAMED,
    ...(subtitle !== undefined && subtitle.length > 0 ? { subtitle } : {}),
    fields,
    layerFeatureCount: input.layerFeatureCount,
    source: layer.source,
  };
}

/**
 * Agrupa los hits por capa en el orden del REGISTRO, no en el orden de
 * dibujo del mapa (que pondría siempre los puntos primero). Un click que
 * pega en más de una capa NUNCA elige ganador.
 */
export function buildCandidates(hits: readonly FeatureHit[]): InspectorCandidate[] {
  const counts = new Map<string, number>();
  for (const hit of hits) counts.set(hit.layerId, (counts.get(hit.layerId) ?? 0) + 1);

  const candidates: InspectorCandidate[] = [];
  for (const [layerId, count] of counts) {
    const layer: LayerDef | undefined = getLayer(layerId);
    if (layer === undefined) continue;
    candidates.push({ layerId, layerLabel: layer.label, count });
  }
  return candidates;
}
