/**
 * Carga y normalización del área de interés (AOI).
 *
 * Port de `services/api/src/territorio_base/aoi.py`, sin geopandas/shapely.
 *
 * Regresión #8 del inventario: la versión Python dependía de `fiona`, una
 * dependencia **no declarada**, y toda subida KML/KMZ moría con
 * `ModuleNotFoundError`. Acá el parser de KML (`@tmcw/togeojson` +
 * `@xmldom/xmldom`) y el de KMZ (`jszip`) son dependencias explícitas del
 * `package.json` de este paquete, y hay un test que arma un KMZ en memoria y
 * lo vuelve a leer.
 */

import { kml as kmlToGeoJson } from '@tmcw/togeojson';
import { booleanPointInPolygon, centerOfMass, pointOnFeature } from '@turf/turf';
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';

import { utmEpsgForLonLat, type UtmEpsg } from './crs';
import {
  geometryBounds,
  geometryRings,
  isGeometry,
  type AreaGeometry,
  type Bounds2D,
  type Geometry,
  type Position,
} from './geojson';
import { areaHectares, bufferMeters, unionAreas } from './geometry';

/** Formatos que acepta el uploader (design brief §8: `KML, KMZ, GeoJSON`). */
export type AoiFormat = 'geojson' | 'kml' | 'kmz';

export type Aoi = {
  /** Geometría normalizada en WGS84 (EPSG:4326). Siempre `Polygon` o `MultiPolygon`. */
  geometry: AreaGeometry;
  /** Zona UTM derivada del centroide. Contrato del inventario §3: `utm_epsg`. */
  utmEpsg: UtmEpsg;
  /** `(lon_min, lat_min, lon_max, lat_max)` — tupla, no array GeoJSON (§3). */
  bbox: Bounds2D;
  /** Hectáreas, calculadas en UTM. */
  areaHa: number;
  /** Para el guard de tamaño del design brief §7.4. */
  vertexCount: number;
};

/** Error de carga de AOI con mensaje en español, listo para mostrar (UC-03 / TC-04). */
export class AoiParseError extends Error {
  override readonly name = 'AoiParseError';
}

function countVertices(geometry: Geometry): number {
  let total = 0;
  for (const ring of geometryRings(geometry)) total += ring.length;
  return total;
}

/**
 * Zona UTM del AOI.
 *
 * Python usa `geometry.centroid`, que en shapely es el **centroide de área**;
 * el equivalente de turf es `centerOfMass` (no `centroid`, que promedia
 * vértices). H16 señala que el centroide de área de un MultiPolygon puede caer
 * **fuera de todas las partes** y, cerca de 72°W, elegir la zona equivocada:
 * por eso, si el centroide no cae dentro de la geometría, se usa
 * `pointOnFeature`, que sí está garantizado sobre ella.
 */
export function utmEpsgForGeometry(geometry: AreaGeometry): UtmEpsg {
  const feature = { type: 'Feature' as const, properties: {}, geometry };
  const center = centerOfMass(feature).geometry.coordinates;
  const anchor: Position = booleanPointInPolygon(center, feature)
    ? center
    : pointOnFeature(feature).geometry.coordinates;
  const lon = anchor[0];
  const lat = anchor[1];
  if (lon === undefined || lat === undefined) {
    throw new AoiParseError('No se pudo calcular el centroide del polígono.');
  }
  return utmEpsgForLonLat(lon, lat);
}

/** Construye el AOI normalizado a partir de una geometría de área en WGS84. */
export function createAoi(geometry: AreaGeometry): Aoi {
  const utmEpsg = utmEpsgForGeometry(geometry);
  return {
    geometry,
    utmEpsg,
    bbox: geometryBounds(geometry),
    areaHa: areaHectares(geometry, utmEpsg),
    vertexCount: countVertices(geometry),
  };
}

function collectAreaGeometries(value: unknown): AreaGeometry[] {
  if (typeof value !== 'object' || value === null) return [];
  const node = value as { type?: unknown; features?: unknown; geometry?: unknown };

  if (node.type === 'FeatureCollection') {
    const features: unknown = node.features;
    if (!Array.isArray(features)) return [];
    return features.flatMap((f: unknown) => collectAreaGeometries(f));
  }
  if (node.type === 'Feature') return collectAreaGeometries(node.geometry);
  if (!isGeometry(value)) return [];

  const geometry: Geometry = value;
  if (geometry.type === 'GeometryCollection') {
    return geometry.geometries.flatMap((g) => collectAreaGeometries(g));
  }
  if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') return [geometry];
  return [];
}

/**
 * Acepta `Feature`, `FeatureCollection` o `Geometry` (por ejemplo lo que
 * devuelve el control de dibujo del mapa). Varias geometrías se **unen en una
 * sola** — el "polígono ampliado" de UC-02.
 */
export function loadAoiFromGeoJson(value: unknown): Aoi {
  const areas = collectAreaGeometries(value);
  const first = areas[0];
  if (first === undefined) {
    throw new AoiParseError(
      'El archivo no contiene ningún polígono. Territorio Base necesita al menos un ' +
        'polígono o rectángulo (los puntos y las líneas no definen un área de estudio).',
    );
  }
  return createAoi(areas.length === 1 ? first : unionAreas(areas));
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new AoiParseError('El archivo no es un GeoJSON válido (no se pudo leer como JSON).', {
      cause,
    });
  }
}

function decode(data: Uint8Array | string): string {
  if (typeof data === 'string') return data;
  return new TextDecoder('utf-8').decode(data);
}

/** Parsea un KML (texto o bytes) a AOI. */
export function loadAoiFromKml(data: Uint8Array | string): Aoi {
  const text = decode(data);
  let collection: unknown;
  try {
    const document = new DOMParser().parseFromString(text, 'text/xml');
    collection = kmlToGeoJson(document);
  } catch (cause) {
    throw new AoiParseError('El archivo KML está corrupto o no contiene geometrías legibles.', {
      cause,
    });
  }
  return loadAoiFromGeoJson(collection);
}

/** Parsea un KMZ (ZIP con un `.kml` adentro) a AOI. */
export async function loadAoiFromKmz(data: Uint8Array): Promise<Aoi> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch (cause) {
    throw new AoiParseError('El archivo KMZ está corrupto: no se pudo abrir el ZIP.', { cause });
  }
  const entryName = Object.keys(zip.files).find((name) => name.toLowerCase().endsWith('.kml'));
  if (entryName === undefined) {
    throw new AoiParseError('El KMZ no contiene ningún archivo .kml adentro.');
  }
  const entry = zip.file(entryName);
  if (entry === null) {
    throw new AoiParseError('El KMZ no contiene ningún archivo .kml adentro.');
  }
  return loadAoiFromKml(await entry.async('uint8array'));
}

/** Formato inferido de la extensión, igual que `load_aoi_from_bytes`. */
export function formatFromFilename(filename: string): AoiFormat {
  const suffix = filename.toLowerCase().split('.').pop() ?? '';
  switch (suffix) {
    case 'geojson':
    case 'json':
      return 'geojson';
    case 'kml':
      return 'kml';
    case 'kmz':
      return 'kmz';
    default:
      throw new AoiParseError(`Formato no soportado: «.${suffix}». Se aceptan KML, KMZ y GeoJSON.`);
  }
}

/**
 * Punto de entrada del uploader: bytes + nombre de archivo → AOI normalizado.
 *
 * A diferencia del legacy (UC-03: excepción cruda de Streamlit), todos los
 * fallos salen como `AoiParseError` con texto en español mostrable al usuario.
 */
export async function parseAoiFile(input: { data: Uint8Array; filename: string }): Promise<Aoi> {
  const format = formatFromFilename(input.filename);
  switch (format) {
    case 'geojson':
      return loadAoiFromGeoJson(parseJson(decode(input.data)));
    case 'kml':
      return loadAoiFromKml(input.data);
    case 'kmz':
      return await loadAoiFromKmz(input.data);
  }
}

/** Área de búsqueda: AOI expandido `meters` metros, bufferado en UTM (H10). */
export function bufferAoi(aoi: Aoi, meters: number): AreaGeometry {
  return bufferMeters(aoi.geometry, meters, aoi.utmEpsg);
}
