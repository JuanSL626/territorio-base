import { describe, expect, it } from 'vitest';

import { createAoi, type Aoi } from '../aoi';
import {
  fetchDaneContext,
  fetchIgacCadastre,
  isInColombia,
  type DaneContext,
  type IgacCadastre,
} from '../sources/colombia';

import type { FetchLike } from '../http';

function squareAoi(lon: number, lat: number): Aoi {
  return createAoi({
    type: 'Polygon',
    coordinates: [
      [
        [lon, lat],
        [lon + 0.001, lat],
        [lon + 0.001, lat + 0.001],
        [lon, lat + 0.001],
        [lon, lat],
      ],
    ],
  });
}

const AGUADAS = squareAoi(-75.4557, 5.6096);
const JAMUNDI = squareAoi(-76.57002, 3.25446);
const COSTA_RICA = squareAoi(-84.1, 9.9);

async function jsonResponse(value: unknown): Promise<Response> {
  return await Promise.resolve(
    new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function form(init: Parameters<FetchLike>[1]): URLSearchParams {
  return new URLSearchParams(init?.body ?? '');
}

describe('compuerta de Colombia', () => {
  it('acepta Aguadas y rechaza un AOI fuera del país', () => {
    expect(isInColombia(AGUADAS.bbox)).toBe(true);
    expect(isInColombia(COSTA_RICA.bbox)).toBe(false);
  });

  it('no toca DANE ni IGAC fuera de Colombia', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return await jsonResponse({});
    };

    const [dane, igac] = await Promise.all([
      fetchDaneContext(COSTA_RICA, { fetchImpl }),
      fetchIgacCadastre(COSTA_RICA, { fetchImpl }),
    ]);

    expect(calls).toBe(0);
    expect(dane).toEqual<DaneContext>({ inColombia: false, municipalities: [], evidence: [] });
    expect(igac).toEqual<IgacCadastre>({
      inColombia: false,
      parcels: [],
      truncated: false,
      evidence: [],
    });
  });
});

describe('DANE — municipio y CNPV 2018', () => {
  it('resuelve DIVIPOLA y calcula coberturas de servicios sin inventar denominadores', async () => {
    const fetchImpl: FetchLike = async (url, init) => {
      const params = form(init);
      if (url.includes('Serv_DIVIPOLA_MGN_2025')) {
        expect(params.get('geometryType')).toBe('esriGeometryPolygon');
        expect(params.get('spatialRel')).toBe('esriSpatialRelIntersects');
        return await jsonResponse({
          features: [
            {
              attributes: {
                DPTO_CCDGO: '17',
                MPIO_CCDGO: '013',
                MPIO_CDPMP: '17013',
                MPIO_TIPO: 'MUNICIPIO',
                MPIO_NAREA: 475.56670665,
                MPIO_NANO: 2024,
                DPTO_CNMBRE: 'CALDAS',
                MPIO_CNMBRE: 'AGUADAS',
              },
            },
          ],
        });
      }

      expect(url).toContain('Serv_DatosCNPV2018_Integrados_MGN2018');
      expect(params.get('where')).toBe("MPIO_CDPMP = '17013'");
      return await jsonResponse({
        features: [
          {
            attributes: {
              MPIO_CDPMP: '17013',
              STVIVIENDA: 8_617,
              TSP16_HOG: 6_955,
              STP27_PERS: 20_712,
              STP19_EC_1: 6_772,
              STP19_ES_2: 54,
              STP19_ACU1: 5_377,
              STP19_ACU2: 1_449,
              STP19_ALC1: 4_011,
              STP19_ALC2: 2_815,
              STP19_INT1: 1_016,
              STP19_INT2: 5_793,
              STP19_INT9: 17,
            },
          },
        ],
      });
    };

    const result = await fetchDaneContext(AGUADAS, { fetchImpl });
    expect(result.inColombia).toBe(true);
    expect(result.municipalities).toHaveLength(1);
    expect(result.municipalities[0]).toMatchObject({
      code: '17013',
      name: 'AGUADAS',
      departmentCode: '17',
      departmentName: 'CALDAS',
      geographicVersion: 2024,
      census2018: {
        population: 20_712,
        households: 6_955,
        dwellings: 8_617,
      },
    });
    expect(result.municipalities[0]?.census2018?.electricityAccessPct).toBeCloseTo(99.21, 2);
    expect(result.municipalities[0]?.census2018?.aqueductAccessPct).toBeCloseTo(78.77, 2);
    expect(result.municipalities[0]?.census2018?.sewerAccessPct).toBeCloseTo(58.76, 2);
    expect(result.municipalities[0]?.census2018?.internetAccessPct).toBeCloseTo(14.92, 2);
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence.every((item) => /^[a-f0-9]{64}$/.test(item.payloadHash))).toBe(true);
    expect(result.evidence[0]).toMatchObject({
      accessProvider: 'Geoportal DANE (ArcGIS REST)',
      crs: 'EPSG:4326',
      query: { method: 'POST', spatialRelationship: 'esriSpatialRelIntersects' },
    });
  });

  it('conserva el municipio aunque CNPV no tenga una fila', async () => {
    const fetchImpl: FetchLike = async (url) =>
      await (url.includes('Serv_DIVIPOLA_MGN_2025')
        ? jsonResponse({
            features: [
              {
                attributes: {
                  DPTO_CCDGO: '17',
                  MPIO_CCDGO: '013',
                  MPIO_CDPMP: '17013',
                  MPIO_TIPO: 'MUNICIPIO',
                  MPIO_NAREA: 475.5,
                  MPIO_NANO: 2024,
                  DPTO_CNMBRE: 'CALDAS',
                  MPIO_CNMBRE: 'AGUADAS',
                },
              },
            ],
          })
        : jsonResponse({ features: [] }));

    const result = await fetchDaneContext(AGUADAS, { fetchImpl });
    expect(result.municipalities[0]?.code).toBe('17013');
    expect(result.municipalities[0]?.census2018).toBeNull();
    expect(result.evidence[1]?.warnings).toContain('CNPV 2018 no devolvió datos para 17013.');
  });

  it('conserva DIVIPOLA cuando el servicio CNPV falla', async () => {
    const fetchImpl: FetchLike = async (url) =>
      await (url.includes('Serv_DIVIPOLA_MGN_2025')
        ? jsonResponse({
            features: [
              {
                attributes: {
                  DPTO_CCDGO: '17',
                  MPIO_CCDGO: '013',
                  MPIO_CDPMP: '17013',
                  MPIO_TIPO: 'MUNICIPIO',
                  MPIO_NAREA: 475.5,
                  MPIO_NANO: 2025,
                  DPTO_CNMBRE: 'CALDAS',
                  MPIO_CNMBRE: 'AGUADAS',
                },
              },
            ],
          })
        : Promise.resolve(new Response(null, { status: 503, statusText: 'Service Unavailable' })));

    const result = await fetchDaneContext(AGUADAS, { fetchImpl });
    expect(result.municipalities[0]).toMatchObject({ code: '17013', census2018: null });
    expect(result.evidence[1]?.warnings[0]).toContain('HTTP 503');
  });
});

describe('IGAC — base catastral pública', () => {
  it('une el terreno con Registro 1 y conserva la geometría', async () => {
    const code = '170130100000000010001000000001';
    const fetchImpl: FetchLike = async (url, init) => {
      const params = form(init);
      if (url.includes('/7/query')) {
        expect(params.get('f')).toBe('geojson');
        return await jsonResponse({
          type: 'FeatureCollection',
          properties: { exceededTransferLimit: false },
          features: [
            {
              type: 'Feature',
              properties: {
                CODIGO: code,
                CODIGO_ANTERIOR: '17013000100010001000',
                codigo_municipio: '17013',
                Shape__Area: 120.5,
              },
              geometry: {
                type: 'Polygon',
                coordinates: [
                  [
                    [-75.4557, 5.6096],
                    [-75.4556, 5.6096],
                    [-75.4556, 5.6097],
                    [-75.4557, 5.6097],
                    [-75.4557, 5.6096],
                  ],
                ],
              },
            },
          ],
        });
      }
      if (url.includes('/14/query')) {
        return await jsonResponse({
          type: 'FeatureCollection',
          properties: { exceededTransferLimit: false },
          features: [],
        });
      }

      expect(url).toContain('/17/query');
      expect(params.get('where')).toContain(code);
      return await jsonResponse({
        features: [
          {
            attributes: {
              NUMERO_PREDIAL: code,
              NUMERO_PREDIAL_ANTERIOR: '17013000100010001000',
              DIRECCION: 'CL 1 2 3',
              DESTINO_ECONOMICO: 'HABITACIONAL',
              AREA_TERRENO: 120.5,
              AREA_CONSTRUIDA: 85,
              DEPARTAMENTO: '17',
              MUNICIPIO: '013',
            },
          },
        ],
      });
    };

    const result = await fetchIgacCadastre(AGUADAS, { fetchImpl });
    expect(result.inColombia).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.parcels).toHaveLength(1);
    expect(result.parcels[0]).toMatchObject({
      code,
      previousCode: '17013000100010001000',
      municipalityCode: '17013',
      address: 'CL 1 2 3',
      economicDestination: 'HABITACIONAL',
      landAreaM2: 120.5,
      builtAreaM2: 85,
      zone: 'urban',
    });
    expect(result.evidence[0]).toMatchObject({
      accessProvider: 'ArcGIS Online del IGAC',
      crs: 'EPSG:4326',
      query: { method: 'POST', layers: '7,14,17' },
    });
    expect(result.parcels[0]?.geometry.type).toBe('Polygon');
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.payloadHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('marca el resultado como truncado cuando ArcGIS anuncia más registros', async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes('/17/query')) return await jsonResponse({ features: [] });
      return await jsonResponse({
        type: 'FeatureCollection',
        properties: { exceededTransferLimit: true },
        features: [],
      });
    };

    const result = await fetchIgacCadastre(AGUADAS, { fetchImpl });
    expect(result.truncated).toBe(true);
    expect(result.evidence[0]?.warnings).toContain(
      'La consulta catastral alcanzó el límite de seguridad; el resultado es parcial.',
    );
  });

  it('usa el dato fundamental nacional cuando la base del gestor IGAC no cubre el municipio', async () => {
    const code = '763640100000007640803800000008';
    const fetchImpl: FetchLike = async (url, init) => {
      if (url.includes('CATASTRO_PUBLICO_31082026')) {
        return await jsonResponse({
          type: 'FeatureCollection',
          properties: { exceededTransferLimit: false },
          features: [],
        });
      }
      if (url.includes('Dato_Fundamental_Catastro/MapServer/4/query')) {
        expect(form(init).has('resultRecordCount')).toBe(false);
        return await jsonResponse({
          type: 'FeatureCollection',
          properties: { exceededTransferLimit: false },
          features: [
            {
              type: 'Feature',
              properties: { CODIGO: code, CODIGO_ANT: '76364010007640008803' },
              geometry: {
                type: 'Polygon',
                coordinates: [
                  [
                    [-76.57003, 3.25445],
                    [-76.56951, 3.2541],
                    [-76.56986, 3.25368],
                    [-76.57003, 3.25445],
                  ],
                ],
              },
            },
          ],
        });
      }
      if (url.includes('Dato_Fundamental_Catastro/MapServer/1/query')) {
        return await jsonResponse({
          type: 'FeatureCollection',
          properties: { exceededTransferLimit: false },
          features: [],
        });
      }
      throw new Error(`Consulta inesperada: ${url}`);
    };

    const result = await fetchIgacCadastre(JAMUNDI, { fetchImpl });

    expect(result.parcels).toHaveLength(1);
    expect(result.parcels[0]).toMatchObject({
      code,
      previousCode: '76364010007640008803',
      municipalityCode: '76364',
      landAreaM2: null,
      zone: 'urban',
    });
    expect(result.evidence[0]).toMatchObject({
      sourceId: 'igac-dato-fundamental-catastro',
      coverage: 'national',
      query: { layers: '1,4' },
    });
  });
});
