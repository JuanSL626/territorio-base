/*
  `TerritorioAnalysis` → GeoJSON por capa del registro. Módulo PURO.

  Un `FeatureCollection` por id de capa, con:
    · un id sintético ESTABLE por feature (`__tbid`), que es lo que viaja en el
      search param `sel=<layerId>:<featureId>` del §5.1 y lo que filtran las
      capas de resaltado. No se usa el índice del array desnudo: para OSM y
      WDPA hay un identificador real y usarlo hace que un link compartido
      sobreviva a un reanálisis que reordene la lista.
    · las propiedades que el `PopupConfig` de esa capa nombra, sin renombrar
      nada: el inspector aplica los alias, este módulo no inventa esquemas.

  MEPyD llega con `outFields="*"` (inventario §6): sus atributos se copian tal
  cual, sin curar ni descartar columnas.
*/

import { FEATURE_ID_KEY } from './layer-style';

import type { Feature, FeatureCollection, Geometry } from '@territorio/geo/geojson';
import type { MepydAttributes, TerritorioAnalysis } from '~/lib/analysis-contract';

export type VectorLayerData = {
  layerId: string;
  data: FeatureCollection;
  /** Elementos dentro del AOI. Alimenta el chip de la fila y el link a la tabla. */
  count: number;
};

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

function feature(
  featureId: string,
  geometry: Geometry,
  properties: Record<string, unknown>,
): Feature {
  return {
    type: 'Feature',
    geometry,
    properties: { ...properties, [FEATURE_ID_KEY]: featureId },
  };
}

function collection(features: Feature[]): FeatureCollection {
  return { type: 'FeatureCollection', features };
}

/** El AOI: un solo feature, siempre presente, nunca apagable (§0.3). */
function aoiData(analysis: TerritorioAnalysis): VectorLayerData {
  return {
    layerId: 'aoi',
    data: collection([
      feature('aoi', analysis.aoi_geometry, {
        area_ha: analysis.aoi.area_ha,
        utm_epsg: analysis.aoi.utm_epsg,
      }),
    ]),
    count: 1,
  };
}

/**
 * Hidrología OSM. `kind` es la clave categórica que pinta los tres hex del
 * inventario §4 y que el popup traduce a "Curso de agua / Cuerpo de agua /
 * Humedal" — el `waterway=stream` crudo no llega nunca a la pantalla (§5.2).
 */
function hydrologyData(analysis: TerritorioAnalysis): VectorLayerData {
  const features = analysis.hydrology.features.map((item) =>
    feature(`osm-${String(item.osm_id)}`, item.geometry, {
      osm_id: item.osm_id,
      kind: item.kind,
      name: item.name,
      distance_m: item.distance_m,
    }),
  );
  return { layerId: 'osm-hydro', data: collection(features), count: features.length };
}

function protectedData(analysis: TerritorioAnalysis): VectorLayerData {
  const features = analysis.protected_areas.areas.map((area, index) =>
    feature(`wdpa-${String(index)}`, area.geometry, {
      name: area.name,
      desig: area.desig,
      desig_eng: area.desig_eng,
      iucn_cat: area.iucn_cat,
      status: area.status,
      distance_m: area.distance_m,
      overlap_ha: area.overlap_ha,
    }),
  );
  return { layerId: 'wdpa', data: collection(features), count: features.length };
}

/**
 * Un `FeatureCollection` por capa MEPyD, con el id del registro
 * (`mepyd:<grupo>/<capa>`) como clave. Si `geometries_omitted` es `true` el
 * resultado se persistió sin geometrías (tope de 6 MB de `result_json`): las
 * capas quedan vacías y la fila del panel lo dice, en vez de mentir con un
 * checkbox que no pinta nada.
 */
function mepydData(analysis: TerritorioAnalysis): VectorLayerData[] {
  return analysis.mepyd_rd.layers.map((layer) => {
    const features = layer.features.map((item, index) =>
      feature(`${layer.layer_id}-${String(index)}`, item.geometry, attributesOf(item.properties)),
    );
    return { layerId: layer.layer_id, data: collection(features), count: layer.count };
  });
}

function attributesOf(properties: MepydAttributes): Record<string, unknown> {
  return { ...properties };
}

/**
 * Índice `layerId → GeoJSON` de TODO lo vectorial del análisis.
 *
 * Se calcula una sola vez por análisis (memoizado por el llamador): la
 * identidad del objeto es lo que le dice al efecto del mapa si tiene que
 * llamar `setData` o no, así que recalcularlo en cada render sería justamente
 * el re-render caro que el §"Performance" prohíbe.
 */
export function buildVectorData(
  analysis: TerritorioAnalysis | null,
): ReadonlyMap<string, VectorLayerData> {
  const index = new Map<string, VectorLayerData>();
  if (analysis === null) return index;

  for (const entry of [
    aoiData(analysis),
    hydrologyData(analysis),
    protectedData(analysis),
    ...mepydData(analysis),
  ]) {
    index.set(entry.layerId, entry);
  }

  return index;
}

export { EMPTY as EMPTY_COLLECTION };
