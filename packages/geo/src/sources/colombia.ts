import { z } from 'zod';

import { createAoi, type Aoi } from '../aoi';
import { isGeometry, type Bounds2D, type Geometry } from '../geojson';
import { arcgisRings } from '../geometry';
import { postFormJson, type RequestOptions } from '../http';

export const COLOMBIA_BBOX: Bounds2D = [-79.1, -4.3, -66.8, 13.7];

export const DANE_DIVIPOLA_QUERY_URL =
  'https://geoportal.dane.gov.co/mparcgis/rest/services/Divipola/Serv_DIVIPOLA_MGN_2025/FeatureServer/317/query';
export const DANE_CNPV_QUERY_URL =
  'https://geoportal.dane.gov.co/mparcgis/rest/services/MARCO_INTEGRADO/Serv_DatosCNPV2018_Integrados_MGN2018/MapServer/800/query';
export const IGAC_CADASTRE_URL =
  'https://services2.arcgis.com/RVvWzU3lgJISqdke/arcgis/rest/services/CATASTRO_PUBLICO_31082026/FeatureServer';
export const IGAC_NATIONAL_CADASTRE_URL =
  'https://mapas.igac.gov.co/server/rest/services/Dato_Fundamental_Catastro/MapServer';

const IGAC_FEATURE_BATCH = 500;
const IGAC_RECORD_BATCH = 100;

export type SourceEvidence = {
  authority: string;
  accessProvider: string;
  sourceId: string;
  endpoint: string;
  sourceVersion: string;
  queriedAt: string;
  sourceUpdatedAt: string | null;
  coverage: 'national' | 'partial' | 'regional';
  license: string | null;
  crs: string;
  query: Record<string, string>;
  payloadHash: string;
  warnings: string[];
};

export type DaneCensus2018 = {
  population: number | null;
  households: number | null;
  dwellings: number | null;
  electricityAccessPct: number | null;
  aqueductAccessPct: number | null;
  sewerAccessPct: number | null;
  internetAccessPct: number | null;
};

export type DaneMunicipality = {
  code: string;
  municipalityCode: string;
  departmentCode: string;
  name: string;
  departmentName: string;
  kind: string | null;
  areaKm2: number | null;
  geographicVersion: number | null;
  census2018: DaneCensus2018 | null;
};

export type DaneContext = {
  inColombia: boolean;
  municipalities: DaneMunicipality[];
  evidence: SourceEvidence[];
};

export type IgacParcel = {
  code: string;
  previousCode: string | null;
  municipalityCode: string | null;
  address: string | null;
  economicDestination: string | null;
  landAreaM2: number | null;
  builtAreaM2: number | null;
  zone: 'urban' | 'rural';
  geometry: Geometry;
};

export type IgacCadastre = {
  inColombia: boolean;
  parcels: IgacParcel[];
  truncated: boolean;
  evidence: SourceEvidence[];
};

type ColombiaRequestOptions = RequestOptions & { now?: () => Date };

const errorSchema = z.looseObject({ message: z.string().optional() });
const arcgisResponseBase = z.looseObject({ error: errorSchema.optional() });

const daneMunicipalityAttributesSchema = z.object({
  DPTO_CCDGO: z.string(),
  MPIO_CCDGO: z.string(),
  MPIO_CDPMP: z.string(),
  MPIO_TIPO: z.string().nullable().optional(),
  MPIO_NAREA: z.number().nullable().optional(),
  MPIO_NANO: z.number().nullable().optional(),
  DPTO_CNMBRE: z.string(),
  MPIO_CNMBRE: z.string(),
});

const daneMunicipalityResponseSchema = arcgisResponseBase.extend({
  features: z
    .array(z.object({ attributes: daneMunicipalityAttributesSchema }))
    .nullable()
    .optional(),
});

const nullableNumber = z.number().nullable().optional();
const daneCensusAttributesSchema = z.object({
  MPIO_CDPMP: z.string(),
  STVIVIENDA: nullableNumber,
  TSP16_HOG: nullableNumber,
  STP27_PERS: nullableNumber,
  STP19_EC_1: nullableNumber,
  STP19_ES_2: nullableNumber,
  STP19_ACU1: nullableNumber,
  STP19_ACU2: nullableNumber,
  STP19_ALC1: nullableNumber,
  STP19_ALC2: nullableNumber,
  STP19_INT1: nullableNumber,
  STP19_INT2: nullableNumber,
  STP19_INT9: nullableNumber,
});

const daneCensusResponseSchema = arcgisResponseBase.extend({
  features: z
    .array(z.object({ attributes: daneCensusAttributesSchema }))
    .nullable()
    .optional(),
});

const igacGeoJsonSchema = z.object({
  properties: z.object({ exceededTransferLimit: z.boolean().optional() }).nullable().optional(),
  features: z
    .array(
      z.object({
        properties: z.record(z.string(), z.unknown()).nullable().optional(),
        geometry: z.unknown().nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
});

const igacObjectIdsSchema = arcgisResponseBase.extend({
  objectIds: z.array(z.number()).nullable().optional(),
});

const igacRecordAttributesSchema = z.object({
  NUMERO_PREDIAL: z.string(),
  NUMERO_PREDIAL_ANTERIOR: z.string().nullable().optional(),
  DIRECCION: z.string().nullable().optional(),
  DESTINO_ECONOMICO: z.string().nullable().optional(),
  AREA_TERRENO: nullableNumber,
  AREA_CONSTRUIDA: nullableNumber,
});

const igacRecordResponseSchema = arcgisResponseBase.extend({
  features: z
    .array(z.object({ attributes: igacRecordAttributesSchema }))
    .nullable()
    .optional(),
});

export function isInColombia(bbox: Bounds2D): boolean {
  const [minX, minY, maxX, maxY] = bbox;
  const [bx0, by0, bx1, by1] = COLOMBIA_BBOX;
  return !(maxX < bx0 || minX > bx1 || maxY < by0 || minY > by1);
}

function arcgisGeometry(aoi: Aoi): string {
  return JSON.stringify({
    rings: arcgisRings(aoi.geometry),
    spatialReference: { wkid: 4326 },
  });
}

function assertArcgisResponse(payload: unknown, label: string): void {
  const parsed = arcgisResponseBase.safeParse(payload);
  if (!parsed.success) throw new Error(`${label} devolvió una respuesta inválida.`);
  if (parsed.data.error !== undefined) {
    throw new Error(parsed.data.error.message ?? `${label} rechazó la consulta.`);
  }
}

async function sha256Json(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function queriedAt(options: ColombiaRequestOptions): string {
  return (options.now?.() ?? new Date()).toISOString();
}

function percentage(yes: number | null | undefined, no: number | null | undefined): number | null {
  if (yes == null || no == null) return null;
  const total = yes + no;
  return total <= 0 ? null : (yes / total) * 100;
}

function censusOf(
  attributes: z.infer<typeof daneCensusAttributesSchema> | undefined,
): DaneCensus2018 | null {
  if (attributes === undefined) return null;
  return {
    population: attributes.STP27_PERS ?? null,
    households: attributes.TSP16_HOG ?? null,
    dwellings: attributes.STVIVIENDA ?? null,
    electricityAccessPct: percentage(attributes.STP19_EC_1, attributes.STP19_ES_2),
    aqueductAccessPct: percentage(attributes.STP19_ACU1, attributes.STP19_ACU2),
    sewerAccessPct: percentage(attributes.STP19_ALC1, attributes.STP19_ALC2),
    internetAccessPct: percentage(attributes.STP19_INT1, attributes.STP19_INT2),
  };
}

export async function fetchDaneContext(
  aoi: Aoi,
  options: ColombiaRequestOptions = {},
): Promise<DaneContext> {
  if (!isInColombia(aoi.bbox)) return { inColombia: false, municipalities: [], evidence: [] };

  const municipalityPayload = await postFormJson(
    DANE_DIVIPOLA_QUERY_URL,
    {
      geometry: arcgisGeometry(aoi),
      geometryType: 'esriGeometryPolygon',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields:
        'DPTO_CCDGO,MPIO_CCDGO,MPIO_CDPMP,MPIO_TIPO,MPIO_NAREA,MPIO_NANO,DPTO_CNMBRE,MPIO_CNMBRE',
      returnGeometry: 'false',
      f: 'json',
    },
    options,
  );
  assertArcgisResponse(municipalityPayload, 'DANE DIVIPOLA');
  const municipalityParsed = daneMunicipalityResponseSchema.safeParse(municipalityPayload);
  if (!municipalityParsed.success) throw new Error('DANE DIVIPOLA devolvió municipios inválidos.');

  const unique = new Map<string, z.infer<typeof daneMunicipalityAttributesSchema>>();
  for (const feature of municipalityParsed.data.features ?? []) {
    unique.set(feature.attributes.MPIO_CDPMP, feature.attributes);
  }
  const territorial = [...unique.values()].sort((a, b) => a.MPIO_CDPMP.localeCompare(b.MPIO_CDPMP));

  const censusPayloads = await Promise.all(
    territorial.map(async (municipality) => {
      try {
        const payload = await postFormJson(
          DANE_CNPV_QUERY_URL,
          {
            where: `MPIO_CDPMP = '${municipality.MPIO_CDPMP}'`,
            outFields:
              'MPIO_CDPMP,STVIVIENDA,TSP16_HOG,STP27_PERS,STP19_EC_1,STP19_ES_2,STP19_ACU1,STP19_ACU2,STP19_ALC1,STP19_ALC2,STP19_INT1,STP19_INT2,STP19_INT9',
            returnGeometry: 'false',
            resultRecordCount: '1',
            f: 'json',
          },
          options,
        );
        assertArcgisResponse(payload, 'DANE CNPV 2018');
        const parsed = daneCensusResponseSchema.safeParse(payload);
        if (!parsed.success) throw new Error('DANE CNPV 2018 devolvió indicadores inválidos.');
        return {
          code: municipality.MPIO_CDPMP,
          payload,
          attributes: parsed.data.features?.[0]?.attributes,
          error: null,
        };
      } catch (error) {
        return {
          code: municipality.MPIO_CDPMP,
          payload: null,
          attributes: undefined,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  const censusByCode = new Map(censusPayloads.map((entry) => [entry.code, entry.attributes]));

  const municipalities: DaneMunicipality[] = territorial.map((attributes) => ({
    code: attributes.MPIO_CDPMP,
    municipalityCode: attributes.MPIO_CCDGO,
    departmentCode: attributes.DPTO_CCDGO,
    name: attributes.MPIO_CNMBRE,
    departmentName: attributes.DPTO_CNMBRE,
    kind: attributes.MPIO_TIPO ?? null,
    areaKm2: attributes.MPIO_NAREA ?? null,
    geographicVersion: attributes.MPIO_NANO ?? null,
    census2018: censusOf(censusByCode.get(attributes.MPIO_CDPMP)),
  }));

  const censusWarnings = censusPayloads.flatMap((entry) =>
    entry.error === null
      ? entry.attributes === undefined
        ? [`CNPV 2018 no devolvió datos para ${entry.code}.`]
        : []
      : [`CNPV 2018 falló para ${entry.code}: ${entry.error}`],
  );
  const at = queriedAt(options);

  return {
    inColombia: true,
    municipalities,
    evidence: [
      {
        authority: 'Departamento Administrativo Nacional de Estadística (DANE)',
        accessProvider: 'Geoportal DANE (ArcGIS REST)',
        sourceId: 'dane-divipola-mgn-2025',
        endpoint: DANE_DIVIPOLA_QUERY_URL,
        sourceVersion: 'MGN 2025',
        queriedAt: at,
        sourceUpdatedAt: '2025-01-01',
        coverage: 'national',
        license: null,
        crs: 'EPSG:4326',
        query: {
          method: 'POST',
          geometryType: 'esriGeometryPolygon',
          spatialRelationship: 'esriSpatialRelIntersects',
          returnGeometry: 'false',
        },
        payloadHash: await sha256Json(municipalityPayload),
        warnings: territorial.length === 0 ? ['DIVIPOLA no encontró municipios para el AOI.'] : [],
      },
      {
        authority: 'Departamento Administrativo Nacional de Estadística (DANE)',
        accessProvider: 'Geoportal DANE (ArcGIS REST)',
        sourceId: 'dane-cnpv-2018',
        endpoint: DANE_CNPV_QUERY_URL,
        sourceVersion: 'CNPV 2018 integrado con MGN 2018',
        queriedAt: at,
        sourceUpdatedAt: '2018-01-01',
        coverage: 'national',
        license: null,
        crs: 'EPSG:4326',
        query: {
          method: 'POST',
          municipalityCodes: territorial.map((item) => item.MPIO_CDPMP).join(','),
          returnGeometry: 'false',
        },
        payloadHash: await sha256Json(censusPayloads.map((entry) => entry.payload)),
        warnings: censusWarnings,
      },
    ],
  };
}

type TerrainFeature = {
  code: string;
  previousCode: string | null;
  municipalityCode: string | null;
  shapeAreaM2: number | null;
  zone: 'urban' | 'rural';
  geometry: Extract<Geometry, { type: 'Polygon' | 'MultiPolygon' }>;
};

function stringProperty(properties: Record<string, unknown>, key: string): string | null {
  const value = properties[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function numberProperty(properties: Record<string, unknown>, key: string): number | null {
  const value = properties[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function fetchTerrainLayer(
  aoi: Aoi,
  layerId: number,
  zone: 'urban' | 'rural',
  options: ColombiaRequestOptions,
  source: {
    url: string;
    outFields: string;
    previousCodeField: string;
    municipalityCodeField: string | null;
    shapeAreaField: string | null;
  } = {
    url: IGAC_CADASTRE_URL,
    outFields: 'CODIGO,CODIGO_ANTERIOR,codigo_municipio,Shape__Area',
    previousCodeField: 'CODIGO_ANTERIOR',
    municipalityCodeField: 'codigo_municipio',
    shapeAreaField: 'Shape__Area',
  },
): Promise<{ payload: unknown; features: TerrainFeature[]; truncated: boolean }> {
  const queryUrl = `${source.url}/${String(layerId)}/query`;
  const idsPayload = await postFormJson(
    queryUrl,
    {
      geometry: arcgisGeometry(aoi),
      geometryType: 'esriGeometryPolygon',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      returnIdsOnly: 'true',
      f: 'json',
    },
    options,
  );
  assertArcgisResponse(idsPayload, `IGAC ${zone}`);
  const parsedIds = igacObjectIdsSchema.safeParse(idsPayload);
  if (!parsedIds.success) throw new Error(`IGAC ${zone} devolvió identificadores inválidos.`);

  const objectIds = parsedIds.data.objectIds ?? [];
  const payloads: unknown[] = [idsPayload];
  const features: TerrainFeature[] = [];
  let returnedCount = 0;
  let truncated = false;
  for (const page of batches(objectIds, IGAC_FEATURE_BATCH)) {
    const payload = await postFormJson(
      queryUrl,
      {
        objectIds: page.join(','),
        outFields: source.outFields,
        returnGeometry: 'true',
        outSR: '4326',
        f: 'geojson',
      },
      options,
    );
    assertArcgisResponse(payload, `IGAC ${zone}`);
    const parsed = igacGeoJsonSchema.safeParse(payload);
    if (!parsed.success) throw new Error(`IGAC ${zone} devolvió una respuesta inválida.`);
    payloads.push(payload);
    returnedCount += parsed.data.features?.length ?? 0;
    truncated ||= parsed.data.properties?.exceededTransferLimit === true;

    for (const feature of parsed.data.features ?? []) {
      const geometry: unknown = feature.geometry;
      const properties = feature.properties ?? {};
      const code = stringProperty(properties, 'CODIGO');
      if (
        code === null ||
        !isGeometry(geometry) ||
        (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')
      ) {
        continue;
      }
      features.push({
        code,
        previousCode: stringProperty(properties, source.previousCodeField),
        municipalityCode:
          source.municipalityCodeField === null
            ? code.length >= 5
              ? code.slice(0, 5)
              : null
            : stringProperty(properties, source.municipalityCodeField),
        shapeAreaM2:
          source.shapeAreaField === null ? null : numberProperty(properties, source.shapeAreaField),
        zone,
        geometry,
      });
    }
  }

  return {
    payload: payloads,
    features,
    truncated: truncated || returnedCount < objectIds.length,
  };
}

function batches<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function fetchRecords(
  codes: readonly string[],
  options: ColombiaRequestOptions,
): Promise<{
  payloads: unknown[];
  records: Map<string, z.infer<typeof igacRecordAttributesSchema>>;
}> {
  const payloads = await Promise.all(
    batches(codes, IGAC_RECORD_BATCH).map(async (batch) => {
      const values = batch.map((code) => `'${code.replaceAll("'", "''")}'`).join(',');
      return await postFormJson(
        `${IGAC_CADASTRE_URL}/17/query`,
        {
          where: `NUMERO_PREDIAL IN (${values})`,
          outFields:
            'NUMERO_PREDIAL,NUMERO_PREDIAL_ANTERIOR,DIRECCION,DESTINO_ECONOMICO,AREA_TERRENO,AREA_CONSTRUIDA',
          returnGeometry: 'false',
          f: 'json',
        },
        options,
      );
    }),
  );

  const records = new Map<string, z.infer<typeof igacRecordAttributesSchema>>();
  for (const payload of payloads) {
    assertArcgisResponse(payload, 'IGAC Registro 1');
    const parsed = igacRecordResponseSchema.safeParse(payload);
    if (!parsed.success) throw new Error('IGAC Registro 1 devolvió atributos inválidos.');
    for (const feature of parsed.data.features ?? []) {
      records.set(feature.attributes.NUMERO_PREDIAL, feature.attributes);
    }
  }
  return { payloads, records };
}

export async function fetchIgacCadastre(
  aoi: Aoi,
  options: ColombiaRequestOptions = {},
): Promise<IgacCadastre> {
  if (!isInColombia(aoi.bbox)) {
    return { inColombia: false, parcels: [], truncated: false, evidence: [] };
  }

  const [igacUrban, igacRural] = await Promise.all([
    fetchTerrainLayer(aoi, 7, 'urban', options),
    fetchTerrainLayer(aoi, 14, 'rural', options),
  ]);
  const useNationalFallback = igacUrban.features.length + igacRural.features.length === 0;
  const [urban, rural] = useNationalFallback
    ? await Promise.all([
        fetchTerrainLayer(aoi, 4, 'urban', options, {
          url: IGAC_NATIONAL_CADASTRE_URL,
          outFields: 'CODIGO,CODIGO_ANT',
          previousCodeField: 'CODIGO_ANT',
          municipalityCodeField: null,
          shapeAreaField: null,
        }),
        fetchTerrainLayer(aoi, 1, 'rural', options, {
          url: IGAC_NATIONAL_CADASTRE_URL,
          outFields: 'CODIGO,CODIGO_ANT',
          previousCodeField: 'CODIGO_ANT',
          municipalityCodeField: null,
          shapeAreaField: null,
        }),
      ])
    : [igacUrban, igacRural];
  const allTerrain = [...urban.features, ...rural.features];
  const unique = new Map(allTerrain.map((feature) => [feature.code, feature]));
  const truncated = urban.truncated || rural.truncated;
  const terrain = [...unique.values()];
  const { payloads: recordPayloads, records } =
    terrain.length === 0 || useNationalFallback
      ? { payloads: [], records: new Map<string, z.infer<typeof igacRecordAttributesSchema>>() }
      : await fetchRecords(
          terrain.map((feature) => feature.code),
          options,
        );

  const parcels: IgacParcel[] = terrain.map((feature) => {
    const record = records.get(feature.code);
    return {
      code: feature.code,
      previousCode: record?.NUMERO_PREDIAL_ANTERIOR ?? feature.previousCode,
      municipalityCode: feature.municipalityCode,
      address: record?.DIRECCION ?? null,
      economicDestination: record?.DESTINO_ECONOMICO ?? null,
      landAreaM2:
        record?.AREA_TERRENO ?? feature.shapeAreaM2 ?? createAoi(feature.geometry).areaHa * 10_000,
      builtAreaM2: record?.AREA_CONSTRUIDA ?? null,
      zone: feature.zone,
      geometry: feature.geometry,
    };
  });

  const warnings = [
    ...(useNationalFallback && terrain.length > 0
      ? [
          'La Base Catastral Pública del Gestor IGAC no cubrió el AOI; se usó el Dato Fundamental Catastro del IGAC.',
          'El Dato Fundamental Catastro no publica dirección, destino económico ni área construida; el área del terreno se calcula desde su geometría.',
        ]
      : []),
    ...(truncated
      ? ['ArcGIS no devolvió todos los predios solicitados; el resultado es parcial.']
      : []),
  ];
  const evidenceEndpoint = useNationalFallback ? IGAC_NATIONAL_CADASTRE_URL : IGAC_CADASTRE_URL;

  return {
    inColombia: true,
    parcels,
    truncated,
    evidence: [
      {
        authority: 'Instituto Geográfico Agustín Codazzi (IGAC)',
        accessProvider: useNationalFallback
          ? 'Servidor de mapas IGAC (ArcGIS REST)'
          : 'ArcGIS Online del IGAC',
        sourceId: useNationalFallback
          ? 'igac-dato-fundamental-catastro'
          : 'igac-base-catastral-publica-2026-08-31',
        endpoint: evidenceEndpoint,
        sourceVersion: useNationalFallback
          ? 'Dato Fundamental Catastro; item modificado 2026-09-09'
          : 'Base Catastral Pública del Gestor IGAC 08-2026',
        queriedAt: queriedAt(options),
        sourceUpdatedAt: useNationalFallback ? '2026-09-09' : '2026-10-01',
        coverage: useNationalFallback ? 'national' : 'partial',
        license: useNationalFallback ? null : 'CC BY 4.0',
        crs: 'EPSG:4326',
        query: {
          method: 'POST',
          layers: useNationalFallback ? '1,4' : '7,14,17',
          geometryType: 'esriGeometryPolygon',
          spatialRelationship: 'esriSpatialRelIntersects',
          pagination: 'objectIds',
          featureBatch: String(IGAC_FEATURE_BATCH),
        },
        payloadHash: await sha256Json([
          igacUrban.payload,
          igacRural.payload,
          ...(useNationalFallback ? [urban.payload, rural.payload] : []),
          ...recordPayloads,
        ]),
        warnings,
      },
    ],
  };
}
