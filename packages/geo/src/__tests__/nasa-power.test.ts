import { describe, expect, it } from 'vitest';

import { createAoi } from '../aoi';
import {
  fetchNasaPowerSolar,
  NASA_POWER_PARAMETERS,
  NasaPowerUnavailableError,
} from '../sources/nasa-power';

import type { FetchLike } from '../http';

const AOI = createAoi({
  type: 'Polygon',
  coordinates: [
    [
      [-69.6, 18.44],
      [-69.58, 18.44],
      [-69.58, 18.46],
      [-69.6, 18.46],
      [-69.6, 18.44],
    ],
  ],
});

const MONTHLY = {
  JAN: 4.6214,
  FEB: 5.4262,
  MAR: 6.0024,
  APR: 6.2208,
  MAY: 6.0168,
  JUN: 5.9722,
  JUL: 6.0562,
  AUG: 5.8217,
  SEP: 5.6268,
  OCT: 5.0503,
  NOV: 4.6226,
  DEC: 4.3982,
  ANN: 5.4854,
};

function fixture(fill = -999): unknown {
  const parameter = Object.fromEntries(
    NASA_POWER_PARAMETERS.map((key, index) => [
      key,
      Object.fromEntries(Object.entries(MONTHLY).map(([period, value]) => [period, value + index])),
    ]),
  );
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-69.59, 18.45, 47.67] },
    properties: { parameter },
    header: {
      api: { version: 'v2.10.0', name: 'POWER Climatology API' },
      sources: ['MERRA2', 'SYN1DEG', 'POWER'],
      fill_value: fill,
      time_standard: 'LST',
      range: '20-year climatology (January 2001 - December 2020)',
    },
    parameters: Object.fromEntries(
      NASA_POWER_PARAMETERS.map((key) => [
        key,
        { units: key === 'CLOUD_AMT' ? '%' : 'kW-hr/m^2/day', longname: key },
      ]),
    ),
  };
}

function fetchFixture(body: unknown, capture?: (url: string) => void): FetchLike {
  return async (url) => {
    capture?.(url);
    return await Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };
}

describe('NASA POWER solar', () => {
  it('consulta el centro del AOI y conserva trazabilidad del proveedor', async () => {
    let requested = '';
    const result = await fetchNasaPowerSolar(AOI, {
      fetchImpl: fetchFixture(fixture(), (url) => {
        requested = url;
      }),
      checkedAt: new Date('2026-09-22T00:00:00Z'),
    });

    const url = new URL(requested);
    expect(url.searchParams.get('longitude')).toBe('-69.590000');
    expect(url.searchParams.get('latitude')).toBe('18.450000');
    expect(url.searchParams.get('parameters')?.split(',')).toEqual([...NASA_POWER_PARAMETERS]);
    expect(result).toMatchObject({
      checkedAt: '2026-09-22T00:00:00.000Z',
      latitude: 18.45,
      longitude: -69.59,
      elevationM: 47.67,
      timeStandard: 'LST',
      apiVersion: 'v2.10.0',
      sourceDatasets: ['MERRA2', 'SYN1DEG', 'POWER'],
      spatialResolution: '1° × 1°',
    });
  });

  it('marca las horas solares pico y el total anual como derivados', async () => {
    const result = await fetchNasaPowerSolar(AOI, { fetchImpl: fetchFixture(fixture()) });
    expect(result.annual.ghiKwhM2Day).toBe(5.4854);
    expect(result.annual.peakSunHoursDay).toBe(5.4854);
    expect(result.annual.annualGhiKwhM2).toBeCloseTo(2_002.171, 3);
    expect(result.monthly).toHaveLength(12);
    expect(result.formulas.peakSunHoursDay).toContain('GHI diario');
  });

  it('rechaza el fill value: dato faltante no se presenta como radiación real', async () => {
    const invalid = fixture() as {
      properties: { parameter: { ALLSKY_SFC_SW_DWN: Record<string, number> } };
    };
    invalid.properties.parameter.ALLSKY_SFC_SW_DWN.JAN = -999;
    await expect(
      fetchNasaPowerSolar(AOI, { fetchImpl: fetchFixture(invalid) }),
    ).rejects.toBeInstanceOf(NasaPowerUnavailableError);
  });
});
