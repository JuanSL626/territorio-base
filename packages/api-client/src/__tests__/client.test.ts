/**
 * Lo que se prueba acá es el borde: qué pasa cuando el servicio responde algo
 * que no es lo prometido. Es la mitad del contrato que los tipos generados no
 * pueden cubrir, porque en runtime no existen.
 */
import { describe, expect, it } from 'vitest';

import { createRasterApiClient } from '../client.ts';
import { isFailure, isOk } from '../result.ts';

const BASE = 'http://api.test';

const JOB = {
  id: 'job-1',
  status: 'running',
  created_at: '2026-01-01T00:00:00Z',
  progress: [],
  events_url: '/analysis/job-1/events',
  self_url: '/analysis/job-1',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function clientWith(handler: (url: string, init: RequestInit) => Promise<Response>) {
  return createRasterApiClient({
    baseUrl: `${BASE}/`,
    token: 'secreto',
    fetchImpl: handler,
  });
}

describe('createRasterApiClient', () => {
  it('rechaza un baseUrl vacío al construirse (bug del programador, no del dominio)', () => {
    expect(() => createRasterApiClient({ baseUrl: '' })).toThrow(/baseUrl/);
  });

  it('normaliza la barra final y absolutiza las URLs relativas del servicio', () => {
    const client = clientWith(async () => await Promise.resolve(jsonResponse({})));
    expect(client.baseUrl).toBe(BASE);
    expect(client.absoluteUrl('/analysis/x/overlay/dem.png')).toBe(
      `${BASE}/analysis/x/overlay/dem.png`,
    );
    expect(client.absoluteUrl('https://otro/x.png')).toBe('https://otro/x.png');
  });

  it('manda el token como Bearer', async () => {
    let seen: Record<string, string> | undefined;
    const client = clientWith(async (_url, init) => {
      seen = init.headers as Record<string, string>;
      return await Promise.resolve(jsonResponse(JOB));
    });

    await client.getAnalysis('job-1');
    expect(seen?.authorization).toBe('Bearer secreto');
  });

  it('valida el cuerpo 2xx y devuelve ok', async () => {
    const client = clientWith(async () => await Promise.resolve(jsonResponse(JOB)));
    const result = await client.getAnalysis('job-1');

    expect(isOk(result)).toBe(true);
    if (!result.ok) throw new Error('debería haber salido ok');
    expect(result.data.status).toBe('running');
  });

  it('un 2xx que no cumple el contrato es `contrato`, con las rutas que fallaron', async () => {
    const client = clientWith(
      async () => await Promise.resolve(jsonResponse({ ...JOB, status: 'terminado-quizas' })),
    );
    const result = await client.getAnalysis('job-1');

    expect(isFailure(result)).toBe(true);
    if (result.ok) throw new Error('debería haber fallado');
    expect(result.kind).toBe('contrato');
    expect(result.issues?.join(' ')).toContain('status');
  });

  it('un 2xx que no es JSON también es `contrato`, no un crash', async () => {
    const client = clientWith(
      async () =>
        await Promise.resolve(
          new Response('<html>proxy</html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
        ),
    );
    const result = await client.getAnalysis('job-1');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('contrato');
  });

  it('mapea cada status HTTP a su clase de fallo y conserva el detalle en español', async () => {
    const cases = [
      [401, 'no-autorizado'],
      [404, 'no-encontrado'],
      [409, 'no-listo'],
      [422, 'aoi-invalido'],
      [500, 'servicio'],
    ] as const;

    for (const [status, kind] of cases) {
      const client = clientWith(
        async () => await Promise.resolve(jsonResponse({ detail: 'Motivo del servicio.' }, status)),
      );
      const result = await client.getAnalysis('job-1');
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.kind).toBe(kind);
      expect(result.status).toBe(status);
      expect(result.message).toBe('Motivo del servicio.');
    }
  });

  it('aplana el `detail` de lista de un 422 de FastAPI', async () => {
    const client = clientWith(
      async () =>
        await Promise.resolve(
          jsonResponse({ detail: [{ msg: 'El polígono está vacío.', loc: ['body', 'aoi'] }] }, 422),
        ),
    );
    const result = await client.getAnalysis('job-1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe('El polígono está vacío.');
  });

  it('una caída de red es `red`, no una excepción', async () => {
    const client = clientWith(async () => await Promise.reject(new Error('ECONNREFUSED')));
    const result = await client.health();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('red');
  });

  it('un abort del llamador es `cancelado`, que la UI no debe mostrar como error', async () => {
    const client = clientWith(async () => {
      const error = new Error('abortado');
      error.name = 'AbortError';
      return await Promise.reject(error);
    });
    const result = await client.health();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('cancelado');
  });

  it('createAnalysis rellena los defaults del pipeline', async () => {
    let body: unknown;
    const client = clientWith(async (_url, init) => {
      body = JSON.parse(init.body as string) as unknown;
      return await Promise.resolve(jsonResponse(JOB, 202));
    });

    await client.createAnalysis({ aoi: { type: 'Polygon' } });
    expect(body).toEqual({
      aoi: { type: 'Polygon' },
      ndvi_resolution_m: 10,
      lookback_days: 180,
      max_cloud_cover: 30,
    });
  });

  it('arma las URLs de overlay y GeoTIFF con sus parámetros de rampa', () => {
    const client = clientWith(async () => await Promise.resolve(jsonResponse({})));
    expect(client.overlayUrl('a b', 'dem', { opacity: 0.7 })).toBe(
      `${BASE}/analysis/a%20b/overlay/dem.png?opacity=0.7`,
    );
    expect(client.rasterUrl('id', 'worldcover')).toBe(`${BASE}/analysis/id/raster/worldcover.tif`);
    expect(client.coastalOverlayUrl('key', { opacity: 0.8 })).toBe(
      `${BASE}/coastal/key/overlay.png?opacity=0.8`,
    );
  });

  it('lee los bounds del header X-Bounds y no reordena las esquinas (regresión #1)', async () => {
    const coordinates = [
      [-70, 19],
      [-69, 19],
      [-69, 18],
      [-70, 18],
    ];
    const client = clientWith(
      async () =>
        await Promise.resolve(
          new Response(new Uint8Array([137, 80, 78, 71]), {
            status: 200,
            headers: {
              'content-type': 'image/png',
              'x-bounds': JSON.stringify([-70, 18, -69, 19]),
              'x-overlay-coordinates': JSON.stringify(coordinates),
              'x-overlay-metadata-url': '/analysis/id/overlay/dem.json',
            },
          }),
        ),
    );

    const result = await client.getOverlayImage('id', 'dem');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.bounds).toEqual([-70, 18, -69, 19]);
    expect(result.data.coordinates).toEqual(coordinates);
    expect(result.data.metadataUrl).toBe(`${BASE}/analysis/id/overlay/dem.json`);
    expect(result.data.bytes[0]).toBe(137);
  });

  it('un overlay sin X-Bounds es un fallo de contrato, no un PNG sin ubicar', async () => {
    const client = clientWith(
      async () =>
        await Promise.resolve(
          new Response(new Uint8Array([137]), {
            status: 200,
            headers: { 'content-type': 'image/png' },
          }),
        ),
    );
    const result = await client.getOverlayImage('id', 'dem');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('contrato');
    expect(result.message).toContain('X-Bounds');
  });
});
