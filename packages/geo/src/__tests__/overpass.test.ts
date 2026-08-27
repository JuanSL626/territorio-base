import { describe, expect, it } from 'vitest';

import { createAoi } from '../aoi';
import { TimeoutError, type FetchLike } from '../http';
import {
  classifyElement,
  EXCLUDED_MIRRORS,
  fetchHydrology,
  geometryFromElement,
  OVERPASS_MIRRORS,
  OverpassUnavailableError,
  queryOverpass,
} from '../sources/overpass';

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

function jsonFetch(bodyByUrl: (url: string) => { status: number; body: unknown }): {
  fetchImpl: FetchLike;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    calls.push(url);
    const { status, body } = bodyByUrl(url);
    return await Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  return { fetchImpl, calls };
}

const OK_BODY = {
  version: 0.6,
  elements: [
    {
      type: 'way',
      id: 1,
      tags: { waterway: 'stream', name: 'Arroyo Hondo' },
      geometry: [
        { lat: 18.455, lon: -69.62 },
        { lat: 18.455, lon: -69.58 },
      ],
    },
  ],
};

describe('regresión #2 — la lista de mirrors es parte del contrato', () => {
  it('son exactamente estos 5, en este orden', () => {
    expect([...OVERPASS_MIRRORS]).toEqual([
      'https://overpass-api.de/api/interpreter',
      'https://z.overpass-api.de/api/interpreter',
      'https://lz4.overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
    ]);
  });

  it('hay al menos dos proveedores genuinamente independientes del cluster principal', () => {
    const thirdParty = OVERPASS_MIRRORS.filter((url) => !url.includes('overpass-api.de'));
    expect(thirdParty.length).toBeGreaterThanOrEqual(2);
  });

  it('overpass.osm.ch está excluido a propósito, con el motivo escrito', () => {
    expect(OVERPASS_MIRRORS.some((url) => url.includes('osm.ch'))).toBe(false);
    const excluded = EXCLUDED_MIRRORS.find((m) => m.url.includes('osm.ch'));
    expect(excluded).toBeDefined();
    expect(excluded?.reason).toMatch(/0 resultados/);
    expect(excluded?.reason).toMatch(/silencio/);
  });
});

describe('fallback entre mirrors', () => {
  it('recorre los mirrors en orden hasta el primero que responde bien', async () => {
    const { fetchImpl, calls } = jsonFetch((url) =>
      url.includes('lz4') ? { status: 200, body: OK_BODY } : { status: 504, body: {} },
    );
    const result = await queryOverpass('[out:json];', { fetchImpl });
    expect(result.elements).toHaveLength(1);
    expect(calls).toEqual([
      'https://overpass-api.de/api/interpreter',
      'https://z.overpass-api.de/api/interpreter',
      'https://lz4.overpass-api.de/api/interpreter',
    ]);
  });

  it('un HTTP 200 con `remark` NO cuenta como éxito: los datos vienen truncados', async () => {
    const { fetchImpl, calls } = jsonFetch((url) =>
      url.includes('kumi')
        ? { status: 200, body: OK_BODY }
        : {
            status: 200,
            body: { elements: [], remark: 'runtime error: Query timed out in "query" at line 3' },
          },
    );
    const result = await queryOverpass('[out:json];', { fetchImpl });
    expect(result.elements).toHaveLength(1);
    // Los tres primeros contestaron 200 y aun así se descartaron.
    expect(calls).toHaveLength(4);
  });

  it('si fallan los 5, lanza OverpassUnavailableError con un intento por mirror', async () => {
    const { fetchImpl, calls } = jsonFetch(() => ({ status: 504, body: {} }));
    await expect(queryOverpass('[out:json];', { fetchImpl })).rejects.toThrow(
      OverpassUnavailableError,
    );
    expect(calls).toHaveLength(5);

    const error = await queryOverpass('[out:json];', { fetchImpl }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OverpassUnavailableError);
    if (error instanceof OverpassUnavailableError) {
      expect(error.attempts).toHaveLength(5);
      expect(error.attempts.map((a) => a.url)).toEqual([...OVERPASS_MIRRORS]);
    }
  });

  it('el connect timeout corto hace fallar rápido contra un mirror colgado', async () => {
    const hanging: FetchLike = async (_url, init) =>
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('abortado'));
        });
      });

    const started = Date.now();
    const error = await queryOverpass('[out:json];', {
      fetchImpl: hanging,
      mirrors: [OVERPASS_MIRRORS[0] ?? ''],
      timeouts: { connectMs: 30, readMs: 1_000 },
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OverpassUnavailableError);
    if (error instanceof OverpassUnavailableError) {
      expect(error.attempts[0]?.error).toBeInstanceOf(TimeoutError);
    }
    expect(Date.now() - started).toBeLessThan(900);
  });
});

describe('interpretación de elementos de OSM', () => {
  it('clasifica según los tags, con la misma precedencia que el legacy', () => {
    expect(classifyElement({ waterway: 'river' })).toBe('waterway');
    expect(classifyElement({ natural: 'wetland' })).toBe('wetland');
    expect(classifyElement({ natural: 'water' })).toBe('water_body');
    expect(classifyElement(undefined)).toBe('water_body');
    // `waterway` gana aunque haya también natural=wetland.
    expect(classifyElement({ waterway: 'ditch', natural: 'wetland' })).toBe('waterway');
  });

  it('cerrado con ≥4 vértices → Polygon; abierto → LineString; 1 punto → Point', () => {
    const closed = geometryFromElement({
      type: 'way',
      id: 1,
      geometry: [
        { lat: 0, lon: 0 },
        { lat: 0, lon: 1 },
        { lat: 1, lon: 1 },
        { lat: 0, lon: 0 },
      ],
    });
    expect(closed?.type).toBe('Polygon');

    expect(
      geometryFromElement({
        type: 'way',
        id: 2,
        geometry: [
          { lat: 0, lon: 0 },
          { lat: 0, lon: 1 },
        ],
      })?.type,
    ).toBe('LineString');

    expect(geometryFromElement({ type: 'node', id: 3, geometry: [{ lat: 5, lon: 5 }] })?.type).toBe(
      'Point',
    );
    expect(geometryFromElement({ type: 'way', id: 4 })).toBeNull();
  });

  it('las relations se arman desde sus miembros en vez de desaparecer en silencio', () => {
    const relation = geometryFromElement({
      type: 'relation',
      id: 99,
      tags: { natural: 'water', name: 'Laguna' },
      members: [
        {
          role: 'outer',
          geometry: [
            { lat: 0, lon: 0 },
            { lat: 0, lon: 1 },
            { lat: 1, lon: 1 },
            { lat: 0, lon: 0 },
          ],
        },
      ],
    });
    expect(relation?.type).toBe('MultiPolygon');
  });
});

describe('fetchHydrology', () => {
  it('devuelve features tipadas con osmId, kind, name y geometría', async () => {
    const { fetchImpl } = jsonFetch(() => ({ status: 200, body: OK_BODY }));
    const features = await fetchHydrology(AOI, { fetchImpl });
    expect(features).toHaveLength(1);
    expect(features[0]).toMatchObject({ osmId: 1, kind: 'waterway', name: 'Arroyo Hondo' });
    expect(features[0]?.geometry.type).toBe('LineString');
  });

  it('un elemento sin nombre queda con name = null, no con undefined', async () => {
    const { fetchImpl } = jsonFetch(() => ({
      status: 200,
      body: {
        elements: [
          {
            type: 'way',
            id: 7,
            tags: { waterway: 'stream' },
            geometry: [
              { lat: 18.455, lon: -69.62 },
              { lat: 18.455, lon: -69.58 },
            ],
          },
        ],
      },
    }));
    const features = await fetchHydrology(AOI, { fetchImpl });
    expect(features[0]?.name).toBeNull();
  });

  it('consulta el bbox del AOI bufferado, no el del AOI pelado', async () => {
    let body = '';
    const fetchImpl: FetchLike = async (_url, init) => {
      body = init?.body ?? '';
      return await Promise.resolve(new Response(JSON.stringify(OK_BODY), { status: 200 }));
    };
    await fetchHydrology(AOI, { fetchImpl, bufferM: 500 });
    const query = decodeURIComponent(body.replace(/^data=/, '')).replace(/\+/g, ' ');
    const match = /\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\)/.exec(query);
    if (match === null) throw new Error(`no se encontró el bbox en la consulta: ${query}`);
    const [, south, west, north, east] = match.map(Number);
    expect(south).toBeLessThan(18.45);
    expect(west).toBeLessThan(-69.6);
    expect(north).toBeGreaterThan(18.46);
    expect(east).toBeGreaterThan(-69.59);
  });
});
