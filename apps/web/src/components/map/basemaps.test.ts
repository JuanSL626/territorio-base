import { describe, expect, it } from 'vitest';

import { BASEMAPS } from './basemaps';

describe('basemap claro', () => {
  it('usa el endpoint canónico de teselas de OpenStreetMap', () => {
    expect(BASEMAPS.light.tiles).toEqual(['https://tile.openstreetmap.org/{z}/{x}/{y}.png']);
  });
});
