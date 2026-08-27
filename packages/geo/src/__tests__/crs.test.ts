import { describe, expect, it } from 'vitest';

import {
  assertSupportedEpsg,
  isUtmEpsg,
  projectGeometry,
  utmEpsgForLonLat,
  verifyUtmDefinitions,
  wktForEpsg,
  WGS84_EPSG,
} from '../crs';

describe('crs — definiciones UTM', () => {
  it('proj4js trae las 120 zonas UTM/WGS84 precargadas (norte y sur)', () => {
    // La tarea pedía verificarlo en vez de asumirlo: efectivamente vienen
    // built-in, no hace falta registrar ninguna definición a mano.
    expect(verifyUtmDefinitions()).toEqual([]);
  });

  it('proyecta ida y vuelta sin deriva apreciable', () => {
    const point = { type: 'Point' as const, coordinates: [-69.571, 18.453] };
    const utm = projectGeometry(point, WGS84_EPSG, 32619);
    expect(utm.type).toBe('Point');
    const back = projectGeometry(utm, 32619, WGS84_EPSG);
    if (back.type !== 'Point') throw new Error('tipo inesperado');
    expect(back.coordinates[0]).toBeCloseTo(-69.571, 9);
    expect(back.coordinates[1]).toBeCloseTo(18.453, 9);
  });

  it('rechaza EPSG que necesitarían grillas de corrimiento (H15)', () => {
    expect(() => {
      assertSupportedEpsg(26719); // NAD27 / UTM 19N
    }).toThrow(/no está soportado/);
    expect(() => {
      assertSupportedEpsg(3857);
    }).toThrow();
  });
});

describe('crs — zona UTM desde lon/lat', () => {
  it('replica la fórmula de aoi.py', () => {
    expect(utmEpsgForLonLat(-69.571, 18.453)).toBe(32619); // Santo Domingo
    expect(utmEpsgForLonLat(-72.1, 19.0)).toBe(32618); // al oeste de 72°W
    expect(utmEpsgForLonLat(-71.9, 19.0)).toBe(32619); // al este de 72°W
    expect(utmEpsgForLonLat(-58.4, -34.6)).toBe(32721); // hemisferio sur
    expect(utmEpsgForLonLat(0, 0)).toBe(32631);
  });

  it('no se sale de rango en los bordes', () => {
    expect(utmEpsgForLonLat(-180, 0)).toBe(32601);
    expect(utmEpsgForLonLat(180, 0)).toBe(32601);
    expect(utmEpsgForLonLat(179.999, 0)).toBe(32660);
    expect(isUtmEpsg(utmEpsgForLonLat(179.999, -1))).toBe(true);
  });
});

describe('crs — WKT para el .prj (H7)', () => {
  it('el meridiano central y la falsa norte salen de la zona real', () => {
    const wkt = wktForEpsg(32619);
    expect(wkt).toContain('PROJCS["WGS 84 / UTM zone 19N"');
    expect(wkt).toContain('PARAMETER["central_meridian",-69]');
    expect(wkt).toContain('PARAMETER["false_northing",0]');
    expect(wkt).toContain('AUTHORITY["EPSG","32619"]');
  });

  it('el hemisferio sur lleva false_northing 10.000.000', () => {
    const wkt = wktForEpsg(32721);
    expect(wkt).toContain('PROJCS["WGS 84 / UTM zone 21S"');
    expect(wkt).toContain('PARAMETER["false_northing",10000000]');
  });

  it('el .prj geográfico incluye el nodo AUTHORITY que a shp-write le falta', () => {
    expect(wktForEpsg(WGS84_EPSG)).toContain('AUTHORITY["EPSG","4326"]');
    expect(wktForEpsg(WGS84_EPSG)).not.toContain('PROJCS');
  });

  it('un EPSG distinto produce un .prj distinto — nunca la misma constante', () => {
    expect(wktForEpsg(32619)).not.toBe(wktForEpsg(32620));
    expect(wktForEpsg(32619)).not.toBe(wktForEpsg(WGS84_EPSG));
  });
});
