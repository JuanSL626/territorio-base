import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { createAoi } from '../aoi';
import {
  buildVectorBundle,
  buildVectorBundleFiles,
  bundleFilename,
  clipFeaturesToAoi,
  slugify,
} from '../export/bundle';
import { buildReadme, DATASET_CITATIONS } from '../export/sources';
import { areaHectares } from '../geometry';

import type { Feature } from '../geojson';

const AOI = createAoi({
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
});

const GENERATED_AT = new Date('2026-08-27T12:00:00.000Z');

const HYDROLOGY: Feature[] = [
  {
    type: 'Feature',
    properties: {
      osm_id: 10,
      kind: 'waterway',
      name: 'Arroyo Hondo',
      distancia_al_area_protegida_m: 137.42,
      distancia_al_cuerpo_de_agua_m: 55.1,
    },
    geometry: {
      type: 'LineString',
      coordinates: [
        [-69.62, 18.455],
        [-69.57, 18.455],
      ],
    },
  },
];

const readmeOptions = {
  generatedAt: GENERATED_AT,
  engineVersion: 'territorio-base 0.1.0',
  parameters: [{ label: 'Buffer de hidrología', value: '500 m' }],
  datasetIds: ['hidrologia', 'wdpa'],
};

describe('bundle vectorial', () => {
  it('produce la estructura fija del design brief §7.3', () => {
    const files = buildVectorBundleFiles({
      aoi: AOI,
      aoiName: 'Parcela Los Frailes',
      layers: [{ name: 'hidrologia_osm', label: 'Hidrología (OSM)', features: HYDROLOGY }],
      readme: readmeOptions,
    });
    const paths = files.map((f) => f.path);

    expect(paths[0]).toBe('LEEME.txt');
    expect(paths).toContain('vector/aoi.geojson');
    expect(paths).toContain('vector/aoi.shp');
    expect(paths).toContain('vector/aoi.shx');
    expect(paths).toContain('vector/aoi.dbf');
    expect(paths).toContain('vector/aoi.prj');
    expect(paths).toContain('vector/aoi.cpg');
    expect(paths).toContain('vector/hidrologia_osm.geojson');
    expect(paths).toContain('vector/hidrologia_osm.shp');
    expect(paths).toContain('vector/campos_shapefile.csv');
  });

  it('el CSV lateral documenta la traducción de nombres largos (H6)', () => {
    const files = buildVectorBundleFiles({
      aoi: AOI,
      aoiName: 'Parcela',
      layers: [{ name: 'hidrologia_osm', label: 'Hidrología (OSM)', features: HYDROLOGY }],
      readme: readmeOptions,
    });
    const csv = files.find((f) => f.path === 'vector/campos_shapefile.csv')?.content;
    expect(typeof csv).toBe('string');
    if (typeof csv !== 'string') throw new Error('csv');
    expect(csv.split('\n')[0]).toBe('capa,campo_dbf,campo_original,tipo,largo,decimales');
    expect(csv).toContain('distancia_,distancia_al_area_protegida_m');
    expect(csv).toContain('distanci_1,distancia_al_cuerpo_de_agua_m');
    expect(csv).toContain('Hidrología (OSM)');
  });

  it('el LEEME lleva fuentes, licencias, parámetros y el alcance', () => {
    const text = buildReadme({
      ...readmeOptions,
      aoiName: 'Parcela Los Frailes',
      areaHa: AOI.areaHa,
      utmEpsg: AOI.utmEpsg,
      bbox: AOI.bbox,
      outputEpsg: 4326,
      omissions: [{ label: 'NDVI', reason: 'STAC no respondió' }],
    });

    expect(text).toContain('Parcela Los Frailes');
    expect(text).toContain('EPSG:32619');
    expect(text).toContain('territorio-base 0.1.0');
    expect(text).toContain('Buffer de hidrología: 500 m');
    expect(text).toContain('Open Database License (ODbL)');
    expect(text).toContain('UNEP-WCMC');
    expect(text).toContain('NDVI: STAC no respondió');
    expect(text).toContain('campos_shapefile.csv');
    expect(text).toContain('No reemplaza');
    // Solo las fuentes pedidas.
    expect(text).not.toContain('Aqueduct');
  });

  it('cada fuente del catálogo tiene licencia y endpoint', () => {
    for (const citation of DATASET_CITATIONS) {
      expect(citation.license.length).toBeGreaterThan(0);
      expect(citation.endpoint.length).toBeGreaterThan(0);
      expect(citation.provider.length).toBeGreaterThan(0);
    }
  });

  it('el nombre del ZIP sigue el patrón del design brief', () => {
    expect(bundleFilename('Parcela Los Frailes, Santo Domingo', GENERATED_AT)).toBe(
      'territorio-base_parcela-los-frailes-santo-domingo_2026-08-27.zip',
    );
    expect(slugify('Ñandú Área 51')).toBe('nandu-area-51');
    expect(slugify('   ')).toBe('aoi');
  });

  it('comprime y el ZIP se puede volver a abrir', async () => {
    const bundle = await buildVectorBundle({
      aoi: AOI,
      aoiName: 'Parcela',
      layers: [{ name: 'hidrologia_osm', label: 'Hidrología (OSM)', features: HYDROLOGY }],
      readme: readmeOptions,
      extraFiles: [{ path: 'raster/dem.tif', content: new Uint8Array([0x49, 0x49, 0x2a, 0x00]) }],
    });

    expect(bundle.filename).toBe('territorio-base_parcela_2026-08-27.zip');
    expect(bundle.bytes.length).toBeGreaterThan(0);

    const zip = await JSZip.loadAsync(bundle.bytes);
    expect(Object.keys(zip.files).sort()).toEqual([...bundle.entries].sort());

    const readme = await zip.file('LEEME.txt')?.async('string');
    expect(readme).toContain('TERRITORIO BASE');

    const tif = await zip.file('raster/dem.tif')?.async('uint8array');
    expect([...(tif ?? [])]).toEqual([0x49, 0x49, 0x2a, 0x00]);
  });
});

describe('recorte al AOI', () => {
  it('los polígonos se recortan de verdad; el área baja', () => {
    const overlapping: Feature = {
      type: 'Feature',
      properties: { nombre: 'mitad afuera' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-69.605, 18.45],
            [-69.595, 18.45],
            [-69.595, 18.46],
            [-69.605, 18.46],
            [-69.605, 18.45],
          ],
        ],
      },
    };
    const [clipped] = clipFeaturesToAoi([overlapping], AOI);
    if (clipped === undefined) throw new Error('se perdió la feature');

    const before = areaHectares(overlapping.geometry, AOI.utmEpsg);
    const after = areaHectares(clipped.geometry, AOI.utmEpsg);
    expect(after).toBeLessThan(before * 0.6);
    expect(after).toBeGreaterThan(before * 0.4);
    expect(clipped.properties).toEqual({ nombre: 'mitad afuera' });
  });

  it('un polígono totalmente fuera se descarta', () => {
    const outside: Feature = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-69.4, 18.45],
            [-69.39, 18.45],
            [-69.39, 18.46],
            [-69.4, 18.46],
            [-69.4, 18.45],
          ],
        ],
      },
    };
    expect(clipFeaturesToAoi([outside], AOI)).toEqual([]);
  });

  it('las líneas no se parten: se filtran enteras por intersección', () => {
    const [kept] = clipFeaturesToAoi(HYDROLOGY, AOI);
    expect(kept?.geometry).toEqual(HYDROLOGY[0]?.geometry);

    const far: Feature = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [-69.4, 18.1],
          [-69.3, 18.1],
        ],
      },
    };
    expect(clipFeaturesToAoi([far], AOI)).toEqual([]);
  });
});
