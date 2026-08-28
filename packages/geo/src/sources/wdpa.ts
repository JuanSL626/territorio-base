/**
 * Áreas protegidas (WDPA) vía el ArcGIS FeatureServer público de UNEP-WCMC.
 *
 * Port de `services/api/src/territorio_base/sources/protected_areas.py`.
 *
 * Es la misma base que expone Protected Planet, pero este servicio permite
 * consultas espaciales directas sin token (Protected Planet sí lo pide).
 */

import { z } from 'zod';

import { bufferAoi, type Aoi } from '../aoi';
import { isGeometry, type AreaGeometry, type Geometry } from '../geojson';
import { arcgisRings } from '../geometry';
import { postFormJson, type RequestOptions } from '../http';

export const WDPA_QUERY_URL =
  'https://data-gis.unep-wcmc.org/arcgis/rest/services/ProtectedSites/' +
  'The_World_Database_of_Protected_Areas/FeatureServer/1/query';

export const WDPA_BUFFER_M = 1000;

/** `outFields` fijos del legacy (inventario §6). El orden es el del servicio. */
export const WDPA_OUT_FIELDS = ['name', 'desig', 'desig_eng', 'iucn_cat', 'status', 'mang_auth'];

export type ProtectedAreaFeature = {
  name: string | null;
  /** Designación en el idioma original. Se trae pero la UI legacy nunca la muestra. */
  desig: string | null;
  desigEng: string | null;
  iucnCat: string | null;
  status: string | null;
  /** Autoridad de manejo. Se trae pero la UI legacy nunca la muestra. */
  mangAuth: string | null;
  geometry: Geometry;
};

export class WdpaUnavailableError extends Error {
  override readonly name = 'WdpaUnavailableError';

  constructor(cause: unknown) {
    super(`No se pudo consultar el FeatureServer de WDPA: ${String(cause)}`, { cause });
  }
}

const featureCollectionSchema = z.object({
  type: z.literal('FeatureCollection').optional(),
  features: z
    .array(
      z.object({
        properties: z.record(z.string(), z.unknown()).nullable().optional(),
        geometry: z.unknown().nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
  error: z.unknown().optional(),
});

function text(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number') return String(value);
  return null;
}

/**
 * Áreas WDPA que intersectan un buffer alrededor del AOI (1 km por defecto).
 *
 * El original hacía `search_area.exterior.coords`, que revienta si el buffer
 * es un MultiPolygon; `arcgisRings` emite todos los anillos de todas las
 * partes, con la orientación que ArcGIS espera.
 */
export async function fetchProtectedAreas(
  aoi: Aoi,
  options: RequestOptions & { bufferM?: number; url?: string } = {},
): Promise<ProtectedAreaFeature[]> {
  const searchArea: AreaGeometry = bufferAoi(aoi, options.bufferM ?? WDPA_BUFFER_M);

  let payload: unknown;
  try {
    payload = await postFormJson(
      options.url ?? WDPA_QUERY_URL,
      {
        geometry: JSON.stringify({
          rings: arcgisRings(searchArea),
          spatialReference: { wkid: 4326 },
        }),
        geometryType: 'esriGeometryPolygon',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: WDPA_OUT_FIELDS.join(','),
        returnGeometry: 'true',
        outSR: '4326',
        f: 'geojson',
      },
      { timeouts: { connectMs: 5_000, readMs: 60_000 }, ...options },
    );
  } catch (cause) {
    throw new WdpaUnavailableError(cause);
  }

  const parsed = featureCollectionSchema.safeParse(payload);
  if (!parsed.success) throw new WdpaUnavailableError(parsed.error);
  // ArcGIS contesta 200 con `{"error": {...}}`. No es una respuesta vacía: es un fallo.
  if (parsed.data.error !== undefined) throw new WdpaUnavailableError(parsed.data.error);

  const features: ProtectedAreaFeature[] = [];
  for (const feature of parsed.data.features ?? []) {
    const geometry: unknown = feature.geometry;
    if (!isGeometry(geometry)) continue;
    const properties = feature.properties ?? {};
    features.push({
      name: text(properties.name),
      desig: text(properties.desig),
      desigEng: text(properties.desig_eng),
      iucnCat: text(properties.iucn_cat),
      status: text(properties.status),
      mangAuth: text(properties.mang_auth),
      geometry,
    });
  }
  return features;
}
