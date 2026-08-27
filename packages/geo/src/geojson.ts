/**
 * Tipos GeoJSON (RFC 7946) locales al paquete.
 *
 * Por qué no `@types/geojson`: turf **no re-exporta** los tipos de geojson
 * (`@turf/turf` solo re-exporta funciones), así que usarlos obligaría a
 * declarar `@types/geojson` como dependencia directa. Estos alias son
 * estructuralmente idénticos a los de `@types/geojson@7946`, de modo que
 * cualquier valor tipado acá es asignable a las firmas de turf y viceversa
 * (TypeScript es estructural: no hace falta que sea el mismo símbolo).
 *
 * Se usan `type` y no `interface` por la regla
 * `@typescript-eslint/consistent-type-definitions: ['error', 'type']`.
 */

export type BBox =
  [number, number, number, number] | [number, number, number, number, number, number];

/** RFC 7946 §3.1.1. Deliberadamente `number[]` — igual que `@types/geojson`. */
export type Position = number[];

export type GeoJsonProperties = Record<string, unknown> | null;

export type Point = { type: 'Point'; coordinates: Position; bbox?: BBox | undefined };
export type MultiPoint = { type: 'MultiPoint'; coordinates: Position[]; bbox?: BBox | undefined };
export type LineString = { type: 'LineString'; coordinates: Position[]; bbox?: BBox | undefined };
export type MultiLineString = {
  type: 'MultiLineString';
  coordinates: Position[][];
  bbox?: BBox | undefined;
};
export type Polygon = { type: 'Polygon'; coordinates: Position[][]; bbox?: BBox | undefined };
export type MultiPolygon = {
  type: 'MultiPolygon';
  coordinates: Position[][][];
  bbox?: BBox | undefined;
};
export type GeometryCollection = {
  type: 'GeometryCollection';
  geometries: Geometry[];
  bbox?: BBox | undefined;
};

export type Geometry =
  Point | MultiPoint | LineString | MultiLineString | Polygon | MultiPolygon | GeometryCollection;

/** Todo menos `GeometryCollection`: lo único que este paquete escribe a shapefile. */
export type SimpleGeometry = Exclude<Geometry, GeometryCollection>;

export type Feature<G extends Geometry | null = Geometry, P = GeoJsonProperties> = {
  type: 'Feature';
  geometry: G;
  id?: string | number | undefined;
  properties: P;
  bbox?: BBox | undefined;
};

export type FeatureCollection<G extends Geometry | null = Geometry, P = GeoJsonProperties> = {
  type: 'FeatureCollection';
  features: Feature<G, P>[];
  bbox?: BBox | undefined;
};

export type AreaGeometry = Polygon | MultiPolygon;

/** bbox 2D como tupla `(lon_min, lat_min, lon_max, lat_max)` — el contrato del inventario §3. */
export type Bounds2D = [number, number, number, number];

const GEOMETRY_TYPES = new Set<string>([
  'Point',
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
  'GeometryCollection',
]);

export function isGeometry(value: unknown): value is Geometry {
  if (typeof value !== 'object' || value === null) return false;
  const type: unknown = (value as { type?: unknown }).type;
  return typeof type === 'string' && GEOMETRY_TYPES.has(type);
}

/** Aplana `GeometryCollection` a sus partes simples; el resto pasa tal cual. */
export function flattenGeometry(geometry: Geometry): SimpleGeometry[] {
  if (geometry.type === 'GeometryCollection') {
    return geometry.geometries.flatMap(flattenGeometry);
  }
  return [geometry];
}

/**
 * Todos los anillos/líneas de una geometría, como listas de posiciones.
 * Un `Point` devuelve un "anillo" de una sola posición.
 */
export function geometryRings(geometry: Geometry): Position[][] {
  switch (geometry.type) {
    case 'Point':
      return [[geometry.coordinates]];
    case 'MultiPoint':
      return geometry.coordinates.map((p) => [p]);
    case 'LineString':
      return [geometry.coordinates];
    case 'MultiLineString':
      return geometry.coordinates;
    case 'Polygon':
      return geometry.coordinates;
    case 'MultiPolygon':
      return geometry.coordinates.flat();
    case 'GeometryCollection':
      return geometry.geometries.flatMap(geometryRings);
  }
}

/** bbox 2D de cualquier geometría, sin depender de turf. */
export function geometryBounds(geometry: Geometry): Bounds2D {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of geometryRings(geometry)) {
    for (const position of ring) {
      const x = position[0];
      const y = position[1];
      if (x === undefined || y === undefined) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) {
    throw new Error('geometryBounds: la geometría no tiene ninguna coordenada válida.');
  }
  return [minX, minY, maxX, maxY];
}

/** Reproyecta *in place* conceptualmente: devuelve una geometría nueva con `fn` aplicada a cada posición. */
export function mapGeometryPositions(
  geometry: Geometry,
  fn: (position: Position) => Position,
): Geometry {
  switch (geometry.type) {
    case 'Point':
      return { type: 'Point', coordinates: fn(geometry.coordinates) };
    case 'MultiPoint':
      return { type: 'MultiPoint', coordinates: geometry.coordinates.map(fn) };
    case 'LineString':
      return { type: 'LineString', coordinates: geometry.coordinates.map(fn) };
    case 'MultiLineString':
      return { type: 'MultiLineString', coordinates: geometry.coordinates.map((l) => l.map(fn)) };
    case 'Polygon':
      return { type: 'Polygon', coordinates: geometry.coordinates.map((r) => r.map(fn)) };
    case 'MultiPolygon':
      return {
        type: 'MultiPolygon',
        coordinates: geometry.coordinates.map((p) => p.map((r) => r.map(fn))),
      };
    case 'GeometryCollection':
      return {
        type: 'GeometryCollection',
        geometries: geometry.geometries.map((g) => mapGeometryPositions(g, fn)),
      };
  }
}
