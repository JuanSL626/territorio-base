import { describe, expect, it } from 'vitest';

import { createAoi } from '../aoi';
import { arcgisRings } from '../geometry';
import {
  fetchProtectedAreas,
  RUNAP_OUT_FIELDS,
  RUNAP_QUERY_URL,
  WDPA_OUT_FIELDS,
  WdpaUnavailableError,
} from '../sources/wdpa';

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

const COLOMBIA_AOI = createAoi({
  type: 'Polygon',
  coordinates: [
    [
      [-76.7, 3.2],
      [-76.5, 3.2],
      [-76.5, 3.4],
      [-76.7, 3.4],
      [-76.7, 3.2],
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
    const areas = await fetchProtectedAreas(AOI, {
      fetchImpl,
      now: () => new Date('2026-10-09T00:00:00.000Z'),
    });
    expect(areas).toHaveLength(1);
    expect(areas[0]).toMatchObject({
      name: 'Parque Nacional Submarino La Caleta',
      desig: 'Parque Nacional Submarino',
      desigEng: 'National Underwater Park',
      iucnCat: 'II',
      status: 'Designated',
      mangAuth: 'Ministerio de Medio Ambiente y Recursos Naturales',
      sourceName: 'WDPA — UNEP-WCMC',
      sourceYear: '2026',
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

  it('si falla el buffer consulta el AOI original en vez de declarar WDPA caído', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return await Promise.resolve(new Response(JSON.stringify(RESPONSE), { status: 200 }));
    };

    await expect(fetchProtectedAreas(AOI, { bufferM: 0, fetchImpl })).resolves.toHaveLength(1);
    expect(calls).toBe(1);
  });

  it('un HTTP 5xx sale como WdpaUnavailableError (UC-10)', async () => {
    const fetchImpl: FetchLike = async () =>
      await Promise.resolve(new Response('', { status: 503 }));
    await expect(fetchProtectedAreas(AOI, { fetchImpl })).rejects.toThrow(WdpaUnavailableError);
  });
});

describe('RUNAP Colombia', () => {
  it('prioriza la fuente nacional, pagina y conserva fuente y año', async () => {
    const offsets: string[] = [];
    const urls: string[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      urls.push(String(url));
      const params = new URLSearchParams(init?.body ?? '');
      offsets.push(params.get('resultOffset') ?? '');
      expect(params.get('outFields')).toBe(RUNAP_OUT_FIELDS.join(','));
      const firstPage = params.get('resultOffset') === '0';
      return await Promise.resolve(
        new Response(
          JSON.stringify({
            type: 'FeatureCollection',
            properties: { exceededTransferLimit: firstPage },
            features: firstPage
              ? [
                  {
                    properties: {
                      ap_nombre: 'Farallones de Cali',
                      ap_categoria: 'Parque Nacional Natural',
                      condicion: 'REGISTRADA',
                      organizacion: 'Parques Nacionales Naturales de Colombia',
                      fecha_registro: null,
                      fecha_inscrita: 1_310_533_200_000,
                    },
                    geometry: RESPONSE.features[0]?.geometry,
                  },
                ]
              : [],
          }),
          { status: 200 },
        ),
      );
    };

    const areas = await fetchProtectedAreas(COLOMBIA_AOI, {
      fetchImpl,
      now: () => new Date('2026-10-09T00:00:00.000Z'),
    });

    expect(urls).toEqual([RUNAP_QUERY_URL, RUNAP_QUERY_URL]);
    expect(offsets).toEqual(['0', '1000']);
    expect(areas[0]).toMatchObject({
      name: 'Farallones de Cali',
      desig: 'Parque Nacional Natural',
      status: 'REGISTRADA',
      mangAuth: 'Parques Nacionales Naturales de Colombia',
      sourceName: 'RUNAP — Parques Nacionales Naturales de Colombia',
      sourceYear: '2026',
      registrationDate: '2011-07-13',
    });
  });

  it('usa WDPA como fallback sin mezclar fuentes cuando RUNAP falla', async () => {
    const urls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      urls.push(String(url));
      const payload = String(url) === RUNAP_QUERY_URL ? { error: { code: 500 } } : RESPONSE;
      return await Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));
    };

    const areas = await fetchProtectedAreas(COLOMBIA_AOI, {
      fetchImpl,
      now: () => new Date('2026-10-09T00:00:00.000Z'),
    });

    expect(urls).toHaveLength(2);
    expect(urls[0]).toBe(RUNAP_QUERY_URL);
    expect(areas[0]).toMatchObject({ sourceName: 'WDPA — UNEP-WCMC', sourceYear: '2026' });
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
