import { describe, expect, it } from 'vitest';

import { readDbf, readShp, readShx } from './shapefile-reader';
import {
  assertNoDuplicateDbfNames,
  DbfFieldCollisionError,
  deriveDbfNames,
  fieldMapToCsv,
  inferDbfFields,
  type DbfField,
} from '../export/dbf-fields';
import { writeShapefile, writeShapefileSet, type ExportFeature } from '../export/shapefile';

/** El caso exacto que `03-critique-2.md` H6 midió contra shp-write. */
const COLLIDING_RECORD = {
  distancia_al_area_protegida_m: 137.42,
  distancia_al_cuerpo_de_agua_m: 55.1,
  nombre_del_area_protegida: 'Parque Nacional Sierra de Bahoruco',
  osm_id: 1234567890,
};

describe('H6 — colisión de nombres DBF', () => {
  it('los dos "distancia_…" NO comparten nombre y ambos valores sobreviven', () => {
    const fields = inferDbfFields([COLLIDING_RECORD]);
    const names = fields.map((f) => f.name);
    expect(names).toContain('distancia_');
    expect(names).toContain('distanci_1');
    expect(new Set(names).size).toBe(names.length);

    const parts = writeShapefile({
      epsg: 4326,
      features: [
        {
          type: 'Feature',
          properties: COLLIDING_RECORD,
          geometry: { type: 'Point', coordinates: [-71.5, 18.2] },
        },
      ],
    });

    // El lector de tests colapsa nombres repetidos en un objeto plano, igual
    // que un lector real: si hubiera colisión, faltaría una columna acá.
    const dbf = readDbf(parts.dbf);
    expect(dbf.fields).toHaveLength(4);
    const record = dbf.records[0];
    if (record === undefined) throw new Error('sin registros');
    expect(Object.keys(record)).toHaveLength(4);

    const byLongName = new Map(parts.fields.map((f) => [f.longName, f.name]));
    const protegida = byLongName.get('distancia_al_area_protegida_m');
    const agua = byLongName.get('distancia_al_cuerpo_de_agua_m');
    if (protegida === undefined || agua === undefined) throw new Error('mapa incompleto');
    expect(Number(record[protegida])).toBeCloseTo(137.42, 6);
    expect(Number(record[agua])).toBeCloseTo(55.1, 6);
  });

  it('un mapa de campos curado a mano con duplicados LANZA antes de escribir', () => {
    const bad: DbfField[] = [
      {
        longName: 'distancia_al_area_protegida_m',
        name: 'distancia_',
        type: 'N',
        length: 18,
        decimals: 6,
      },
      {
        longName: 'distancia_al_cuerpo_de_agua_m',
        name: 'DISTANCIA_',
        type: 'N',
        length: 18,
        decimals: 6,
      },
    ];
    expect(() => {
      assertNoDuplicateDbfNames(bad);
    }).toThrow(DbfFieldCollisionError);

    expect(() =>
      writeShapefile({
        epsg: 4326,
        fields: bad,
        features: [
          {
            type: 'Feature',
            properties: COLLIDING_RECORD,
            geometry: { type: 'Point', coordinates: [-71.5, 18.2] },
          },
        ],
      }),
    ).toThrow(/Colisión de nombres de campo DBF/);
  });

  it('el laundering es determinístico y quita acentos', () => {
    const names = deriveDbfNames([
      'Área protegida más cercana',
      'Área protegida más lejana',
      'Área protegida',
    ]);
    expect([...names.values()]).toEqual(['Area_prote', 'Area_pro_1', 'Area_pro_2']);
    expect(deriveDbfNames([...names.keys()])).toEqual(names);
  });

  it('el CSV lateral conserva la correspondencia completa', () => {
    const fields = inferDbfFields([COLLIDING_RECORD]);
    const csv = fieldMapToCsv(fields);
    expect(csv.split('\n')[0]).toBe('campo_dbf,campo_original,tipo,largo,decimales');
    expect(csv).toContain('distancia_,distancia_al_area_protegida_m');
    expect(csv).toContain('distanci_1,distancia_al_cuerpo_de_agua_m');
  });

  it('los enteros grandes viajan como N(18,0), sin decimales que los degraden', () => {
    const fields = inferDbfFields([{ osm_id: 9007199254740991 }]);
    expect(fields[0]).toMatchObject({ type: 'N', length: 18, decimals: 0 });
  });
});

describe('H7 — el .prj sale del CRS real', () => {
  const utmPolygon: ExportFeature = {
    type: 'Feature',
    properties: { nombre: 'AOI' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [400000, 2043000],
          [401000, 2043000],
          [401000, 2044000],
          [400000, 2044000],
          [400000, 2043000],
        ],
      ],
    },
  };

  it('coordenadas UTM producen un .prj UTM, no la constante WGS84', () => {
    const parts = writeShapefile({ features: [utmPolygon], epsg: 32619 });
    expect(parts.prj).toContain('WGS 84 / UTM zone 19N');
    expect(parts.prj).toContain('AUTHORITY["EPSG","32619"]');
    expect(parts.cpg).toBe('UTF-8');
  });

  it('pedir un .prj de grados con coordenadas en metros LANZA', () => {
    expect(() => writeShapefile({ features: [utmPolygon], epsg: 4326 })).toThrow(
      /fuera del rango geográfico/,
    );
  });

  it('rechaza EPSG que proj4js no puede transformar con fidelidad', () => {
    expect(() => writeShapefile({ features: [utmPolygon], epsg: 26719 })).toThrow(
      /no está soportado/,
    );
  });
});

describe('round-trip de geometría', () => {
  it('polígono con hueco: el hueco sobrevive y las orientaciones son las del formato', () => {
    const donut: ExportFeature = {
      type: 'Feature',
      properties: { nombre: 'rosquilla' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-70, 18],
            [-69, 18],
            [-69, 19],
            [-70, 19],
            [-70, 18],
          ],
          [
            [-69.8, 18.2],
            [-69.8, 18.8],
            [-69.2, 18.8],
            [-69.2, 18.2],
            [-69.8, 18.2],
          ],
        ],
      },
    };
    const parts = writeShapefile({ features: [donut], epsg: 4326 });
    const { shapeType, shapes } = readShp(parts.shp);
    expect(shapeType).toBe(5); // Polygon
    expect(shapes).toHaveLength(1);
    const shape = shapes[0];
    if (shape === undefined) throw new Error('sin shapes');
    expect(shape.parts).toHaveLength(2);

    const signed = (ring: [number, number][]): number => {
      let sum = 0;
      for (let i = 0; i + 1 < ring.length; i += 1) {
        const a = ring[i];
        const b = ring[i + 1];
        if (a === undefined || b === undefined) continue;
        sum += a[0] * b[1] - b[0] * a[1];
      }
      return sum / 2;
    };
    // Anillo exterior horario (área negativa), hueco antihorario (positiva).
    expect(signed(shape.parts[0] ?? [])).toBeLessThan(0);
    expect(signed(shape.parts[1] ?? [])).toBeGreaterThan(0);
  });

  it('MultiLineString: cada parte llega entera (el arreglo que le falta al npm de shp-write)', () => {
    const stream: ExportFeature = {
      type: 'Feature',
      properties: { osm_id: 42, name: 'Arroyo Hondo', kind: 'waterway' },
      geometry: {
        type: 'MultiLineString',
        coordinates: [
          [
            [-70, 18],
            [-69.9, 18.05],
            [-69.8, 18.1],
          ],
          [
            [-69.7, 18.2],
            [-69.6, 18.25],
          ],
        ],
      },
    };
    const parts = writeShapefile({ features: [stream], epsg: 4326 });
    const { shapeType, shapes } = readShp(parts.shp);
    expect(shapeType).toBe(3); // PolyLine
    const shape = shapes[0];
    if (shape === undefined) throw new Error('sin shapes');
    expect(shape.parts).toHaveLength(2);
    expect(shape.parts[0]).toHaveLength(3);
    expect(shape.parts[1]).toHaveLength(2);
    expect(shape.parts[0]?.[1]?.[0]).toBeCloseTo(-69.9, 9);

    const dbf = readDbf(parts.dbf);
    expect(dbf.records[0]).toMatchObject({ osm_id: '42', name: 'Arroyo Hondo', kind: 'waterway' });
  });

  it('el .shx apunta a los offsets reales del .shp', () => {
    const features: ExportFeature[] = [
      {
        type: 'Feature',
        properties: { n: 1 },
        geometry: { type: 'Point', coordinates: [-70, 18] },
      },
      {
        type: 'Feature',
        properties: { n: 2 },
        geometry: { type: 'Point', coordinates: [-69, 19] },
      },
    ];
    const parts = writeShapefile({ features, epsg: 4326 });
    const index = readShx(parts.shx);
    expect(index).toHaveLength(2);
    expect(index[0]?.offset).toBe(100);
    expect(index[1]?.offset).toBe(100 + 8 + 20);
    expect(index[0]?.contentLength).toBe(20);
    expect(readShp(parts.shp).shapes).toHaveLength(2);
  });

  it('los acentos del .dbf sobreviven gracias al .cpg UTF-8', () => {
    const parts = writeShapefile({
      epsg: 4326,
      features: [
        {
          type: 'Feature',
          properties: { etiqueta: 'Área propensa a inundación · Sección Ñ' },
          geometry: { type: 'Point', coordinates: [-70, 18] },
        },
      ],
    });
    expect(parts.cpg).toBe('UTF-8');
    expect(readDbf(parts.dbf).records[0]?.etiqueta).toBe('Área propensa a inundación · Sección Ñ');
  });

  it('mezclar líneas y polígonos produce un shapefile por clase', () => {
    const mixed: ExportFeature[] = [
      {
        type: 'Feature',
        properties: { kind: 'waterway' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [-70, 18],
            [-69, 18],
          ],
        },
      },
      {
        type: 'Feature',
        properties: { kind: 'water_body' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-70, 18],
              [-69, 18],
              [-69, 19],
              [-70, 18],
            ],
          ],
        },
      },
    ];
    expect(() => writeShapefile({ features: mixed, epsg: 4326 })).toThrow(/writeShapefileSet/);

    const set = writeShapefileSet({ features: mixed, epsg: 4326 });
    expect([...set.keys()].sort()).toEqual(['line', 'polygon']);
    expect(set.get('line')?.featureCount).toBe(1);
    expect(set.get('polygon')?.featureCount).toBe(1);
  });
});
