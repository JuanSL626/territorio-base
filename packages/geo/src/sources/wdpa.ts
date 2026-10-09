/**
 * Áreas protegidas (WDPA) vía el ArcGIS FeatureServer público de UNEP-WCMC.
 *
 * Port de `services/api/src/territorio_base/sources/protected_areas.py`.
 *
 * Es la misma base que expone Protected Planet, pero este servicio permite
 * consultas espaciales directas sin token (Protected Planet sí lo pide).
 */

import { z } from 'zod';

import { bufferAoiOrOriginal, type Aoi } from '../aoi';
import { isGeometry, type AreaGeometry, type Geometry } from '../geojson';
import { arcgisRings } from '../geometry';
import { postFormJson, type RequestOptions } from '../http';
import { isInColombia } from './colombia';

export const WDPA_QUERY_URL =
  'https://data-gis.unep-wcmc.org/arcgis/rest/services/ProtectedSites/' +
  'The_World_Database_of_Protected_Areas/FeatureServer/1/query';

export const RUNAP_QUERY_URL =
  'https://mapas.parquesnacionales.gov.co/arcgis/rest/services/pnn/runap/FeatureServer/0/query';

export const WDPA_BUFFER_M = 1000;

/** `outFields` fijos del legacy (inventario §6). El orden es el del servicio. */
export const WDPA_OUT_FIELDS = ['name', 'desig', 'desig_eng', 'iucn_cat', 'status', 'mang_auth'];
export const RUNAP_OUT_FIELDS = [
  'objectid',
  'ap_nombre',
  'ap_categoria',
  'condicion',
  'organizacion',
  'fecha_registro',
  'fecha_inscrita',
];

export type ProtectedAreaFeature = {
  name: string | null;
  /** Designación en el idioma original. Se trae pero la UI legacy nunca la muestra. */
  desig: string | null;
  desigEng: string | null;
  iucnCat: string | null;
  status: string | null;
  /** Autoridad de manejo. Se trae pero la UI legacy nunca la muestra. */
  mangAuth: string | null;
  sourceName?: string;
  sourceYear?: string;
  registrationDate?: string | null;
  geometry: Geometry;
};

export class WdpaUnavailableError extends Error {
  override readonly name = 'WdpaUnavailableError';

  constructor(cause: unknown) {
    super(`No se pudo consultar la fuente oficial de áreas protegidas: ${String(cause)}`, {
      cause,
    });
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
  properties: z.object({ exceededTransferLimit: z.boolean().optional() }).nullable().optional(),
});

function text(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number') return String(value);
  return null;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
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
  options: RequestOptions & { bufferM?: number; url?: string; now?: () => Date } = {},
): Promise<ProtectedAreaFeature[]> {
  const searchArea: AreaGeometry = bufferAoiOrOriginal(aoi, options.bufferM ?? WDPA_BUFFER_M);
  const useRunap = options.url === undefined && isInColombia(aoi.bbox);
  const sourceYear = String((options.now?.() ?? new Date()).getUTCFullYear());
  const features: ProtectedAreaFeature[] = [];
  const failOrFallback = (cause: unknown): Promise<ProtectedAreaFeature[]> => {
    if (useRunap) return fetchProtectedAreas(aoi, { ...options, url: WDPA_QUERY_URL });
    throw new WdpaUnavailableError(cause);
  };

  for (let page = 0; page < (useRunap ? 20 : 1); page += 1) {
    let payload: unknown;
    try {
      payload = await postFormJson(
        useRunap ? RUNAP_QUERY_URL : (options.url ?? WDPA_QUERY_URL),
        {
          geometry: JSON.stringify({
            rings: arcgisRings(searchArea),
            spatialReference: { wkid: 4326 },
          }),
          geometryType: 'esriGeometryPolygon',
          inSR: '4326',
          spatialRel: 'esriSpatialRelIntersects',
          outFields: (useRunap ? RUNAP_OUT_FIELDS : WDPA_OUT_FIELDS).join(','),
          returnGeometry: 'true',
          outSR: '4326',
          f: 'geojson',
          ...(useRunap
            ? {
                orderByFields: 'objectid',
                resultOffset: String(page * 1000),
                resultRecordCount: '1000',
              }
            : {}),
        },
        { timeouts: { connectMs: useRunap ? 10_000 : 5_000, readMs: 60_000 }, ...options },
      );
    } catch (cause) {
      return failOrFallback(cause);
    }

    const parsed = featureCollectionSchema.safeParse(payload);
    if (!parsed.success) return failOrFallback(parsed.error);
    if (parsed.data.error !== undefined) return failOrFallback(parsed.data.error);

    for (const feature of parsed.data.features ?? []) {
      const geometry: unknown = feature.geometry;
      if (!isGeometry(geometry)) continue;
      const properties = feature.properties ?? {};
      features.push({
        name: text(properties[useRunap ? 'ap_nombre' : 'name']),
        desig: text(properties[useRunap ? 'ap_categoria' : 'desig']),
        desigEng: useRunap ? null : text(properties.desig_eng),
        iucnCat: useRunap ? null : text(properties.iucn_cat),
        status: text(properties[useRunap ? 'condicion' : 'status']),
        mangAuth: text(properties[useRunap ? 'organizacion' : 'mang_auth']),
        sourceName: useRunap
          ? 'RUNAP — Parques Nacionales Naturales de Colombia'
          : 'WDPA — UNEP-WCMC',
        sourceYear,
        registrationDate: useRunap
          ? (isoDate(properties.fecha_registro) ?? isoDate(properties.fecha_inscrita))
          : null,
        geometry,
      });
    }

    if (parsed.data.properties?.exceededTransferLimit !== true) return features;
  }

  return failOrFallback('RUNAP excedió el límite de 20 páginas.');
}
