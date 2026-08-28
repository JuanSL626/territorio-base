/**
 * Lector de shapefile **solo para tests**.
 *
 * Existe para que los tests de `export/shapefile.ts` sean un round-trip real
 * (escribir bytes → volver a leerlos → comparar geometría y atributos) y no
 * una comprobación de que la función no lanzó. Deliberadamente independiente
 * del escritor: no comparte código con él, así que un error de offsets en el
 * escritor no se cancela con el mismo error en el lector.
 */

export type ReadShape = {
  shapeType: number;
  parts: [number, number][][];
};

export function readShp(bytes: Uint8Array): { shapeType: number; shapes: ReadShape[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getInt32(0) !== 9994) throw new Error('.shp: file code inválido');
  const fileLength = view.getInt32(24) * 2;
  if (fileLength !== bytes.length) {
    throw new Error(`.shp: longitud declarada ${fileLength} ≠ real ${bytes.length}`);
  }
  const headerShapeType = view.getInt32(32, true);

  const shapes: ReadShape[] = [];
  let offset = 100;
  while (offset < bytes.length) {
    const contentLength = view.getInt32(offset + 4) * 2;
    const start = offset + 8;
    const shapeType = view.getInt32(start, true);

    if (shapeType === 0) {
      shapes.push({ shapeType, parts: [] });
    } else if (shapeType === 1) {
      shapes.push({
        shapeType,
        parts: [[[view.getFloat64(start + 4, true), view.getFloat64(start + 12, true)]]],
      });
    } else {
      const numParts = view.getInt32(start + 36, true);
      const numPoints = view.getInt32(start + 40, true);
      const partStarts: number[] = [];
      for (let i = 0; i < numParts; i += 1) {
        partStarts.push(view.getInt32(start + 44 + 4 * i, true));
      }
      const pointsBase = start + 44 + 4 * numParts;
      const points: [number, number][] = [];
      for (let i = 0; i < numPoints; i += 1) {
        points.push([
          view.getFloat64(pointsBase + 16 * i, true),
          view.getFloat64(pointsBase + 16 * i + 8, true),
        ]);
      }
      const parts: [number, number][][] = partStarts.map((partStart, index) =>
        points.slice(partStart, partStarts[index + 1] ?? numPoints),
      );
      shapes.push({ shapeType, parts });
    }
    offset = start + contentLength;
  }
  return { shapeType: headerShapeType, shapes };
}

export function readShx(bytes: Uint8Array): { offset: number; contentLength: number }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: { offset: number; contentLength: number }[] = [];
  for (let cursor = 100; cursor < bytes.length; cursor += 8) {
    out.push({
      offset: view.getInt32(cursor) * 2,
      contentLength: view.getInt32(cursor + 4) * 2,
    });
  }
  return out;
}

export type ReadDbf = {
  fields: { name: string; type: string; length: number; decimals: number }[];
  records: Record<string, string>[];
};

/**
 * Lee el `.dbf` **sin** desambiguar nombres duplicados: si el escritor emitiera
 * dos campos con el mismo nombre, acá se vería exactamente la pérdida
 * silenciosa de columna que describe H6.
 */
export function readDbf(bytes: Uint8Array): ReadDbf {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const recordCount = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);
  const decoder = new TextDecoder('utf-8');

  const fields: ReadDbf['fields'] = [];
  for (let base = 32; base + 32 <= headerLength - 1; base += 32) {
    if (bytes[base] === 0x0d) break;
    const rawName = bytes.slice(base, base + 11);
    const end = rawName.indexOf(0);
    const name = decoder.decode(rawName.slice(0, end === -1 ? 11 : end));
    fields.push({
      name,
      type: String.fromCharCode(bytes[base + 11] ?? 0),
      length: bytes[base + 16] ?? 0,
      decimals: bytes[base + 17] ?? 0,
    });
  }

  const records: Record<string, string>[] = [];
  for (let i = 0; i < recordCount; i += 1) {
    const base = headerLength + recordLength * i;
    let cursor = base + 1;
    // Objeto plano: una clave repetida pisa a la anterior, igual que hace
    // cualquier lector real. Ese es el fallo que H6 describe.
    const record: Record<string, string> = {};
    for (const field of fields) {
      record[field.name] = decoder.decode(bytes.slice(cursor, cursor + field.length)).trim();
      cursor += field.length;
    }
    records.push(record);
  }
  return { fields, records };
}
