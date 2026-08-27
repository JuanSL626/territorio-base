/**
 * Matemática vectorial del pipeline, con las tres correcciones que el port
 * ingenuo desde shapely no tiene (`03-critique-2.md`):
 *
 * - **H8**: turf no tiene distancia geometría↔geometría. Sus únicas primitivas
 *   (`distance`, `pointToLineDistance`, `pointToPolygonDistance`) están
 *   ancladas a un punto. Portar `gs.distance(aoi_utm)` con vértice-a-vértice
 *   sobre-reporta hasta 79× (los waterways de OSM se digitalizan con vértices
 *   a kilómetros). Acá la distancia es **segmento a segmento**, exacta, igual
 *   que shapely.
 * - **H9**: `distances == 0` como test de intersección no sobrevive al port.
 *   En shapely las geometrías que se tocan dan exactamente `0.0`; en punto
 *   flotante JS dan `1e-13`. La intersección se decide con
 *   `booleanIntersects`, **nunca** comparando la distancia con cero.
 * - **H10**: `turf.buffer` es azimutal-equidistante **esférica** y su radio
 *   real varía ~3 m por acimut; además devuelve `undefined` en degenerados y
 *   no disuelve FeatureCollections. Acá el buffer se hace **plano, en la zona
 *   UTM del AOI** (idéntico a `GeoSeries.to_crs(utm).buffer(m)` de Python),
 *   con unión disuelta y error explícito en degenerados.
 *
 * Convención de este módulo: las funciones `planar*` asumen coordenadas ya
 * proyectadas a metros (UTM). Las funciones `*Meters` reciben WGS84 y hacen
 * la proyección ellas mismas.
 */

import { booleanIntersects, featureCollection, intersect, polygon, union } from '@turf/turf';

import { projectGeometry, WGS84_EPSG, type UtmEpsg } from './crs';
import {
  flattenGeometry,
  geometryBounds,
  geometryRings,
  mapGeometryPositions,
  type AreaGeometry,
  type Geometry,
  type MultiPolygon,
  type Polygon,
  type Position,
} from './geojson';

export type Segment = readonly [Position, Position];

/** Segmentos de cualquier geometría. Un `Point`/`MultiPoint` no aporta ninguno. */
export function segmentsOf(geometry: Geometry): Segment[] {
  const segments: Segment[] = [];
  for (const part of flattenGeometry(geometry)) {
    if (part.type === 'Point' || part.type === 'MultiPoint') continue;
    for (const ring of geometryRings(part)) {
      for (let i = 0; i + 1 < ring.length; i += 1) {
        const a = ring[i];
        const b = ring[i + 1];
        if (a === undefined || b === undefined) continue;
        segments.push([a, b]);
      }
    }
  }
  return segments;
}

/** Posiciones sueltas (solo de geometrías puntuales). */
export function pointsOf(geometry: Geometry): Position[] {
  const points: Position[] = [];
  for (const part of flattenGeometry(geometry)) {
    if (part.type === 'Point') points.push(part.coordinates);
    else if (part.type === 'MultiPoint') points.push(...part.coordinates);
  }
  return points;
}

function xy(position: Position): readonly [number, number] {
  const x = position[0];
  const y = position[1];
  if (x === undefined || y === undefined) {
    throw new Error('Posición GeoJSON con menos de 2 coordenadas.');
  }
  return [x, y];
}

/** Distancia punto↔segmento en el plano (proyección sobre el segmento, acotada). */
export function pointToSegmentDistance(p: Position, a: Position, b: Position): number {
  const [px, py] = xy(p);
  const [ax, ay] = xy(a);
  const [bx, by] = xy(b);
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function segmentsProperlyIntersect(a: Segment, b: Segment): boolean {
  const [p1x, p1y] = xy(a[0]);
  const [p2x, p2y] = xy(a[1]);
  const [q1x, q1y] = xy(b[0]);
  const [q2x, q2y] = xy(b[1]);
  const rx = p2x - p1x;
  const ry = p2y - p1y;
  const sx = q2x - q1x;
  const sy = q2y - q1y;
  const denominator = rx * sy - ry * sx;
  if (denominator === 0) return false;
  const t = ((q1x - p1x) * sy - (q1y - p1y) * sx) / denominator;
  const u = ((q1x - p1x) * ry - (q1y - p1y) * rx) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/**
 * Distancia mínima segmento↔segmento (H8). Si se cruzan, 0; si no, el mínimo
 * de las cuatro distancias extremo↔segmento. Es la misma definición que usa
 * GEOS/shapely.
 */
export function segmentToSegmentDistance(a: Segment, b: Segment): number {
  if (segmentsProperlyIntersect(a, b)) return 0;
  return Math.min(
    pointToSegmentDistance(a[0], b[0], b[1]),
    pointToSegmentDistance(a[1], b[0], b[1]),
    pointToSegmentDistance(b[0], a[0], a[1]),
    pointToSegmentDistance(b[1], a[0], a[1]),
  );
}

/**
 * Distancia mínima entre dos geometrías **ya proyectadas al mismo CRS plano**.
 *
 * No decide contención: dos polígonos anidados sin bordes que se toquen dan la
 * distancia entre sus bordes, no 0. Por eso `distanceMeters` consulta primero
 * `booleanIntersects` (H9) y solo llama acá si están disjuntas.
 */
export function planarDistance(a: Geometry, b: Geometry): number {
  const segmentsA = segmentsOf(a);
  const segmentsB = segmentsOf(b);
  const pointsA = pointsOf(a);
  const pointsB = pointsOf(b);

  let best = Infinity;

  for (const sa of segmentsA) {
    for (const sb of segmentsB) {
      const d = segmentToSegmentDistance(sa, sb);
      if (d < best) best = d;
      if (best === 0) return 0;
    }
  }
  for (const p of pointsA) {
    for (const sb of segmentsB) {
      const d = pointToSegmentDistance(p, sb[0], sb[1]);
      if (d < best) best = d;
    }
  }
  for (const p of pointsB) {
    for (const sa of segmentsA) {
      const d = pointToSegmentDistance(p, sa[0], sa[1]);
      if (d < best) best = d;
    }
  }
  for (const pa of pointsA) {
    for (const pb of pointsB) {
      const [ax, ay] = xy(pa);
      const [bx, by] = xy(pb);
      const d = Math.hypot(ax - bx, ay - by);
      if (d < best) best = d;
    }
  }

  if (!Number.isFinite(best)) {
    throw new Error('planarDistance: alguna de las geometrías está vacía.');
  }
  return best;
}

/**
 * Test de intersección topológico (H9). **Nunca** usar `distance === 0`.
 *
 * `booleanIntersects` cubre además la contención (un lago enteramente dentro
 * del AOI intersecta aunque sus bordes estén a 200 m), que la distancia
 * borde-a-borde no detectaría.
 */
export function intersects(a: Geometry, b: Geometry): boolean {
  for (const partA of flattenGeometry(a)) {
    for (const partB of flattenGeometry(b)) {
      if (booleanIntersects(partA, partB)) return true;
    }
  }
  return false;
}

/**
 * Distancia en metros entre dos geometrías WGS84, medida en la zona UTM dada.
 * Devuelve exactamente `0` cuando se intersectan (H9), sin comparar floats.
 */
export function distanceMeters(a: Geometry, b: Geometry, utmEpsg: UtmEpsg): number {
  if (intersects(a, b)) return 0;
  return planarDistance(
    projectGeometry(a, WGS84_EPSG, utmEpsg),
    projectGeometry(b, WGS84_EPSG, utmEpsg),
  );
}

/** Área con la fórmula del zapatero sobre coordenadas planas (m² si es UTM). */
function ringArea(ring: Position[]): number {
  let sum = 0;
  for (let i = 0; i + 1 < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[i + 1];
    if (a === undefined || b === undefined) continue;
    const [ax, ay] = xy(a);
    const [bx, by] = xy(b);
    sum += ax * by - bx * ay;
  }
  return sum / 2;
}

/**
 * Área plana en m². Se usa esto y **no** `turf.area`, que asume grados
 * lon/lat y devolvería un disparate sobre coordenadas UTM.
 */
export function planarArea(geometry: Geometry): number {
  let total = 0;
  for (const part of flattenGeometry(geometry)) {
    if (part.type === 'Polygon') {
      for (const [index, ring] of part.coordinates.entries()) {
        total += index === 0 ? Math.abs(ringArea(ring)) : -Math.abs(ringArea(ring));
      }
    } else if (part.type === 'MultiPolygon') {
      for (const poly of part.coordinates) {
        for (const [index, ring] of poly.entries()) {
          total += index === 0 ? Math.abs(ringArea(ring)) : -Math.abs(ringArea(ring));
        }
      }
    }
  }
  return total;
}

/** Área en hectáreas de una geometría WGS84, calculada en UTM (igual que Python). */
export function areaHectares(geometry: Geometry, utmEpsg: UtmEpsg): number {
  return planarArea(projectGeometry(geometry, WGS84_EPSG, utmEpsg)) / 10_000;
}

function asAreaGeometry(geometry: Geometry): AreaGeometry {
  if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') return geometry;
  throw new Error(`Se esperaba Polygon o MultiPolygon y llegó ${geometry.type}.`);
}

/** Une (disuelve) varias geometrías de área en una sola. Equivale a `union_all()`. */
export function unionAreas(geometries: AreaGeometry[]): AreaGeometry {
  const parts = geometries.flatMap((g) =>
    flattenGeometry(g).filter((p) => p.type === 'Polygon' || p.type === 'MultiPolygon'),
  ) as AreaGeometry[];
  const first = parts[0];
  if (first === undefined) throw new Error('unionAreas: no se pasó ninguna geometría de área.');
  if (parts.length === 1) return first;

  const collection = featureCollection(
    parts.map((geometry) => ({ type: 'Feature' as const, properties: {}, geometry })),
  );
  const merged = union(collection);
  if (merged === null) throw new Error('unionAreas: la unión quedó vacía.');
  return asAreaGeometry(merged.geometry);
}

/** Intersección de dos geometrías de área **planas**; `null` si no se tocan. */
export function planarIntersection(a: AreaGeometry, b: AreaGeometry): AreaGeometry | null {
  const result = intersect(
    featureCollection([
      { type: 'Feature' as const, properties: {}, geometry: a },
      { type: 'Feature' as const, properties: {}, geometry: b },
    ]),
  );
  return result === null ? null : asAreaGeometry(result.geometry);
}

/** Cantidad de segmentos por cuadrante del círculo. 8 = el default de GEOS/shapely. */
export const BUFFER_QUAD_SEGMENTS = 8;

function circlePolygon(center: Position, radius: number, quadSegments: number): Polygon {
  const [cx, cy] = xy(center);
  const steps = quadSegments * 4;
  const ring: Position[] = [];
  for (let i = 0; i < steps; i += 1) {
    const angle = (2 * Math.PI * i) / steps;
    ring.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  const first = ring[0];
  if (first === undefined) throw new Error('circlePolygon: quadSegments inválido.');
  ring.push(first);
  return polygon([ring]).geometry;
}

/**
 * "Estadio": el rectángulo del segmento más las dos semicircunferencias de los
 * extremos, **como un solo polígono**.
 *
 * Se emite así, y no como rectángulo + círculos por separado, porque
 * `polyclip-ts` (el motor de `turf.union`) falla con
 * `Unable to complete output ring` cuando le llegan decenas de polígonos
 * exactamente tangentes entre sí — que es justo lo que produce la
 * descomposición manga+círculo, donde cada círculo toca la manga en un único
 * punto. Los estadios se solapan generosamente en vez de rozarse, y la unión
 * es estable.
 */
function segmentStadium(
  a: Position,
  b: Position,
  radius: number,
  quadSegments: number,
): Polygon | null {
  const [ax, ay] = xy(a);
  const [bx, by] = xy(b);
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;

  const nx = (-dy / length) * radius;
  const ny = (dx / length) * radius;
  const steps = quadSegments * 2; // 16 segmentos por semicírculo = 32 por círculo (GEOS)
  const ring: Position[] = [
    [ax + nx, ay + ny],
    [bx + nx, by + ny],
  ];

  const startAngleB = Math.atan2(ny, nx);
  for (let i = 1; i < steps; i += 1) {
    const angle = startAngleB - (Math.PI * i) / steps;
    ring.push([bx + radius * Math.cos(angle), by + radius * Math.sin(angle)]);
  }
  ring.push([bx - nx, by - ny], [ax - nx, ay - ny]);

  const startAngleA = Math.atan2(-ny, -nx);
  for (let i = 1; i < steps; i += 1) {
    const angle = startAngleA - (Math.PI * i) / steps;
    ring.push([ax + radius * Math.cos(angle), ay + radius * Math.sin(angle)]);
  }
  ring.push([ax + nx, ay + ny]);
  return polygon([ring]).geometry;
}

/**
 * Buffer positivo **plano** (Minkowski con un disco poligonalizado), en las
 * unidades de las coordenadas de entrada. Reemplaza a `turf.buffer` (H10).
 *
 * Construcción: manga rectangular por segmento + círculo de `radius` en cada
 * vértice (junta redonda, el default de shapely) + la geometría original,
 * todo disuelto en una unión. Con `quadSegments = 8` el polígono resultante es
 * inscripto, exactamente como el de GEOS/shapely: el radio medido varía entre
 * `r·cos(π/32)` y `r`, que es el mismo comportamiento del lado Python.
 */
export function planarBuffer(
  geometry: Geometry,
  radius: number,
  quadSegments: number = BUFFER_QUAD_SEGMENTS,
): Polygon | MultiPolygon {
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new Error(`planarBuffer: el radio debe ser un número positivo, llegó ${radius}.`);
  }

  // Se trabaja en coordenadas locales (origen en la esquina del bbox) y
  // redondeadas a 1e-6 m. `polyclip-ts` — el motor de `turf.union` — falla con
  // "Unable to complete output ring" cuando le llegan decenas de polígonos casi
  // coincidentes expresados con eastings UTM de seis cifras: la magnitud se
  // come los dígitos significativos. Restar el origen recupera esa precisión, y
  // el redondeo elimina los vértices duplicados-pero-no-idénticos que generan
  // los solapes.
  const [originX, originY] = geometryBounds(geometry);
  const localize = (position: Position): Position => [
    Math.round(((position[0] ?? 0) - originX) * 1e6) / 1e6,
    Math.round(((position[1] ?? 0) - originY) * 1e6) / 1e6,
  ];
  const local = mapGeometryPositions(geometry, localize);

  const pieces: AreaGeometry[] = [];
  for (const part of flattenGeometry(local)) {
    if (part.type === 'Polygon' || part.type === 'MultiPolygon') pieces.push(part);
  }
  const segments = segmentsOf(local);
  for (const segment of segments) {
    const stadium = segmentStadium(segment[0], segment[1], radius, quadSegments);
    if (stadium !== null) pieces.push(stadium);
  }
  if (segments.length === 0) {
    // Geometría puntual: el buffer es un disco por punto.
    for (const point of pointsOf(local)) pieces.push(circlePolygon(point, radius, quadSegments));
  }
  if (pieces.length === 0) {
    throw new Error('planarBuffer: la geometría de entrada no tiene coordenadas.');
  }

  const merged = unionAreas(pieces);
  const restored = mapGeometryPositions(merged, (position) => [
    (position[0] ?? 0) + originX,
    (position[1] ?? 0) + originY,
  ]);
  return asAreaGeometry(restored);
}

/**
 * Buffer en metros de una geometría WGS84: se proyecta a la zona UTM del AOI,
 * se bufferea en el plano y se vuelve a WGS84 — la misma secuencia que
 * `aoi.py::buffer_wgs84`.
 */
export function bufferMeters(
  geometry: Geometry,
  meters: number,
  utmEpsg: UtmEpsg,
  quadSegments: number = BUFFER_QUAD_SEGMENTS,
): AreaGeometry {
  const projected = projectGeometry(geometry, WGS84_EPSG, utmEpsg);
  const buffered = planarBuffer(projected, meters, quadSegments);
  return asAreaGeometry(projectGeometry(buffered, utmEpsg, WGS84_EPSG));
}

/**
 * Anillos exteriores de una geometría de área, en el formato `rings` de ArcGIS.
 *
 * Python hacía `search_area.exterior.coords`, que **revienta con
 * `AttributeError` si el buffer devuelve un MultiPolygon** (AOI multiparte, o
 * dos partes que el buffer no llega a unir). Acá se emiten todos los anillos
 * de todas las partes, que es lo que la API de ArcGIS acepta igual.
 */
export function arcgisRings(geometry: AreaGeometry): Position[][] {
  const rings: Position[][] = [];
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const poly of polygons) {
    for (const [index, ring] of poly.entries()) {
      // ArcGIS espera anillos exteriores en sentido horario y huecos en
      // antihorario; GeoJSON (RFC 7946) usa la convención opuesta.
      const oriented = [...ring];
      const isClockwise = ringArea(ring) < 0;
      const wantClockwise = index === 0;
      if (isClockwise !== wantClockwise) oriented.reverse();
      rings.push(oriented);
    }
  }
  return rings;
}
