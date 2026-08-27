import { describe, expect, it } from 'vitest';

import {
  coordinatesFromBounds,
  coordinatesOf,
  parseBoundsHeader,
  RASTER_LAYER_BY_ID,
  resolveOverlayUrl,
} from './overlays';

import type { OverlayMetadata } from '@territorio/api-client';

/*
  REGRESIÓN #1 DEL INVENTARIO. Este bloque de tests ES el candado.

  El bug histórico espejaba el raster norte-sur. La invariante que lo impide
  cabe en una línea: la PRIMERA esquina de `ImageSource.coordinates` es la
  superior-izquierda, y con bounds `[west, south, east, north]` eso es
  `[west, north]` — NORTE arriba, igual que la fila 0 de un PNG.
*/
describe('coordinatesFromBounds — orientación norte-sur', () => {
  const bounds: [number, number, number, number] = [-70, 18, -69, 19];

  it('pone el NORTE en las dos primeras esquinas', () => {
    const [topLeft, topRight, bottomRight, bottomLeft] = coordinatesFromBounds(bounds);

    expect(topLeft).toEqual([-70, 19]);
    expect(topRight).toEqual([-69, 19]);
    expect(bottomRight).toEqual([-69, 18]);
    expect(bottomLeft).toEqual([-70, 18]);
  });

  it('la latitud de arriba es MAYOR que la de abajo (no está espejado)', () => {
    const corners = coordinatesFromBounds(bounds);
    const north = corners[0][1];
    const south = corners[3][1];
    expect(north).toBeGreaterThan(south);
  });

  it('no depende del signo de la longitud (hemisferio oeste, como RD)', () => {
    const corners = coordinatesFromBounds([-72.05, 17.45, -68.3, 19.95]);
    expect(corners[0]).toEqual([-72.05, 19.95]);
    expect(corners[2]).toEqual([-68.3, 17.45]);
  });
});

function metadata(overrides: Partial<OverlayMetadata> = {}): OverlayMetadata {
  return {
    bounds: [-70, 18, -69, 19],
    coordinates: [
      [-70, 19],
      [-69, 19],
      [-69, 18],
      [-70, 18],
    ],
    height: 100,
    width: 100,
    layer: 'dem',
    legend: [],
    legend_title: 'Elevación',
    opacity: 0.7,
    png_url: '/analysis/abc/overlay/dem.png',
    ...overrides,
  };
}

describe('coordinatesOf', () => {
  it('usa las esquinas del servicio TAL CUAL, sin reordenarlas', () => {
    const corners = coordinatesOf(metadata());
    expect(corners).toEqual([
      [-70, 19],
      [-69, 19],
      [-69, 18],
      [-70, 18],
    ]);
  });

  it('cae a los bounds si el sidecar manda una lista mal formada', () => {
    expect(coordinatesOf(metadata({ coordinates: [[1, 2]] }))).toEqual(
      coordinatesFromBounds([-70, 18, -69, 19]),
    );
  });

  it('cae a los bounds si una esquina no trae los dos números', () => {
    const broken = metadata({ coordinates: [[-70, 19], [-69], [-69, 18], [-70, 18]] });
    expect(coordinatesOf(broken)).toEqual(coordinatesFromBounds([-70, 18, -69, 19]));
  });
});

describe('parseBoundsHeader', () => {
  it('lee el JSON de X-Bounds', () => {
    expect(parseBoundsHeader('[-70, 18, -69, 19]')).toEqual([-70, 18, -69, 19]);
  });

  it('rechaza lo que no sea 4 números', () => {
    expect(parseBoundsHeader(null)).toBeNull();
    expect(parseBoundsHeader('no-json')).toBeNull();
    expect(parseBoundsHeader('[1, 2, 3]')).toBeNull();
    expect(parseBoundsHeader('[1, 2, 3, "x"]')).toBeNull();
  });
});

describe('resolveOverlayUrl', () => {
  it('absolutiza la ruta relativa del servicio', () => {
    expect(resolveOverlayUrl('/analysis/a/overlay/dem.png', 'http://localhost:8787')).toBe(
      'http://localhost:8787/analysis/a/overlay/dem.png',
    );
  });

  it('respeta una URL ya absoluta (el overlay costero)', () => {
    const absolute = 'http://api.example/coastal/k/overlay.png';
    expect(resolveOverlayUrl(absolute, 'http://localhost:8787')).toBe(absolute);
  });

  it('normaliza la barra final de la base', () => {
    expect(resolveOverlayUrl('/x.png', 'http://localhost:8787/')).toBe(
      'http://localhost:8787/x.png',
    );
  });

  it('devuelve null sin base: mejor una fila con estado que una imagen rota', () => {
    expect(resolveOverlayUrl('/x.png', undefined)).toBeNull();
    expect(resolveOverlayUrl(null, 'http://localhost:8787')).toBeNull();
  });
});

describe('puente registro ↔ servicio raster', () => {
  it('traduce los dos ids que NO coinciden por nombre', () => {
    expect(RASTER_LAYER_BY_ID['ndvi-density']).toBe('ndvi_density');
    expect(RASTER_LAYER_BY_ID.aqueduct).toBe('coastal');
  });
});
