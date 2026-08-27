import { describe, expect, it } from 'vitest';

import { createAoi, type Aoi } from '../aoi';
import {
  fetchAllMepyd,
  isInRd,
  MEPYD_LAYERS,
  MEPYD_LAYERS_FLAT,
  MEPYD_MAX_PAGES,
  RD_BBOX,
} from '../sources/mepyd';

import type { FetchLike } from '../http';

function squareAoi(lon: number, lat: number): Aoi {
  return createAoi({
    type: 'Polygon',
    coordinates: [
      [
        [lon, lat],
        [lon + 0.01, lat],
        [lon + 0.01, lat + 0.01],
        [lon, lat + 0.01],
        [lon, lat],
      ],
    ],
  });
}

const RD_AOI = squareAoi(-69.6, 18.45);

function feature(id: number): unknown {
  return {
    type: 'Feature',
    properties: { OBJECTID: id, MUN_NOM: `Municipio ${id}` },
    geometry: { type: 'Point', coordinates: [-69.595, 18.455] },
  };
}

describe('catálogo MEPyD', () => {
  it('tiene los 7 grupos con las etiquetas exactas del inventario §4', () => {
    expect(MEPYD_LAYERS.map((g) => g.group)).toEqual([
      'División Político-Administrativa',
      'Amenaza sísmica (por nivel censal 2010)',
      'Amenazas',
      'Agua',
      'Infraestructuras y edificaciones',
      'Vías',
      'Áreas protegidas (MEPyD)',
    ]);
  });

  it('tiene 39 capas, con ids únicos y URLs de FeatureServer', () => {
    // El inventario dice "~35 capas"; el catálogo real de `mepyd_rd.py` tiene
    // 39 (1+6+10+6+7+7+2). Se fija el número exacto para que agregar o borrar
    // una capa rompa el test en vez de pasar inadvertido.
    expect(MEPYD_LAYERS_FLAT).toHaveLength(39);
    expect(new Set(MEPYD_LAYERS_FLAT.map((l) => l.id)).size).toBe(39);
    for (const layer of MEPYD_LAYERS_FLAT) {
      expect(layer.url).toMatch(/^https:\/\/services3\.arcgis\.com\/DYnzeQNyuMo2mJ1o\/.+\/\d+$/);
    }
  });

  it('conserva las etiquetas en español, acentos incluidos', () => {
    const labels = MEPYD_LAYERS_FLAT.map((l) => l.label);
    expect(labels).toContain('Municipios (límites, provincia, región, población)');
    expect(labels).toContain('Vulnerabilidad física de edificaciones (municipio)');
    expect(labels).toContain('Gasoductos y oleoductos (buffer 500 m)');
    expect(labels).toContain('Obras de toma (canales INDRHI)');
    expect(labels).toContain('Ríos y arroyos');
    expect(labels).toContain('Área de amortiguamiento');
  });

  it('los grupos tienen la cantidad de capas del inventario', () => {
    expect(MEPYD_LAYERS.map((g) => g.layers.length)).toEqual([1, 6, 10, 6, 7, 7, 2]);
  });
});

describe('compuerta RD_BBOX', () => {
  it('el bbox es el declarado', () => {
    expect(RD_BBOX).toEqual([-72.05, 17.45, -68.3, 19.95]);
  });

  it('acepta lo que intersecta y rechaza lo que no', () => {
    expect(isInRd([-69.6, 18.45, -69.59, 18.46])).toBe(true);
    expect(isInRd([-72.5, 18, -72.1, 18.5])).toBe(false); // al oeste
    expect(isInRd([-72.1, 18, -72.0, 18.5])).toBe(true); // solapa el borde
    expect(isInRd([-58.5, -34.7, -58.3, -34.5])).toBe(false); // Buenos Aires
  });

  it('un AOI fuera de RD no hace UNA SOLA llamada de red (UC-11)', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return await Promise.resolve(new Response('{}', { status: 200 }));
    };
    const result = await fetchAllMepyd(squareAoi(-58.5, -34.6), { fetchImpl });
    expect(calls).toBe(0);
    expect(result).toEqual({ inRd: false, layers: [], failures: [] });
  });
});

describe('paginación ArcGIS', () => {
  it('sigue resultOffset mientras exceededTransferLimit sea true', async () => {
    const offsets: string[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      const params = new URLSearchParams(init?.body ?? '');
      const offset = params.get('resultOffset') ?? '';
      offsets.push(offset);
      const page = Number(offset);
      return await Promise.resolve(
        new Response(
          JSON.stringify({
            type: 'FeatureCollection',
            features: page === 0 ? [feature(1), feature(2)] : [feature(3)],
            properties: { exceededTransferLimit: page === 0 },
          }),
          { status: 200 },
        ),
      );
    };

    const result = await fetchAllMepyd(RD_AOI, {
      fetchImpl,
      layers: [MEPYD_LAYERS_FLAT[0]!],
    });
    expect(offsets).toEqual(['0', '2']);
    expect(result.layers[0]?.features).toHaveLength(3);
  });

  it('nunca pide más de 10 páginas, aunque el servicio insista', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return await Promise.resolve(
        new Response(
          JSON.stringify({
            features: [feature(calls)],
            properties: { exceededTransferLimit: true },
          }),
          { status: 200 },
        ),
      );
    };
    const result = await fetchAllMepyd(RD_AOI, {
      fetchImpl,
      layers: [MEPYD_LAYERS_FLAT[0]!],
    });
    expect(calls).toBe(MEPYD_MAX_PAGES);
    expect(result.layers[0]?.features).toHaveLength(MEPYD_MAX_PAGES);
  });

  it('un `{"error": …}` con HTTP 200 corta la paginación sin romper', async () => {
    const fetchImpl: FetchLike = async () =>
      await Promise.resolve(
        new Response(JSON.stringify({ error: { code: 400, message: 'Invalid' } }), { status: 200 }),
      );
    const result = await fetchAllMepyd(RD_AOI, {
      fetchImpl,
      layers: [MEPYD_LAYERS_FLAT[0]!],
    });
    expect(result.layers).toHaveLength(0);
    expect(result.failures).toHaveLength(0);
  });
});

describe('aislamiento de fallas y concurrencia (regresión #3, UC-12)', () => {
  const layers = MEPYD_LAYERS_FLAT.slice(0, 5);

  it('una capa caída se omite y no tumba las demás', async () => {
    const broken = layers[2];
    if (broken === undefined) throw new Error('fixture');
    const fetchImpl: FetchLike = async (url) => {
      if (url.startsWith(broken.url)) return await Promise.reject(new Error('502 Bad Gateway'));
      return await Promise.resolve(
        new Response(JSON.stringify({ features: [feature(1)], properties: {} }), { status: 200 }),
      );
    };

    const result = await fetchAllMepyd(RD_AOI, { fetchImpl, layers });
    expect(result.inRd).toBe(true);
    expect(result.layers).toHaveLength(4);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.layer.id).toBe(broken.id);
    expect(result.layers.some((l) => l.layer.id === broken.id)).toBe(false);
  });

  it('las capas vacías se descartan: toda capa presente tiene count >= 1', async () => {
    const fetchImpl: FetchLike = async (url) =>
      await Promise.resolve(
        new Response(
          JSON.stringify({
            features: url.startsWith(layers[0]?.url ?? '') ? [feature(1)] : [],
            properties: {},
          }),
          { status: 200 },
        ),
      );
    const result = await fetchAllMepyd(RD_AOI, { fetchImpl, layers });
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]?.features.length).toBeGreaterThanOrEqual(1);
  });

  it('respeta el orden del catálogo aunque las respuestas lleguen desordenadas', async () => {
    const fetchImpl: FetchLike = async (url) => {
      // La primera capa contesta última.
      const delay = url.startsWith(layers[0]?.url ?? '') ? 30 : 0;
      return await new Promise((resolve) => {
        setTimeout(() => {
          resolve(
            new Response(JSON.stringify({ features: [feature(1)], properties: {} }), {
              status: 200,
            }),
          );
        }, delay);
      });
    };
    const result = await fetchAllMepyd(RD_AOI, { fetchImpl, layers });
    expect(result.layers.map((l) => l.layer.id)).toEqual(layers.map((l) => l.id));
  });

  it('la concurrencia está acotada (10 workers, como el ThreadPoolExecutor)', async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchImpl: FetchLike = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return await new Promise((resolve) => {
        setTimeout(() => {
          inFlight -= 1;
          resolve(new Response(JSON.stringify({ features: [], properties: {} }), { status: 200 }));
        }, 5);
      });
    };
    await fetchAllMepyd(RD_AOI, { fetchImpl });
    expect(peak).toBeLessThanOrEqual(10);
    expect(peak).toBeGreaterThan(1);
  });
});
