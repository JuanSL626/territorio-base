/**
 * Mapa explícito `{ nombre largo → nombre DBF }` con aserción de colisiones.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * H6 — SEVERIDAD CRÍTICA, VERIFICADA. Esta es la razón por la que este archivo
 * existe y por la que no usamos `@mapbox/shp-write`.
 *
 * El formato DBF limita los nombres de campo a **10 bytes**. `@mapbox/shp-write`
 * trunca sin desambiguar y emite dos descriptores con el mismo nombre; el
 * lector se queda con uno y **descarta la columna tapada en silencio**.
 * Medido en `03-critique-2.md`:
 *
 *     distancia_al_area_protegida_m = 137.42   ─┐ ambos truncan a
 *     distancia_al_cuerpo_de_agua_m = 55.1     ─┘ 'distancia_'
 *
 *     leído de vuelta: {"distancia_": 55.1, ...}   ← el 137.42 no existe más
 *
 * Ocho propiedades escritas, siete leídas, y la que sobrevive tiene el valor
 * del *agua* bajo un nombre que se lee como el del *área protegida*. Silencioso,
 * plausible y equivocado. GDAL, en cambio, lanza `distancia_` / `distanci_1`
 * con un warning por campo.
 *
 * Mitigación implementada acá:
 *   1. Laundering determinístico estilo GDAL, con sufijo `_1`, `_2`… ante
 *      colisión.
 *   2. `assertNoDuplicateDbfNames` **lanza** antes de escribir un solo byte.
 *   3. El mapa se emite como CSV lateral en el ZIP, así que ninguna
 *      información de nombres se pierde aunque el nombre corto sea críptico.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type DbfFieldType = 'C' | 'N' | 'L' | 'D';

export type DbfField = {
  /** Nombre original, completo, tal como viene en las propiedades GeoJSON. */
  longName: string;
  /** Nombre efectivo en el `.dbf`: ASCII, ≤ 10 bytes, único dentro del archivo. */
  name: string;
  type: DbfFieldType;
  length: number;
  decimals: number;
};

export const DBF_NAME_MAX = 10;
export const DBF_TEXT_MAX = 254;

export class DbfFieldCollisionError extends Error {
  override readonly name = 'DbfFieldCollisionError';
  readonly duplicates: readonly { name: string; longNames: string[] }[];

  constructor(duplicates: readonly { name: string; longNames: string[] }[]) {
    super(
      'Colisión de nombres de campo DBF (H6): ' +
        duplicates
          .map((d) => `«${d.name}» ← ${d.longNames.map((n) => `«${n}»`).join(' y ')}`)
          .join('; ') +
        '. Escribir así perdería columnas en silencio; corregí el mapa de campos.',
    );
    this.duplicates = duplicates;
  }
}

/** Quita diacríticos y deja solo `[A-Za-z0-9_]`, como el laundering de GDAL. */
function normalizeName(longName: string): string {
  const ascii = longName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_]/g, '_');
  // Un `.dbf` no admite nombres que empiecen con dígito.
  return /^[0-9]/.test(ascii) ? `f${ascii}` : ascii;
}

/**
 * Deriva nombres DBF únicos. Determinístico: la misma lista de entrada
 * produce siempre el mismo mapa, así que dos exportaciones del mismo AOI son
 * comparables byte a byte.
 */
export function deriveDbfNames(longNames: readonly string[]): Map<string, string> {
  const taken = new Set<string>();
  const mapping = new Map<string, string>();

  for (const longName of longNames) {
    if (mapping.has(longName)) continue;
    const base = normalizeName(longName).slice(0, DBF_NAME_MAX) || 'campo';
    let candidate = base;
    let suffix = 1;
    while (taken.has(candidate.toUpperCase())) {
      const tag = `_${suffix}`;
      candidate = base.slice(0, DBF_NAME_MAX - tag.length) + tag;
      suffix += 1;
      if (suffix > 9999) {
        throw new Error(`No se pudo desambiguar el nombre de campo «${longName}».`);
      }
    }
    taken.add(candidate.toUpperCase());
    mapping.set(longName, candidate);
  }
  return mapping;
}

/**
 * Guarda final: lanza si dos campos comparten nombre DBF (comparación
 * case-insensitive, que es como los lee un `.dbf`). Se llama SIEMPRE antes de
 * escribir, incluso cuando el mapa lo generó `deriveDbfNames`, porque un
 * llamador puede pasar un mapa curado a mano.
 */
export function assertNoDuplicateDbfNames(fields: readonly DbfField[]): void {
  const byName = new Map<string, string[]>();
  for (const field of fields) {
    const key = field.name.toUpperCase();
    const bucket = byName.get(key) ?? [];
    bucket.push(field.longName);
    byName.set(key, bucket);
  }
  const duplicates = [...byName.entries()]
    .filter(([, longNames]) => longNames.length > 1)
    .map(([name, longNames]) => ({ name, longNames }));
  if (duplicates.length > 0) throw new DbfFieldCollisionError(duplicates);

  for (const field of fields) {
    if (field.name.length === 0 || field.name.length > DBF_NAME_MAX) {
      throw new Error(
        `Nombre de campo DBF inválido «${field.name}» (debe tener entre 1 y ${DBF_NAME_MAX} caracteres).`,
      );
    }
  }
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Serializa un valor a la cadena que irá al `.dbf`. */
export function formatDbfValue(value: unknown, type: DbfFieldType): string {
  if (value === null || value === undefined) return '';
  switch (type) {
    case 'N':
      return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
    case 'L':
      return value === true ? 'T' : value === false ? 'F' : '?';
    case 'D':
      return value instanceof Date ? value.toISOString().slice(0, 10).replace(/-/g, '') : '';
    case 'C':
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      return JSON.stringify(value);
  }
}

/**
 * Infiere el esquema DBF a partir de los registros.
 *
 * Notas de tipado:
 * - Enteros → `N(18,0)`. `@mapbox/shp-write` usa `N(18,3)` para todo número, y
 *   H14 advierte que los `osm_id` (que se acercan a 2⁵³) viajan por texto: con
 *   0 decimales el entero se preserva exacto hasta 18 dígitos.
 * - Reales → `N(18,6)`.
 * - Texto → `C(n)` con `n` = byte más largo observado, tope 254.
 */
export function inferDbfFields(
  records: readonly Record<string, unknown>[],
  options: { names?: Map<string, string> } = {},
): DbfField[] {
  const longNames: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!seen.has(key)) {
        seen.add(key);
        longNames.push(key);
      }
    }
  }

  const names = options.names ?? deriveDbfNames(longNames);

  const fields = longNames.map<DbfField>((longName) => {
    let sawNumber = false;
    let sawFractional = false;
    let sawBoolean = false;
    let sawOther = false;
    let maxTextBytes = 1;

    for (const record of records) {
      const value: unknown = record[longName];
      if (value === null || value === undefined) continue;
      if (typeof value === 'number' && Number.isFinite(value)) {
        sawNumber = true;
        if (!Number.isInteger(value)) sawFractional = true;
      } else if (typeof value === 'boolean') {
        sawBoolean = true;
      } else {
        sawOther = true;
        maxTextBytes = Math.max(maxTextBytes, utf8Length(formatDbfValue(value, 'C')));
      }
    }

    const name = names.get(longName);
    if (name === undefined) {
      throw new Error(`El mapa de campos no cubre la propiedad «${longName}».`);
    }

    if (sawNumber && !sawOther && !sawBoolean) {
      return { longName, name, type: 'N', length: 18, decimals: sawFractional ? 6 : 0 };
    }
    if (sawBoolean && !sawOther && !sawNumber) {
      return { longName, name, type: 'L', length: 1, decimals: 0 };
    }
    if (sawNumber || sawBoolean) {
      // Columna mixta: se degrada a texto para no perder valores.
      for (const record of records) {
        const value: unknown = record[longName];
        if (value === null || value === undefined) continue;
        maxTextBytes = Math.max(maxTextBytes, utf8Length(formatDbfValue(value, 'C')));
      }
    }
    return {
      longName,
      name,
      type: 'C',
      length: Math.min(DBF_TEXT_MAX, Math.max(1, maxTextBytes)),
      decimals: 0,
    };
  });

  assertNoDuplicateDbfNames(fields);
  return fields;
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * CSV lateral que viaja en el ZIP: nadie pierde la relación entre el nombre
 * críptico de 10 caracteres y el nombre real de la columna.
 */
export function fieldMapToCsv(fields: readonly DbfField[]): string {
  const rows = [
    'campo_dbf,campo_original,tipo,largo,decimales',
    ...fields.map((f) =>
      [f.name, f.longName, f.type, String(f.length), String(f.decimals)].map(csvCell).join(','),
    ),
  ];
  return `${rows.join('\n')}\n`;
}
