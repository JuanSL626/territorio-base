import { describe, expect, it } from 'vitest';

import { createAoi } from '../aoi';
import { arcgisRings } from '../geometry';
import { fetchProtectedAreas, WDPA_OUT_FIELDS, WdpaUnavailableError } from '../sources/wdpa';

import type { FetchLike } from '../http';

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

const RESPONSE = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        name: 'Parque Nacional Submarino La Caleta',
        desig: 'Parque Nacional Submarino',
        desig_eng: 'National Underwater Park',
        iucn_cat: 'II',
        status: 'Designated',
        mang_auth: 'Ministerio de Medio Ambiente y Recursos Naturales',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-69.6, 18.45],
            [-69.595, 18.45],
            [-69.595, 18.46],
            [-69.6, 18.46],
            [-69.6, 18.45],
          ],
        ],
      },
    },
  ],
};

describe('WDPA', () => {
  it('manda los outFields fijos, f=geojson y outSR=4326', async () => {
    let body = '';
    const fetchImpl: FetchLike = async (_url, init) => {
      body = init?.body ?? '';
      return await Promise.resolve(new Response(JSON.stringify(RESPONSE), { status: 200 }));
    };
    await fetchProtectedAreas(AOI, { fetchImpl });
    const params = new URLSearchParams(body);
    expect(params.get('outFields')).toBe(WDPA_OUT_FIELDS.join(','));
    expect(params.get('f')).toBe('geojson');
    expect(params.get('outSR')).toBe('4326');
    expect(params.get('spatialRel')).toBe('esriSpatialRelIntersects');
    const geometry: unknown = JSON.parse(params.get('geometry') ?? '{}');
    expect(geometry).toMatchObject({ spatialReference: { wkid: 4326 } });
  });

  it('normaliza propiedades vacías a null y conserva desig/mang_auth', async () => {
    const fetchImpl: FetchLike = async () =>
      await Promise.resolve(new Response(JSON.stringify(RESPONSE), { status: 200 }));
    const areas = await fetchProtectedAreas(AOI, { fetchImpl });
    expect(areas).toHaveLength(1);
    expect(areas[0]).toMatchObject({
      name: 'Parque Nacional Submarino La Caleta',
      desig: 'Parque Nacional Submarino',
      desigEng: 'National Underwater Park',
      iucnCat: 'II',
      status: 'Designated',
      mangAuth: 'Ministerio de Medio Ambiente y Recursos Naturales',
    });

    const blankFetch: FetchLike = async () =>
      await Promise.resolve(
        new Response(
          JSON.stringify({
            features: [
              {
                properties: { name: '   ', iucn_cat: null },
                geometry: { type: 'Point', coordinates: [-69.6, 18.45] },
              },
            ],
          }),
          { status: 200 },
        ),
      );
    const blank = await fetchProtectedAreas(AOI, { fetchImpl: blankFetch });
    expect(blank[0]?.name).toBeNull();
    expect(blank[0]?.iucnCat).toBeNull();
  });

  it('un `{"error": …}` con HTTP 200 se trata como servicio caído, no como cero áreas', async () => {
    const fetchImpl: FetchLike = async () =>
      await Promise.resolve(
        new Response(JSON.stringify({ error: { code: 500, message: 'boom' } }), { status: 200 }),
      );
    await expect(fetchProtectedAreas(AOI, { fetchImpl })).rejects.toThrow(WdpaUnavailableError);
  });

  it('cero features es una lista vacía, no un error (TC-10)', async () => {
    const fetchImpl: FetchLike = async () =>
      await Promise.resolve(
        new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), { status: 200 }),
      );
    await expect(fetchProtectedAreas(AOI, { fetchImpl })).resolves.toEqual([]);
  });

  it('un HTTP 5xx sale como WdpaUnavailableError (UC-10)', async () => {
    const fetchImpl: FetchLike = async () =>
      await Promise.resolve(new Response('', { status: 503 }));
    await expect(fetchProtectedAreas(AOI, { fetchImpl })).rejects.toThrow(WdpaUnavailableError);
  });
});

describe('arcgisRings — el buffer multiparte no rompe la consulta', () => {
  it('emite todos los anillos de todas las partes de un MultiPolygon', () => {
    // El original hacía `search_area.exterior.coords`, que lanza AttributeError
    // sobre un MultiPolygon (AOI multiparte, o dos partes que el buffer no une).
    const rings = arcgisRings({
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
        [
          [
            [5, 5],
            [6, 5],
            [6, 6],
            [5, 6],
            [5, 5],
          ],
        ],
      ],
    });
    expect(rings).toHaveLength(2);
  });

  it('orienta el anillo exterior en sentido horario, como pide ArcGIS', () => {
    const rings = arcgisRings({
      type: 'Polygon',
      coordinates: [
        // Antihorario, la convención de GeoJSON.
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    });
    const ring = rings[0];
    if (ring === undefined) throw new Error('sin anillos');
    let signed = 0;
    for (let i = 0; i + 1 < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[i + 1];
      if (a === undefined || b === undefined) continue;
      signed += (a[0] ?? 0) * (b[1] ?? 0) - (b[0] ?? 0) * (a[1] ?? 0);
    }
    expect(signed).toBeLessThan(0);
  });
});
