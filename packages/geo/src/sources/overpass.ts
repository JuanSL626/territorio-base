/**
 * Hidrología vía Overpass API (OpenStreetMap) — sin registro.
 *
 * Port de `services/api/src/territorio_base/sources/osm.py`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REGRESIÓN #2 DEL INVENTARIO — se preserva textualmente. No tocar sin leer
 * `00-legacy-inventory.md` §9.2 completo.
 *
 * Historia: (a) solo `overpass-api.de`, 504 en horas pico; (b) se sumaron
 * mirrors de terceros; (c) se probó `overpass.osm.ch` y devuelve **0
 * resultados en todo el Caribe** — rechazado por ser *peor que no tener
 * fallback*, porque falla en silencio con datos incompletos en vez de dar
 * error; (d) lista final de 5 URLs, verificando que `z`/`lz4` comparten
 * `timestamp_osm_base` con el cluster principal; (e) en producción los 3 del
 * cluster principal fallaron juntos (bloqueo a nivel de infraestructura contra
 * la IP de salida), por eso hay 2 proveedores genuinamente independientes.
 *
 * Invariantes que el port mantiene:
 *   1. Las 5 URLs, **en este orden**.
 *   2. Timeout `(connect 5 s, read 30 s)` para fallar rápido contra un mirror
 *      caído (ver `http.ts`).
 *   3. El User-Agent identificable.
 *   4. `overpass.osm.ch` **excluido a propósito** (ver `EXCLUDED_MIRRORS`).
 *   5. **Un HTTP 200 no prueba que los datos estén completos.** Overpass
 *      devuelve 200 con un campo `remark` cuando la consulta se le agotó o se
 *      quedó sin memoria, y el `elements` que acompaña está truncado. Esa
 *      respuesta se trata como fallo del mirror y se pasa al siguiente.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { z } from 'zod';

import { bufferAoiOrOriginal, type Aoi } from '../aoi';
import {
  geometryBounds,
  type Geometry,
  type MultiLineString,
  type MultiPolygon,
  type Position,
} from '../geojson';
import { postFormJson, type RequestOptions } from '../http';

/** Los 5 mirrors, en orden de intento. El orden es parte del contrato. */
export const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
] as const;

/**
 * Mirrors evaluados y descartados, con el motivo. Está exportado (y con test)
 * para que la razón viaje con el código y no solo con un comentario: alguien
 * que "mejore" la resiliencia agregando mirrors tiene que leer esto primero.
 */
export const EXCLUDED_MIRRORS: readonly { url: string; reason: string }[] = [
  {
    url: 'https://overpass.osm.ch/api/interpreter',
    reason:
      'Responde rápido y con HTTP 200, pero devuelve 0 resultados para todo el Caribe: ' +
      'parece ser un extracto regional europeo, no una réplica global. Es PEOR que no ' +
      'tener fallback, porque falla en silencio con datos incompletos en vez de dar error.',
  },
];

export const HYDROLOGY_BUFFER_M = 500;

/** `waterway` | `water_body` | `wetland` — el esquema fijo del inventario §6. */
export type HydrologyKind = 'waterway' | 'water_body' | 'wetland';

export type HydrologyFeature = {
  osmId: number;
  kind: HydrologyKind;
  name: string | null;
  geometry: Geometry;
};

export type OsmContextKind = 'road' | 'building' | 'amenity' | 'landuse';

export type OsmContextFeature = {
  osmId: number;
  osmType: 'node' | 'way' | 'relation';
  kind: OsmContextKind;
  subtype: string;
  name: string | null;
  geometry: Geometry;
};

export type OsmBundle = {
  hydrology: HydrologyFeature[];
  context: OsmContextFeature[];
  /** `true` sólo cuando se alcanzó el límite explícito de la consulta. */
  truncated: boolean;
};

export const OSM_ELEMENT_LIMIT = 1_500;

export class OverpassUnavailableError extends Error {
  override readonly name = 'OverpassUnavailableError';
  /** Un error por mirror, en orden de intento. */
  readonly attempts: readonly { url: string; error: unknown }[];

  constructor(attempts: readonly { url: string; error: unknown }[]) {
    super(
      `Los ${attempts.length} mirrors de Overpass fallaron: ` +
        attempts.map((a) => `${a.url} (${String(a.error)})`).join('; '),
    );
    this.attempts = attempts;
  }
}

function buildQuery(bounds: readonly [number, number, number, number]): string {
  const [west, south, east, north] = bounds;
  const bbox = `${south},${west},${north},${east}`;
  return `
[out:json][timeout:60][maxsize:67108864];
(
  way["waterway"](${bbox});
  way["natural"="water"](${bbox});
  relation["natural"="water"](${bbox});
  way["natural"="wetland"](${bbox});
  relation["natural"="wetland"](${bbox});
  way["highway"](${bbox});
  way["building"](${bbox});
  relation["building"](${bbox});
  nwr["amenity"](${bbox});
  nwr["shop"](${bbox});
  nwr["tourism"](${bbox});
  nwr["leisure"](${bbox});
  way["landuse"](${bbox});
  relation["landuse"](${bbox});
);
out body geom qt ${String(OSM_ELEMENT_LIMIT)};
`;
}

const positionSchema = z.object({ lat: z.number(), lon: z.number() });

const elementSchema = z.object({
  type: z.enum(['node', 'way', 'relation']),
  id: z.number(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  tags: z.record(z.string(), z.string()).optional(),
  geometry: z.array(positionSchema).optional(),
  members: z
    .array(
      z.object({
        role: z.string().optional(),
        geometry: z.array(positionSchema).optional(),
      }),
    )
    .optional(),
});

const responseSchema = z.object({
  /** Overpass lo manda con HTTP 200 cuando la consulta se agotó o se quedó sin memoria. */
  remark: z.string().optional(),
  elements: z.array(elementSchema),
});

export type OverpassElement = z.infer<typeof elementSchema>;

function toPositions(nodes: { lat: number; lon: number }[]): Position[] {
  return nodes.map((n) => [n.lon, n.lat]);
}

function isClosedRing(coords: Position[]): boolean {
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first === undefined || last === undefined) return false;
  return coords.length >= 4 && first[0] === last[0] && first[1] === last[1];
}

/**
 * Misma regla que `osm.py::_geometry_from_element`: <2 puntos → `Point`;
 * cerrado y con ≥4 vértices → `Polygon`; si no → `LineString`.
 *
 * **Divergencia deliberada y documentada:** el original solo miraba
 * `el["geometry"]`, que las *relations* no traen (traen `members[].geometry`),
 * así que `relation["natural"="water"]` se consultaba y después se descartaba
 * entera — es decir, las lagunas mapeadas como multipolígono desaparecían del
 * análisis en silencio. Acá las relations se arman desde sus miembros. Es
 * exactamente la clase de "200 no significa datos completos" que la regresión
 * #2 pide no repetir, así que se corrige en vez de portarse el hueco.
 */
export function geometryFromElement(element: OverpassElement): Geometry | null {
  if (element.type === 'node' && element.lat !== undefined && element.lon !== undefined) {
    return { type: 'Point', coordinates: [element.lon, element.lat] };
  }
  if (element.geometry !== undefined && element.geometry.length > 0) {
    const coords = toPositions(element.geometry);
    const first = coords[0];
    if (first === undefined) return null;
    if (coords.length < 2) return { type: 'Point', coordinates: first };
    if (isClosedRing(coords)) return { type: 'Polygon', coordinates: [coords] };
    return { type: 'LineString', coordinates: coords };
  }

  const memberGeometries = (element.members ?? [])
    .map((m) => m.geometry)
    .filter((g): g is { lat: number; lon: number }[] => g !== undefined && g.length >= 2)
    .map(toPositions);
  if (memberGeometries.length === 0) return null;

  if (memberGeometries.every(isClosedRing)) {
    const multiPolygon: MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: memberGeometries.map((ring) => [ring]),
    };
    return multiPolygon;
  }
  const multiLine: MultiLineString = { type: 'MultiLineString', coordinates: memberGeometries };
  return multiLine;
}

export function classifyElement(tags: Record<string, string> | undefined): HydrologyKind {
  const t = tags ?? {};
  if ('waterway' in t) return 'waterway';
  if (t.natural === 'wetland') return 'wetland';
  return 'water_body';
}

function classifyContextElement(
  tags: Record<string, string> | undefined,
): { kind: OsmContextKind; subtype: string } | null {
  const t = tags ?? {};
  if (t.highway !== undefined) return { kind: 'road', subtype: t.highway };
  if (t.building !== undefined) return { kind: 'building', subtype: t.building };
  for (const key of ['amenity', 'shop', 'tourism', 'leisure'] as const) {
    if (t[key] !== undefined) return { kind: 'amenity', subtype: `${key}=${t[key]}` };
  }
  if (t.landuse !== undefined) return { kind: 'landuse', subtype: t.landuse };
  return null;
}

/**
 * Recorre los mirrors en orden y devuelve la primera respuesta *completa*.
 * Un `remark` de Overpass, un JSON que no valida, un 5xx o un timeout cuentan
 * todos como fallo del mirror.
 */
export async function queryOverpass(
  query: string,
  options: RequestOptions & { mirrors?: readonly string[] } = {},
): Promise<z.infer<typeof responseSchema>> {
  const mirrors = options.mirrors ?? OVERPASS_MIRRORS;
  const attempts: { url: string; error: unknown }[] = [];

  for (const url of mirrors) {
    try {
      const payload = await postFormJson(url, { data: query }, options);
      const parsed = responseSchema.parse(payload);
      if (parsed.remark !== undefined) {
        // HTTP 200 con datos truncados. Explícitamente NO es un éxito.
        throw new Error(`Overpass devolvió 200 con remark (datos incompletos): ${parsed.remark}`);
      }
      return parsed;
    } catch (error) {
      attempts.push({ url, error });
    }
  }
  throw new OverpassUnavailableError(attempts);
}

/**
 * Cursos y cuerpos de agua de OSM dentro de un buffer alrededor del AOI
 * (500 m por defecto, igual que el legacy).
 *
 * Lanza `OverpassUnavailableError` si los 5 mirrors fallan (UC-09); el
 * llamador lo traduce a `available: false`, que es semánticamente distinto de
 * "consulté y no hay nada" (inventario §3).
 */
export async function fetchOsmBundle(
  aoi: Aoi,
  options: RequestOptions & { bufferM?: number; mirrors?: readonly string[] } = {},
): Promise<OsmBundle> {
  const searchArea = bufferAoiOrOriginal(aoi, options.bufferM ?? HYDROLOGY_BUFFER_M);
  const data = await queryOverpass(buildQuery(geometryBounds(searchArea)), options);

  const hydrology: HydrologyFeature[] = [];
  const context: OsmContextFeature[] = [];
  const seen = new Set<string>();
  for (const element of data.elements) {
    const key = `${element.type}:${String(element.id)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const geometry = geometryFromElement(element);
    if (geometry === null) continue;
    const tags = element.tags ?? {};
    if ('waterway' in tags || tags.natural === 'water' || tags.natural === 'wetland') {
      hydrology.push({
        osmId: element.id,
        kind: classifyElement(tags),
        name: tags.name ?? null,
        geometry,
      });
    }
    const classification = classifyContextElement(tags);
    if (classification !== null) {
      context.push({
        osmId: element.id,
        osmType: element.type,
        ...classification,
        name: tags.name ?? null,
        geometry,
      });
    }
  }
  return { hydrology, context, truncated: data.elements.length >= OSM_ELEMENT_LIMIT };
}

/** Compatibilidad para consumidores que sólo necesitan hidrología. */
export async function fetchHydrology(
  aoi: Aoi,
  options: RequestOptions & { bufferM?: number; mirrors?: readonly string[] } = {},
): Promise<HydrologyFeature[]> {
  return (await fetchOsmBundle(aoi, options)).hydrology;
}
