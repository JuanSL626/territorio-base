/**
 * Escritor de shapefile (`.shp` / `.shx` / `.dbf` / `.prj` / `.cpg`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Por qué está escrito a mano y no sobre `@mapbox/shp-write`:
 *
 * - **H6 (CRÍTICA)**: shp-write trunca los nombres DBF a 10 bytes **sin
 *   desambiguar** y el lector descarta la columna tapada en silencio. Este
 *   proyecto usa nombres de campo largos en español, así que la colisión no es
 *   hipotética. Acá el mapa de nombres es explícito (`dbf-fields.ts`) y hay una
 *   aserción que lanza antes de escribir.
 * - **H7 (ALTA)**: `src/prj.js` de shp-write es un string literal WGS84 y
 *   `write.js` lo usa **incondicionalmente**, ignorando `options.prj`. Todo el
 *   pipeline mide en UTM, así que el bug natural es exportar coordenadas UTM
 *   con un `.prj` que dice WGS84 — un shapefile que abre en QGIS a latitud
 *   2.043.328°. Acá el `.prj` se deriva del EPSG real y, si el EPSG dice
 *   grados, se verifica que las coordenadas efectivamente estén en grados.
 * - El publish de npm está 3 años atrasado y le falta el arreglo de
 *   MultiLineString, que es justo lo que necesitan los `waterway` de OSM. Fijar
 *   la dependencia a un commit de GitHub arrastra un `git+https` al lockfile
 *   por ~250 líneas de escritura binaria que además hay que envolver en
 *   mitigaciones. Escribirlo acá cuesta menos y hace verificable el resultado:
 *   `__tests__/shapefile-reader.ts` vuelve a leer los bytes emitidos y los
 *   tests comparan geometría y atributos.
 *
 * El formato está en la especificación técnica de ESRI (julio 1998) y en la
 * documentación de dBASE III+ para el `.dbf`. Todos los enteros del `.shp` son
 * little-endian salvo los tres campos marcados como big-endian.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { assertSupportedEpsg, WGS84_EPSG, wktForEpsg } from '../crs';
import {
  flattenGeometry,
  type Feature,
  type Geometry,
  type Position,
  type SimpleGeometry,
} from '../geojson';
import {
  assertNoDuplicateDbfNames,
  formatDbfValue,
  inferDbfFields,
  type DbfField,
} from './dbf-fields';

/**
 * Feature exportable: la geometría puede ser `null`, y en ese caso se escribe
 * un registro de tipo Null (el shapefile lo soporta) para no desalinear el
 * `.dbf` respecto del `.shp`.
 */
export type ExportFeature = Feature<Geometry | null>;

/** Un shapefile guarda un solo tipo de geometría; las mezclas se separan en archivos. */
export type ShapefileGeometryClass = 'point' | 'line' | 'polygon';

const SHAPE_TYPE: Record<ShapefileGeometryClass, number> = {
  point: 1, // Point
  line: 3, // PolyLine
  polygon: 5, // Polygon
};

/** Sufijo de archivo por clase, en español, para el bundle. */
export const GEOMETRY_CLASS_SUFFIX: Record<ShapefileGeometryClass, string> = {
  point: 'puntos',
  line: 'lineas',
  polygon: 'poligonos',
};

export type ShapefileParts = {
  geometryClass: ShapefileGeometryClass;
  shp: Uint8Array;
  shx: Uint8Array;
  dbf: Uint8Array;
  prj: string;
  cpg: string;
  /** El mapa `{ nombre largo → nombre DBF }` efectivamente usado (H6). */
  fields: DbfField[];
  featureCount: number;
};

export function geometryClassOf(geometry: Geometry): ShapefileGeometryClass | null {
  switch (geometry.type) {
    case 'Point':
    case 'MultiPoint':
      return 'point';
    case 'LineString':
    case 'MultiLineString':
      return 'line';
    case 'Polygon':
    case 'MultiPolygon':
      return 'polygon';
    case 'GeometryCollection': {
      const classes = new Set(
        flattenGeometry(geometry)
          .map(geometryClassOf)
          .filter((c): c is ShapefileGeometryClass => c !== null),
      );
      const only = [...classes];
      return only.length === 1 ? (only[0] ?? null) : null;
    }
  }
}

function signedRingArea(ring: readonly Position[]): number {
  let sum = 0;
  for (let i = 0; i + 1 < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[i + 1];
    if (a === undefined || b === undefined) continue;
    sum += (a[0] ?? 0) * (b[1] ?? 0) - (b[0] ?? 0) * (a[1] ?? 0);
  }
  return sum / 2;
}

/**
 * El shapefile pide anillos exteriores en **sentido horario** (área con signo
 * negativa) y huecos en antihorario — exactamente al revés que GeoJSON
 * (RFC 7946). Escribirlo al revés produce polígonos que algunos lectores
 * interpretan como huecos gigantes.
 */
function orientRing(ring: readonly Position[], clockwise: boolean): Position[] {
  const isClockwise = signedRingArea(ring) < 0;
  return isClockwise === clockwise ? [...ring] : [...ring].reverse();
}

/** Partes (anillos o líneas) y puntos de una geometría, ya orientadas. */
function partsOf(geometry: SimpleGeometry): Position[][] {
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
      return geometry.coordinates.map((ring, index) => orientRing(ring, index === 0));
    case 'MultiPolygon':
      return geometry.coordinates.flatMap((poly) =>
        poly.map((ring, index) => orientRing(ring, index === 0)),
      );
  }
}

type Box = { xMin: number; yMin: number; xMax: number; yMax: number };

const EMPTY_BOX: Box = { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };

function boxOf(parts: readonly (readonly Position[])[]): Box {
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  for (const part of parts) {
    for (const position of part) {
      const x = position[0];
      const y = position[1];
      if (x === undefined || y === undefined) continue;
      if (x < xMin) xMin = x;
      if (y < yMin) yMin = y;
      if (x > xMax) xMax = x;
      if (y > yMax) yMax = y;
    }
  }
  return Number.isFinite(xMin) ? { xMin, yMin, xMax, yMax } : EMPTY_BOX;
}

function mergeBox(a: Box, b: Box): Box {
  return {
    xMin: Math.min(a.xMin, b.xMin),
    yMin: Math.min(a.yMin, b.yMin),
    xMax: Math.max(a.xMax, b.xMax),
    yMax: Math.max(a.yMax, b.yMax),
  };
}

type ShapeRecord = { shapeType: number; content: Uint8Array; box: Box };

function encodeShape(
  geometry: Geometry | null,
  geometryClass: ShapefileGeometryClass,
): ShapeRecord {
  if (geometry === null) {
    const view = new DataView(new ArrayBuffer(4));
    view.setInt32(0, 0, true); // shape type Null
    return { shapeType: 0, content: new Uint8Array(view.buffer), box: EMPTY_BOX };
  }

  const parts = flattenGeometry(geometry).flatMap(partsOf);
  const box = boxOf(parts);
  const shapeType = SHAPE_TYPE[geometryClass];

  if (geometryClass === 'point') {
    const first = parts[0]?.[0];
    if (first === undefined) {
      return encodeShape(null, geometryClass);
    }
    const view = new DataView(new ArrayBuffer(20));
    view.setInt32(0, shapeType, true);
    view.setFloat64(4, first[0] ?? 0, true);
    view.setFloat64(12, first[1] ?? 0, true);
    return { shapeType, content: new Uint8Array(view.buffer), box };
  }

  const numParts = parts.length;
  const numPoints = parts.reduce((sum, part) => sum + part.length, 0);
  if (numParts === 0 || numPoints === 0) return encodeShape(null, geometryClass);

  const size = 4 + 32 + 4 + 4 + 4 * numParts + 16 * numPoints;
  const view = new DataView(new ArrayBuffer(size));
  view.setInt32(0, shapeType, true);
  view.setFloat64(4, box.xMin, true);
  view.setFloat64(12, box.yMin, true);
  view.setFloat64(20, box.xMax, true);
  view.setFloat64(28, box.yMax, true);
  view.setInt32(36, numParts, true);
  view.setInt32(40, numPoints, true);

  let partOffset = 0;
  let pointCursor = 44 + 4 * numParts;
  for (const [index, part] of parts.entries()) {
    view.setInt32(44 + 4 * index, partOffset, true);
    partOffset += part.length;
    for (const position of part) {
      view.setFloat64(pointCursor, position[0] ?? 0, true);
      view.setFloat64(pointCursor + 8, position[1] ?? 0, true);
      pointCursor += 16;
    }
  }
  return { shapeType, content: new Uint8Array(view.buffer), box };
}

function writeMainHeader(
  target: DataView,
  fileLengthBytes: number,
  shapeType: number,
  box: Box,
): void {
  target.setInt32(0, 9994); // file code, big-endian
  for (let offset = 4; offset < 24; offset += 4) target.setInt32(offset, 0);
  target.setInt32(24, fileLengthBytes / 2); // longitud en palabras de 16 bits, big-endian
  target.setInt32(28, 1000, true); // versión
  target.setInt32(32, shapeType, true);
  target.setFloat64(36, box.xMin, true);
  target.setFloat64(44, box.yMin, true);
  target.setFloat64(52, box.xMax, true);
  target.setFloat64(60, box.yMax, true);
  for (let offset = 68; offset < 100; offset += 8) target.setFloat64(offset, 0, true);
}

function writeGeometryFiles(
  geometries: readonly (Geometry | null)[],
  geometryClass: ShapefileGeometryClass,
): { shp: Uint8Array; shx: Uint8Array } {
  const records = geometries.map((geometry) => encodeShape(geometry, geometryClass));
  const totalContent = records.reduce((sum, record) => sum + 8 + record.content.length, 0);

  const shp = new Uint8Array(100 + totalContent);
  const shx = new Uint8Array(100 + 8 * records.length);
  const shpView = new DataView(shp.buffer);
  const shxView = new DataView(shx.buffer);

  const box = records
    .filter((record) => record.shapeType !== 0)
    .map((record) => record.box)
    .reduce<Box | null>((acc, current) => (acc === null ? current : mergeBox(acc, current)), null);

  writeMainHeader(shpView, shp.length, SHAPE_TYPE[geometryClass], box ?? EMPTY_BOX);
  writeMainHeader(shxView, shx.length, SHAPE_TYPE[geometryClass], box ?? EMPTY_BOX);

  let offset = 100;
  for (const [index, record] of records.entries()) {
    const contentWords = record.content.length / 2;
    shpView.setInt32(offset, index + 1); // número de registro, 1-based, big-endian
    shpView.setInt32(offset + 4, contentWords); // longitud de contenido en palabras, big-endian
    shp.set(record.content, offset + 8);

    shxView.setInt32(100 + 8 * index, offset / 2);
    shxView.setInt32(100 + 8 * index + 4, contentWords);

    offset += 8 + record.content.length;
  }

  return { shp, shx };
}

const encoder = new TextEncoder();

/** Trunca a `maxBytes` sin partir un carácter UTF-8 por la mitad. */
function encodeFixed(value: string, maxBytes: number, align: 'left' | 'right'): Uint8Array {
  let text = value;
  let bytes = encoder.encode(text);
  while (bytes.length > maxBytes) {
    text = text.slice(0, -1);
    bytes = encoder.encode(text);
  }
  const out = new Uint8Array(maxBytes).fill(0x20);
  out.set(bytes, align === 'left' ? 0 : maxBytes - bytes.length);
  return out;
}

function writeDbf(
  records: readonly Record<string, unknown>[],
  fields: readonly DbfField[],
): Uint8Array {
  assertNoDuplicateDbfNames(fields);

  const headerLength = 32 + 32 * fields.length + 1;
  const recordLength = 1 + fields.reduce((sum, field) => sum + field.length, 0);
  const out = new Uint8Array(headerLength + recordLength * records.length + 1);
  const view = new DataView(out.buffer);

  const now = new Date();
  out[0] = 0x03; // dBASE III sin memo
  out[1] = now.getUTCFullYear() - 1900;
  out[2] = now.getUTCMonth() + 1;
  out[3] = now.getUTCDate();
  view.setUint32(4, records.length, true);
  view.setUint16(8, headerLength, true);
  view.setUint16(10, recordLength, true);

  for (const [index, field] of fields.entries()) {
    const base = 32 + 32 * index;
    out.set(
      encodeFixed(field.name, 10, 'left').map((b) => (b === 0x20 ? 0x00 : b)),
      base,
    );
    out[base + 10] = 0x00;
    out[base + 11] = field.type.charCodeAt(0);
    out[base + 16] = field.length;
    out[base + 17] = field.decimals;
  }
  out[headerLength - 1] = 0x0d; // terminador de descriptores

  let cursor = headerLength;
  for (const record of records) {
    out[cursor] = 0x20; // no borrado
    let fieldCursor = cursor + 1;
    for (const field of fields) {
      const raw = formatDbfValue(record[field.longName], field.type);
      const text =
        field.type === 'N' && field.decimals > 0 && raw !== ''
          ? Number(raw).toFixed(field.decimals)
          : raw;
      out.set(encodeFixed(text, field.length, field.type === 'N' ? 'right' : 'left'), fieldCursor);
      fieldCursor += field.length;
    }
    cursor += recordLength;
  }
  out[out.length - 1] = 0x1a; // EOF

  return out;
}

/**
 * H7 — si el EPSG declara grados, verificar que las coordenadas lo sean.
 * Un easting UTM (~400.000) pasado como longitud es el síntoma exacto que
 * describe la crítica, y es silencioso salvo que alguien mire el mapa.
 */
function assertCoordinatesMatchCrs(geometries: readonly (Geometry | null)[], epsg: number): void {
  if (epsg !== WGS84_EPSG) return;
  for (const geometry of geometries) {
    if (geometry === null) continue;
    for (const part of flattenGeometry(geometry).flatMap(partsOf)) {
      for (const position of part) {
        const lon = position[0];
        const lat = position[1];
        if (lon === undefined || lat === undefined) continue;
        if (Math.abs(lon) > 180 || Math.abs(lat) > 90) {
          throw new Error(
            `Se pidió escribir el .prj de EPSG:4326 (grados) pero apareció la coordenada ` +
              `[${lon}, ${lat}], que está fuera del rango geográfico. Casi seguro son metros ` +
              `UTM: reproyectá antes de exportar o pasá el EPSG proyectado (H7).`,
          );
        }
      }
    }
  }
}

export type WriteShapefileOptions = {
  features: readonly ExportFeature[];
  /** EPSG **real** de las coordenadas. Define el `.prj` (H7). */
  epsg: number;
  /** Mapa de campos curado a mano; si no se pasa, se infiere y se desambigua. */
  fields?: DbfField[];
};

/**
 * Escribe un shapefile de un solo tipo de geometría. Lanza si las features
 * mezclan clases (usar `writeShapefileSet` para eso).
 */
export function writeShapefile(options: WriteShapefileOptions): ShapefileParts {
  assertSupportedEpsg(options.epsg);

  const classes = new Set<ShapefileGeometryClass>();
  for (const feature of options.features) {
    if (feature.geometry === null) continue;
    const geometryClass = geometryClassOf(feature.geometry);
    if (geometryClass === null) {
      throw new Error(
        `Geometría no exportable a shapefile: ${feature.geometry.type} con partes de tipos mezclados.`,
      );
    }
    classes.add(geometryClass);
  }
  if (classes.size > 1) {
    throw new Error(
      `Un shapefile guarda un solo tipo de geometría y llegaron ${classes.size} ` +
        `(${[...classes].join(', ')}). Usá writeShapefileSet.`,
    );
  }
  const geometryClass = [...classes][0] ?? 'polygon';

  const geometries = options.features.map((feature) => feature.geometry);
  assertCoordinatesMatchCrs(geometries, options.epsg);

  const records = options.features.map((feature) => feature.properties ?? {});
  const fields = options.fields ?? inferDbfFields(records);
  assertNoDuplicateDbfNames(fields);

  const { shp, shx } = writeGeometryFiles(geometries, geometryClass);

  return {
    geometryClass,
    shp,
    shx,
    dbf: writeDbf(records, fields),
    prj: wktForEpsg(options.epsg),
    // GDAL lee el .cpg para saber la codificación del .dbf; sin él, los
    // acentos de las etiquetas MEPyD salen rotos.
    cpg: 'UTF-8',
    fields,
    featureCount: options.features.length,
  };
}

/**
 * Separa las features por clase de geometría y escribe un shapefile por clase
 * (`…_puntos`, `…_lineas`, `…_poligonos`). Las capas MEPyD y la hidrología de
 * OSM mezclan líneas y polígonos en una sola "capa", así que esto no es un
 * caso raro.
 */
export function writeShapefileSet(
  options: WriteShapefileOptions,
): Map<ShapefileGeometryClass, ShapefileParts> {
  const buckets = new Map<ShapefileGeometryClass, ExportFeature[]>();
  for (const feature of options.features) {
    if (feature.geometry === null) continue;
    const geometryClass = geometryClassOf(feature.geometry);
    if (geometryClass === null) continue;
    const bucket = buckets.get(geometryClass) ?? [];
    bucket.push(feature);
    buckets.set(geometryClass, bucket);
  }

  const out = new Map<ShapefileGeometryClass, ShapefileParts>();
  for (const [geometryClass, features] of buckets) {
    out.set(geometryClass, writeShapefile({ ...options, features }));
  }
  return out;
}
