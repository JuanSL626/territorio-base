import { buffer as turfBuffer } from '@turf/turf';
import { describe, expect, it } from 'vitest';

import { projectGeometry, WGS84_EPSG } from '../crs';
import {
  areaHectares,
  bufferMeters,
  distanceMeters,
  intersects,
  planarArea,
  planarBuffer,
  planarDistance,
  segmentToSegmentDistance,
  unionAreas,
} from '../geometry';

import type { LineString, Polygon, Position } from '../geojson';

const UTM = 32619;

/** Cuadrado de 1 km de lado cerca de Santo Domingo. */
function square(lon: number, lat: number, sizeDeg: number): Polygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [lon, lat],
        [lon + sizeDeg, lat],
        [lon + sizeDeg, lat + sizeDeg],
        [lon, lat + sizeDeg],
        [lon, lat],
      ],
    ],
  };
}

const AOI = square(-69.6, 18.45, 0.01);

/** Mínimo vértice-a-vértice: el port ingenuo que H8 describe. */
function naiveVertexDistance(a: Position[], b: Position[]): number {
  let best = Infinity;
  for (const p of a) {
    for (const q of b) {
      best = Math.min(best, Math.hypot((p[0] ?? 0) - (q[0] ?? 0), (p[1] ?? 0) - (q[1] ?? 0)));
    }
  }
  return best;
}

describe('H8 — distancia segmento a segmento, no vértice a vértice', () => {
  it('un río de 2 vértices que pasa a ~50 m no se reporta a kilómetros', () => {
    // Río largo (vértices a ~5 km uno del otro, como los digitaliza OSM) que
    // pasa raspando el borde sur del AOI.
    const river: LineString = {
      type: 'LineString',
      coordinates: [
        [-69.63, 18.4495],
        [-69.56, 18.4495],
      ],
    };

    const aoiUtm = projectGeometry(AOI, WGS84_EPSG, UTM);
    const riverUtm = projectGeometry(river, WGS84_EPSG, UTM);
    if (aoiUtm.type !== 'Polygon' || riverUtm.type !== 'LineString') throw new Error('tipos');

    const correct = planarDistance(aoiUtm, riverUtm);
    const naive = naiveVertexDistance(aoiUtm.coordinates[0] ?? [], riverUtm.coordinates);

    expect(correct).toBeGreaterThan(30);
    expect(correct).toBeLessThan(80);
    // El error del port ingenuo: sobre-reporta por un factor grande.
    expect(naive / correct).toBeGreaterThan(20);
  });

  it('segmento a segmento coincide con la geometría exacta en casos conocidos', () => {
    // Dos segmentos paralelos a distancia 3.
    expect(
      segmentToSegmentDistance(
        [
          [0, 0],
          [10, 0],
        ],
        [
          [0, 3],
          [10, 3],
        ],
      ),
    ).toBeCloseTo(3, 12);

    // Segmentos que se cruzan → 0 exacto.
    expect(
      segmentToSegmentDistance(
        [
          [-5, 0],
          [5, 0],
        ],
        [
          [0, -5],
          [0, 5],
        ],
      ),
    ).toBe(0);

    // Extremos enfrentados en diagonal.
    expect(
      segmentToSegmentDistance(
        [
          [0, 0],
          [1, 0],
        ],
        [
          [4, 3],
          [8, 9],
        ],
      ),
    ).toBeCloseTo(Math.hypot(3, 3), 12);
  });
});

describe('H9 — la intersección se decide con booleanIntersects, nunca con `=== 0`', () => {
  const crossing: LineString = {
    type: 'LineString',
    coordinates: [
      [-69.62, 18.455],
      [-69.58, 18.455],
    ],
  };

  it('un río que cruza el AOI da intersects=true y distancia exactamente 0', () => {
    expect(intersects(AOI, crossing)).toBe(true);
    const d = distanceMeters(AOI, crossing, UTM);
    expect(d).toBe(0);
    // Y no "casi cero": el punto de la crítica es que un cálculo en punto
    // flotante devolvería 1e-13 y `d === 0` sería false.
    expect(Object.is(d, 0)).toBe(true);
  });

  it('un lago enteramente contenido intersecta aunque sus bordes estén lejos', () => {
    const lake = square(-69.596, 18.454, 0.001);
    expect(intersects(AOI, lake)).toBe(true);
    expect(distanceMeters(AOI, lake, UTM)).toBe(0);
    // La distancia borde-a-borde sola NO lo detectaría:
    const aoiUtm = projectGeometry(AOI, WGS84_EPSG, UTM);
    const lakeUtm = projectGeometry(lake, WGS84_EPSG, UTM);
    expect(planarDistance(aoiUtm, lakeUtm)).toBeGreaterThan(100);
  });

  it('una geometría disjunta da distancia > 0', () => {
    const far = square(-69.4, 18.45, 0.005);
    expect(intersects(AOI, far)).toBe(false);
    expect(distanceMeters(AOI, far, UTM)).toBeGreaterThan(10_000);
  });
});

describe('H10 — buffer plano en UTM, no azimutal esférico', () => {
  const center: Position = [-69.6, 18.45];

  it('el radio del buffer es uniforme en UTM; el de turf.buffer no lo es', () => {
    const point = { type: 'Point' as const, coordinates: center };

    const ours = bufferMeters(point, 500, UTM);
    const oursUtm = projectGeometry(ours, WGS84_EPSG, UTM);
    if (oursUtm.type !== 'Polygon') throw new Error('se esperaba Polygon');
    const centerUtm = projectGeometry(point, WGS84_EPSG, UTM);
    if (centerUtm.type !== 'Point') throw new Error('tipo');
    const [cx, cy] = [centerUtm.coordinates[0] ?? 0, centerUtm.coordinates[1] ?? 0];

    const radii = (oursUtm.coordinates[0] ?? []).map((p) =>
      Math.hypot((p[0] ?? 0) - cx, (p[1] ?? 0) - cy),
    );
    const spread = Math.max(...radii) - Math.min(...radii);
    expect(Math.max(...radii)).toBeCloseTo(500, 6);
    expect(spread).toBeLessThan(1e-6);

    // turf.buffer: azimutal equidistante ESFÉRICA. Medida en la misma zona UTM
    // su radio no es constante — la variación que la crítica documenta.
    const turfed = turfBuffer(point, 0.5, { units: 'kilometers', steps: 8 });
    if (turfed === undefined) throw new Error('turf.buffer devolvió undefined');
    const turfUtm = projectGeometry(turfed.geometry, WGS84_EPSG, UTM);
    if (turfUtm.type !== 'Polygon') throw new Error('tipo');
    const turfRadii = (turfUtm.coordinates[0] ?? []).map((p) =>
      Math.hypot((p[0] ?? 0) - cx, (p[1] ?? 0) - cy),
    );
    const turfSpread = Math.max(...turfRadii) - Math.min(...turfRadii);
    expect(turfSpread).toBeGreaterThan(spread);
  });

  it('lanza en entradas degeneradas en vez de devolver undefined', () => {
    const point = { type: 'Point' as const, coordinates: center };
    expect(() => planarBuffer(point, 0)).toThrow(/radio/);
    expect(() => planarBuffer(point, -10)).toThrow(/radio/);
    expect(() => planarBuffer(point, Number.NaN)).toThrow(/radio/);
  });

  it('el resultado viene disuelto: no double-countea solapes', () => {
    // Dos cuadrados que casi se tocan: al bufferearlos se solapan.
    const a = square(-69.6, 18.45, 0.002);
    const b = square(-69.5985, 18.45, 0.002);
    const merged = unionAreas([a, b]);

    const bufferedTogether = bufferMeters(merged, 300, UTM);
    const areaTogether = areaHectares(bufferedTogether, UTM);
    const areaApart =
      areaHectares(bufferMeters(a, 300, UTM), UTM) + areaHectares(bufferMeters(b, 300, UTM), UTM);

    expect(areaTogether).toBeLessThan(areaApart);
  });

  it('bufferear expande el área en la magnitud esperada', () => {
    // Un cuadrado de lado L bufferado r: L² + 4Lr + πr².
    const utmSquare: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [400000, 2000000],
          [401000, 2000000],
          [401000, 2001000],
          [400000, 2001000],
          [400000, 2000000],
        ],
      ],
    };
    const buffered = planarBuffer(utmSquare, 100);
    const expected = 1000 * 1000 + 4 * 1000 * 100 + Math.PI * 100 * 100;
    // El polígono es inscripto (quad_segs=8, como GEOS), así que queda apenas
    // por debajo del área analítica.
    expect(planarArea(buffered)).toBeGreaterThan(expected * 0.995);
    expect(planarArea(buffered)).toBeLessThanOrEqual(expected);
  });
});

describe('área', () => {
  it('el área se calcula en UTM, en hectáreas', () => {
    const utmSquare: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [400000, 2000000],
          [401000, 2000000],
          [401000, 2001000],
          [400000, 2001000],
          [400000, 2000000],
        ],
      ],
    };
    expect(planarArea(utmSquare)).toBeCloseTo(1_000_000, 6);
  });

  it('los huecos se restan', () => {
    const donut: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [100, 0],
          [100, 100],
          [0, 100],
          [0, 0],
        ],
        [
          [40, 40],
          [40, 60],
          [60, 60],
          [60, 40],
          [40, 40],
        ],
      ],
    };
    expect(planarArea(donut)).toBeCloseTo(10_000 - 400, 6);
  });
});
