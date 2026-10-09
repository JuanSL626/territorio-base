import { describe, expect, it } from 'vitest';

import { enrichCaliContextSources } from './cali-floor-snapshot';

import type { CaliContextLayer, IgacCadastre } from '@territorio/geo';

const GEOMETRY = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [-76.54, 3.38],
      [-76.53, 3.38],
      [-76.53, 3.39],
      [-76.54, 3.39],
      [-76.54, 3.38],
    ],
  ],
};

function snapshot(terrainKey: bigint, areaM2: number, floors: number): Uint8Array {
  const bytes = new Uint8Array(27);
  bytes.set(new TextEncoder().encode('TBFLOOR1'));
  const view = new DataView(bytes.buffer);
  view.setUint16(8, 2024);
  view.setUint32(10, 1);
  view.setBigUint64(14, terrainKey);
  view.setFloat32(22, areaM2);
  view.setUint8(26, floors);
  return bytes;
}

function layer(
  layerId: CaliContextLayer['layerId'],
  properties:
    | Record<string, string | number | boolean | null>
    | Record<string, string | number | boolean | null>[],
): CaliContextLayer {
  const rows = Array.isArray(properties) ? properties : [properties];
  return {
    layerId,
    label: layerId,
    count: rows.length,
    truncated: false,
    error: null,
    features: rows.map((row, index) => ({
      id: `${layerId}.${String(index + 1)}`,
      properties: row,
      geometry: GEOMETRY,
    })),
  };
}

describe('snapshot oficial de pisos de Cali', () => {
  it('completa ceros con la GDB 2024 y conserva la fuente y el año en cada capa', async () => {
    const result = await enrichCaliContextSources(
      {
        inColombia: true,
        parcels: [],
        truncated: false,
        idescLayers: [
          layer('idesc-constructions', [
            {
              npn: '760010100178300060002900000017',
              npisos: 0,
              shape_area: 88,
            },
            {
              npn: '760010100178300060002900000017',
              npisos: 5,
              shape_area: 88,
            },
          ]),
          layer('idesc-pot-activity', { area_de_ac: 'AREA DE ACTIVIDAD RESIDENCIAL NETA' }),
          layer('idesc-seismic-microzonation', { zona_mzsc: 'Zona 1' }),
        ],
        evidence: [
          {
            authority: 'Distrito de Santiago de Cali',
            accessProvider: 'IDESC',
            sourceId: 'cali-idesc-context',
            endpoint: 'https://ws-idesc.cali.gov.co/geoserver/wfs',
            sourceVersion: 'Servicio en línea',
            queriedAt: '2026-10-09T00:00:00.000Z',
            sourceUpdatedAt: null,
            coverage: 'regional',
            license: null,
            crs: 'EPSG:4326',
            query: {},
            payloadHash: 'live',
            warnings: [],
          },
        ],
      } satisfies IgacCadastre,
      {
        snapshot: snapshot(1_783_000_600_02n, 88, 3),
        now: new Date('2026-10-09T00:00:00.000Z'),
      },
    );

    expect(result.idescLayers?.[0]?.features[0]?.properties).toMatchObject({
      npisos: 3,
      npisos_servicio_idesc: 0,
      data_source: 'IDESC — Geodatabase catastral',
      source_year: '2024',
    });
    expect(result.idescLayers?.[0]?.features[1]?.properties).toMatchObject({
      npisos: 5,
      data_source: 'IDESC — servicio catastral en línea',
      source_year: 'Consulta 2026; vigencia no publicada',
    });
    expect(result.idescLayers?.[1]?.features[0]?.properties).toMatchObject({
      data_source: 'IDESC — POT de Santiago de Cali',
      source_year: '2014',
    });
    expect(result.idescLayers?.[2]?.features[0]?.properties).toMatchObject({
      data_source: 'IDESC — Microzonificación sísmica',
      source_year: 'Consulta 2026; vigencia no publicada',
    });
    expect(result.evidence.at(-1)).toMatchObject({
      sourceId: 'cali-idesc-construcciones-2024',
      sourceUpdatedAt: '2024-01-20',
    });
  });
});
