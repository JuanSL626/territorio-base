import { describe, expect, it } from 'vitest';

import { applyOverride } from './report-body';

import type { ReportMapState } from './report-model';
import type { StaticMapGeometries } from './static-map';

const STATE: ReportMapState = {
  layers: ['aoi', 'dem', 'ndvi', 'worldcover', 'slope-classes'],
  opacity: {},
  bounds: [-69.6, 18.4, -69.5, 18.5],
  basemap: 'light',
  highlight: [],
  fly: false,
  caption: 'Plano inicial.',
};

const GEOMETRIES: StaticMapGeometries = {
  aoi: null,
  hydrology: [
    {
      osm_id: 1,
      kind: 'waterway',
      name: 'Arroyo de prueba',
      distance_m: 0,
      geometry: {
        type: 'LineString',
        coordinates: [
          [-69.6, 18.45],
          [-69.5, 18.45],
        ],
      },
    },
  ],
  protectedAreas: [],
  mepyd: [],
};

describe('applyOverride', () => {
  it('prioriza la capa solicitada y conserva el tope de cuatro capas de datos', () => {
    const overridden = applyOverride(STATE, 'hidrologia-cercana', GEOMETRIES);

    expect(overridden.layers).toEqual(['aoi', 'osm-hydro', 'dem', 'ndvi', 'worldcover']);
    expect(overridden.layers).toHaveLength(5);
    expect(overridden.highlight).toEqual(['osm-hydro:1']);
  });
});
