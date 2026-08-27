import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import {
  AoiParseError,
  createAoi,
  formatFromFilename,
  loadAoiFromGeoJson,
  parseAoiFile,
  utmEpsgForGeometry,
} from '../aoi';
import { utmEpsgForLonLat } from '../crs';

import type { MultiPolygon, Polygon } from '../geojson';

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Parcela de prueba</name>
      <Polygon><outerBoundaryIs><LinearRing><coordinates>
        -69.60,18.45,0 -69.59,18.45,0 -69.59,18.46,0 -69.60,18.46,0 -69.60,18.45,0
      </coordinates></LinearRing></outerBoundaryIs></Polygon>
    </Placemark>
  </Document>
</kml>`;

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('AOI — parseo de archivos', () => {
  it('round-trip de KMZ: se arma el ZIP en memoria, se descomprime y se parsea', async () => {
    // Regresión #8: la versión Python rompía acá por depender de `fiona`, una
    // dependencia no declarada. Este test recorre el camino entero.
    const zip = new JSZip();
    zip.file('doc.kml', KML);
    const bytes = await zip.generateAsync({ type: 'uint8array' });

    const fromKmz = await parseAoiFile({ data: bytes, filename: 'parcela.kmz' });
    const fromKml = await parseAoiFile({ data: encode(KML), filename: 'parcela.kml' });

    expect(fromKmz.geometry).toEqual(fromKml.geometry);
    expect(fromKmz.utmEpsg).toBe(32619);
    expect(fromKmz.areaHa).toBeGreaterThan(110);
    expect(fromKmz.areaHa).toBeLessThan(125);
    expect(fromKmz.bbox[0]).toBeCloseTo(-69.6, 6);
    expect(fromKmz.bbox[3]).toBeCloseTo(18.46, 6);
    expect(fromKmz.vertexCount).toBe(5);
  });

  it('encuentra el .kml adentro del KMZ sin importar su nombre o carpeta', async () => {
    const zip = new JSZip();
    zip.file('files/OTRO_NOMBRE.KML', KML);
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const aoi = await parseAoiFile({ data: bytes, filename: 'x.kmz' });
    expect(aoi.utmEpsg).toBe(32619);
  });

  it('un KMZ sin .kml adentro da un error en español, no una excepción cruda', async () => {
    const zip = new JSZip();
    zip.file('leeme.txt', 'nada');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    await expect(parseAoiFile({ data: bytes, filename: 'x.kmz' })).rejects.toThrow(AoiParseError);
    await expect(parseAoiFile({ data: bytes, filename: 'x.kmz' })).rejects.toThrow(
      /no contiene ningún archivo .kml/,
    );
  });

  it('un archivo corrupto no propaga un traceback (UC-03 / TC-04)', async () => {
    await expect(
      parseAoiFile({ data: encode('{ esto no es json'), filename: 'x.geojson' }),
    ).rejects.toThrow(AoiParseError);
    await expect(
      parseAoiFile({ data: encode('%PDF-1.4 basura'), filename: 'x.kmz' }),
    ).rejects.toThrow(/KMZ está corrupto/);
  });

  it('rechaza extensiones que no soporta, nombrando las que sí', () => {
    expect(() => formatFromFilename('parcela.shp')).toThrow(/Se aceptan KML, KMZ y GeoJSON/);
    expect(formatFromFilename('PARCELA.GeoJSON')).toBe('geojson');
    expect(formatFromFilename('parcela.json')).toBe('geojson');
  });
});

describe('AOI — normalización desde GeoJSON', () => {
  it('une varias geometrías en una sola (UC-02, "polígono ampliado")', () => {
    const collection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-69.6, 18.45],
                [-69.59, 18.45],
                [-69.59, 18.46],
                [-69.6, 18.46],
                [-69.6, 18.45],
              ],
            ],
          },
        },
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-69.595, 18.45],
                [-69.58, 18.45],
                [-69.58, 18.46],
                [-69.595, 18.46],
                [-69.595, 18.45],
              ],
            ],
          },
        },
      ],
    };
    const aoi = loadAoiFromGeoJson(collection);
    expect(aoi.geometry.type).toBe('Polygon');
    // Los dos rectángulos se solapan: el área unida es menor que la suma.
    expect(aoi.areaHa).toBeGreaterThan(200);
    expect(aoi.areaHa).toBeLessThan(260);
  });

  it('acepta una Geometry pelada (lo que devuelve el control de dibujo)', () => {
    const aoi = loadAoiFromGeoJson({
      type: 'Polygon',
      coordinates: [
        [
          [-69.6, 18.45],
          [-69.59, 18.45],
          [-69.59, 18.46],
          [-69.6, 18.45],
        ],
      ],
    });
    expect(aoi.utmEpsg).toBe(32619);
  });

  it('un archivo sin polígonos explica qué falta', () => {
    expect(() =>
      loadAoiFromGeoJson({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [-69, 18] } },
        ],
      }),
    ).toThrow(/no contiene ningún polígono/);
  });
});

describe('AOI — elección de zona UTM (H16)', () => {
  it('usa el centroide de área, como shapely', () => {
    const square: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [-69.6, 18.45],
          [-69.59, 18.45],
          [-69.59, 18.46],
          [-69.6, 18.46],
          [-69.6, 18.45],
        ],
      ],
    };
    expect(utmEpsgForGeometry(square)).toBe(utmEpsgForLonLat(-69.595, 18.455));
  });

  it('un MultiPolygon cuyo centroide cae fuera de todas las partes no elige una zona ajena', () => {
    // Dos partes muy separadas: el centroide de área cae en el vacío del medio,
    // en una zona UTM que no contiene a ninguna de las dos.
    const multi: MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [-77.6, 18.4],
            [-77.4, 18.4],
            [-77.4, 18.6],
            [-77.6, 18.6],
            [-77.6, 18.4],
          ],
        ],
        [
          [
            [-65.6, 18.4],
            [-65.4, 18.4],
            [-65.4, 18.6],
            [-65.6, 18.6],
            [-65.6, 18.4],
          ],
        ],
      ],
    };

    const naive = utmEpsgForLonLat(-71.5, 18.5); // lo que daría el centroide crudo
    expect(naive).toBe(32619);

    const chosen = utmEpsgForGeometry(multi);
    expect(chosen).not.toBe(naive);
    // La zona elegida contiene efectivamente una de las partes.
    expect([utmEpsgForLonLat(-77.5, 18.5), utmEpsgForLonLat(-65.5, 18.5)]).toContain(chosen);
  });

  it('createAoi expone bbox, área y cantidad de vértices', () => {
    const square: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [-69.6, 18.45],
          [-69.59, 18.45],
          [-69.59, 18.46],
          [-69.6, 18.46],
          [-69.6, 18.45],
        ],
      ],
    };
    const aoi = createAoi(square);
    expect(aoi.bbox).toEqual([-69.6, 18.45, -69.59, 18.46]);
    expect(aoi.vertexCount).toBe(5);
    expect(aoi.areaHa).toBeGreaterThan(0);
  });
});
