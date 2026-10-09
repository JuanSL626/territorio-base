import { z } from 'zod';

import { mapSettled } from '../concurrency';
import { isGeometry, type Bounds2D, type Geometry } from '../geojson';
import { arcgisRings, areaHectares, intersects } from '../geometry';
import { postFormJson, type RequestOptions } from '../http';

import type { Aoi } from '../aoi';

export const COLOMBIA_BBOX: Bounds2D = [-79.1, -4.3, -66.8, 13.7];

export const DANE_DIVIPOLA_QUERY_URL =
  'https://geoportal.dane.gov.co/mparcgis/rest/services/Divipola/Serv_DIVIPOLA_MGN_2025/FeatureServer/317/query';
export const DANE_CNPV_QUERY_URL =
  'https://geoportal.dane.gov.co/mparcgis/rest/services/MARCO_INTEGRADO/Serv_DatosCNPV2018_Integrados_MGN2018/MapServer/800/query';
export const IGAC_CADASTRE_URL =
  'https://services2.arcgis.com/RVvWzU3lgJISqdke/arcgis/rest/services/CATASTRO_PUBLICO_31082026/FeatureServer';
export const IGAC_NATIONAL_CADASTRE_URL =
  'https://mapas.igac.gov.co/server/rest/services/Dato_Fundamental_Catastro/MapServer';
export const CALI_CADASTRE_WFS_URL = 'https://ws-idesc.cali.gov.co/geoserver/wfs';

const IGAC_FEATURE_BATCH = 500;
const IGAC_RECORD_BATCH = 100;
const CALI_FEATURE_BATCH = 1_000;
// ponytail: prefiltro urbano; la cobertura real se confirma sólo si IDESC devuelve terrenos.
const CALI_BBOX: Bounds2D = [-76.65, 3.28, -76.42, 3.58];

export const CALI_CONTEXT_LAYER_DEFS = [
  {
    layerId: 'idesc-constructions',
    typeName: 'catastro:cat_bas_construcciones',
    label: 'Construcciones catastrales',
  },
  {
    layerId: 'idesc-pot-activity',
    typeName: 'pot_2014:nur_areas_actividad',
    label: 'Áreas de actividad POT',
  },
  {
    layerId: 'idesc-seismic-microzonation',
    typeName: 'idesc:mc_microzonificacion_sismica',
    label: 'Microzonificación sísmica',
  },
] as const;

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
  idescLayers?: CaliContextLayer[];
};

export type CaliAttributeValue = string | number | boolean | null;

export type CaliContextFeature = {
  id: string;
  properties: Record<string, CaliAttributeValue>;
  geometry: Extract<Geometry, { type: 'Polygon' | 'MultiPolygon' }>;
};

export type CaliContextLayer = {
  layerId: (typeof CALI_CONTEXT_LAYER_DEFS)[number]['layerId'];
  label: string;
  count: number;
  features: CaliContextFeature[];
  truncated: boolean;
  error: string | null;
};

export type CaliContextResult = {
  inCali: boolean;
  layers: CaliContextLayer[];
  evidence: SourceEvidence | null;
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

const caliGeoJsonSchema = igacGeoJsonSchema.extend({
  numberMatched: z.union([z.number(), z.string()]),
  features: z
    .array(
      z.object({
        id: z.union([z.string(), z.number()]).optional(),
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
  address?: string | null;
  economicDestination?: string | null;
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

function boundsIntersect([minX, minY, maxX, maxY]: Bounds2D, bounds: Bounds2D): boolean {
  return !(maxX < bounds[0] || minX > bounds[2] || maxY < bounds[1] || minY > bounds[3]);
}

function caliAttributes(properties: Record<string, unknown>): Record<string, CaliAttributeValue> {
  const result: Record<string, CaliAttributeValue> = {};
  for (const [key, value] of Object.entries(properties)) {
    result[key] =
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
        ? value
        : JSON.stringify(value);
  }
  return result;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchCaliContextLayer(
  aoi: Aoi,
  definition: (typeof CALI_CONTEXT_LAYER_DEFS)[number],
  options: ColombiaRequestOptions,
): Promise<{ layer: CaliContextLayer; payloads: unknown[] }> {
  const payloads: unknown[] = [];
  const features = new Map<string, CaliContextFeature>();
  let startIndex = 0;
  let numberMatched = Number.POSITIVE_INFINITY;

  while (startIndex < numberMatched) {
    const payload = await postFormJson(
      CALI_CADASTRE_WFS_URL,
      {
        service: 'WFS',
        version: '2.0.0',
        request: 'GetFeature',
        typeNames: definition.typeName,
        srsName: 'EPSG:4326',
        bbox: `${aoi.bbox.join(',')},EPSG:4326`,
        outputFormat: 'application/json',
        count: String(CALI_FEATURE_BATCH),
        startIndex: String(startIndex),
      },
      options,
    );
    const parsed = caliGeoJsonSchema.safeParse(payload);
    if (!parsed.success) throw new Error(`${definition.label} devolvió una respuesta inválida.`);
    const matched = Number(parsed.data.numberMatched);
    if (!Number.isSafeInteger(matched) || matched < 0) {
      throw new Error(`${definition.label} devolvió un conteo inválido.`);
    }
    numberMatched = matched;
    payloads.push(payload);

    const page = parsed.data.features ?? [];
    page.forEach((item, index) => {
      const geometry: unknown = item.geometry;
      if (
        !isGeometry(geometry) ||
        (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') ||
        !intersects(aoi.geometry, geometry)
      ) {
        return;
      }
      const id = String(item.id ?? `${definition.typeName}.${String(startIndex + index)}`);
      features.set(id, {
        id,
        properties: caliAttributes(item.properties ?? {}),
        geometry,
      });
    });

    if (page.length === 0) break;
    startIndex += page.length;
  }

  return {
    layer: {
      layerId: definition.layerId,
      label: definition.label,
      count: features.size,
      features: [...features.values()],
      truncated: startIndex < numberMatched,
      error: null,
    },
    payloads,
  };
}

export async function fetchCaliContext(
  aoi: Aoi,
  options: ColombiaRequestOptions = {},
): Promise<CaliContextResult> {
  if (!boundsIntersect(aoi.bbox, CALI_BBOX)) return { inCali: false, layers: [], evidence: null };

  const settled = await mapSettled(
    CALI_CONTEXT_LAYER_DEFS,
    async (definition) => await fetchCaliContextLayer(aoi, definition, options),
    3,
  );
  const payloads: unknown[] = [];
  const layers: CaliContextLayer[] = settled.map((result, index) => {
    const definition = CALI_CONTEXT_LAYER_DEFS[index];
    if (definition === undefined) throw new Error('Catálogo IDESC fuera de rango.');
    if (result.ok) {
      payloads.push(...result.value.payloads);
      return result.value.layer;
    }
    return {
      layerId: definition.layerId,
      label: definition.label,
      count: 0,
      features: [],
      truncated: false,
      error: errorText(result.error),
    };
  });
  const warnings = layers.flatMap((layer) => [
    ...(layer.error === null ? [] : [`${layer.label}: ${layer.error}`]),
    ...(layer.truncated ? [`${layer.label}: el resultado es parcial.`] : []),
  ]);

  return {
    inCali: true,
    layers,
    evidence: {
      authority: 'Distrito de Santiago de Cali',
      accessProvider: 'Infraestructura de Datos Espaciales de Santiago de Cali (IDESC)',
      sourceId: 'cali-idesc-context',
      endpoint: CALI_CADASTRE_WFS_URL,
      sourceVersion: 'Catastro municipal, POT 2014 y microzonificación sísmica',
      queriedAt: queriedAt(options),
      sourceUpdatedAt: null,
      coverage: 'regional',
      license: null,
      crs: 'EPSG:4326',
      query: {
        method: 'POST',
        service: 'WFS 2.0.0',
        layers: CALI_CONTEXT_LAYER_DEFS.map((definition) => definition.typeName).join(','),
        pagination: 'startIndex',
        featureBatch: String(CALI_FEATURE_BATCH),
      },
      payloadHash: await sha256Json(payloads),
      warnings,
    },
  };
}

async function fetchCaliTerrain(
  aoi: Aoi,
  options: ColombiaRequestOptions,
): Promise<{
  payload: unknown[];
  features: TerrainFeature[];
  truncated: boolean;
  sourceUpdatedAt: string | null;
}> {
  const payloads: unknown[] = [];
  const unique = new Map<string, TerrainFeature>();
  let sourceUpdatedAt: string | null = null;
  let startIndex = 0;
  let numberMatched = Number.POSITIVE_INFINITY;

  while (startIndex < numberMatched) {
    const payload = await postFormJson(
      CALI_CADASTRE_WFS_URL,
      {
        service: 'WFS',
        version: '2.0.0',
        request: 'GetFeature',
        typeNames: 'catastro:cat_bas_terrenos',
        srsName: 'EPSG:4326',
        bbox: `${aoi.bbox.join(',')},EPSG:4326`,
        outputFormat: 'application/json',
        propertyName: 'npn,conexion,cminpred,direpred,last_edite,uso_princi,shape_area,the_geom',
        count: String(CALI_FEATURE_BATCH),
        startIndex: String(startIndex),
      },
      options,
    );
    const parsed = caliGeoJsonSchema.safeParse(payload);
    if (!parsed.success) throw new Error('Catastro de Cali devolvió una respuesta inválida.');
    const matched = Number(parsed.data.numberMatched);
    if (!Number.isSafeInteger(matched) || matched < 0) {
      throw new Error('Catastro de Cali devolvió un conteo inválido.');
    }
    numberMatched = matched;
    payloads.push(payload);

    const page = parsed.data.features ?? [];
    for (const feature of page) {
      const geometry: unknown = feature.geometry;
      const properties = feature.properties ?? {};
      const npn = stringProperty(properties, 'npn');
      if (
        npn === null ||
        !isGeometry(geometry) ||
        (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') ||
        !intersects(aoi.geometry, geometry)
      ) {
        continue;
      }

      const code = npn.length >= 21 ? npn.slice(0, 21) : npn;
      const terrainKey = stringProperty(properties, 'conexion') ?? code;
      // ponytail: una geometría por terreno; modelar sus unidades si el contrato admite 1:N.
      if (!unique.has(terrainKey)) {
        unique.set(terrainKey, {
          code,
          previousCode: null,
          municipalityCode: '76001',
          shapeAreaM2: numberProperty(properties, 'shape_area'),
          zone: 'urban',
          geometry,
          address: stringProperty(properties, 'cminpred') ?? stringProperty(properties, 'direpred'),
          economicDestination: stringProperty(properties, 'uso_princi'),
        });
      }

      const updatedAt = stringProperty(properties, 'last_edite')?.slice(0, 10) ?? null;
      if (updatedAt !== null && (sourceUpdatedAt === null || updatedAt > sourceUpdatedAt)) {
        sourceUpdatedAt = updatedAt;
      }
    }

    if (page.length === 0) break;
    startIndex += page.length;
  }

  return {
    payload: payloads,
    features: [...unique.values()],
    truncated: startIndex < numberMatched,
    sourceUpdatedAt,
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

  const inCali = boundsIntersect(aoi.bbox, CALI_BBOX);
  const caliPreferred = inCali ? await fetchCaliTerrain(aoi, options) : null;
  const useCaliDirect = (caliPreferred?.features.length ?? 0) > 0;
  const caliContext = useCaliDirect
    ? await fetchCaliContext(aoi, options)
    : { inCali: false, layers: [], evidence: null };
  const emptyTerrain = { payload: [], features: [] as TerrainFeature[], truncated: false };
  const [igacUrban, igacRural] = useCaliDirect
    ? [emptyTerrain, emptyTerrain]
    : await Promise.all([
        fetchTerrainLayer(aoi, 7, 'urban', options),
        fetchTerrainLayer(aoi, 14, 'rural', options),
      ]);
  const useNationalFallback =
    useCaliDirect || igacUrban.features.length + igacRural.features.length === 0;
  const [urban, rural] = useCaliDirect
    ? [emptyTerrain, emptyTerrain]
    : useNationalFallback
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
  const useCaliFallback =
    useCaliDirect ||
    (useNationalFallback && urban.features.length + rural.features.length === 0 && inCali);
  const cali = useCaliFallback ? (caliPreferred ?? (await fetchCaliTerrain(aoi, options))) : null;
  const allTerrain = cali?.features ?? [...urban.features, ...rural.features];
  const unique = new Map(allTerrain.map((feature) => [feature.code, feature]));
  const truncated = cali?.truncated ?? (urban.truncated || rural.truncated);
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
      address: record?.DIRECCION ?? feature.address ?? null,
      economicDestination: record?.DESTINO_ECONOMICO ?? feature.economicDestination ?? null,
      landAreaM2:
        record?.AREA_TERRENO ??
        feature.shapeAreaM2 ??
        areaHectares(feature.geometry, aoi.utmEpsg) * 10_000,
      builtAreaM2: record?.AREA_CONSTRUIDA ?? null,
      zone: feature.zone,
      geometry: feature.geometry,
    };
  });

  const warnings = [
    ...(useCaliFallback && terrain.length > 0
      ? [
          'Para el AOI en Cali se usó el catastro oficial de Santiago de Cali publicado por IDESC.',
          'Las unidades de propiedad horizontal se consolidaron por terreno para no duplicar la misma geometría.',
        ]
      : useNationalFallback && terrain.length > 0
        ? [
            'La Base Catastral Pública del Gestor IGAC no cubrió el AOI; se usó el Dato Fundamental Catastro del IGAC.',
            'El Dato Fundamental Catastro no publica dirección, destino económico ni área construida; el área del terreno se calcula desde su geometría.',
          ]
        : []),
    ...(truncated
      ? ['La fuente catastral no devolvió todos los predios solicitados; el resultado es parcial.']
      : []),
  ];
  const evidenceEndpoint = useCaliFallback
    ? CALI_CADASTRE_WFS_URL
    : useNationalFallback
      ? IGAC_NATIONAL_CADASTRE_URL
      : IGAC_CADASTRE_URL;

  return {
    inColombia: true,
    parcels,
    truncated,
    idescLayers: caliContext.layers,
    evidence: [
      {
        authority: useCaliFallback
          ? 'Distrito de Santiago de Cali — Catastro Municipal'
          : 'Instituto Geográfico Agustín Codazzi (IGAC)',
        accessProvider: useCaliFallback
          ? 'Infraestructura de Datos Espaciales de Santiago de Cali (IDESC)'
          : useNationalFallback
            ? 'Servidor de mapas IGAC (ArcGIS REST)'
            : 'ArcGIS Online del IGAC',
        sourceId: useCaliFallback
          ? 'cali-idesc-catastro'
          : useNationalFallback
            ? 'igac-dato-fundamental-catastro'
            : 'igac-base-catastral-publica-2026-08-31',
        endpoint: evidenceEndpoint,
        sourceVersion: useCaliFallback
          ? 'IDESC Catastro: Terrenos'
          : useNationalFallback
            ? 'Dato Fundamental Catastro; item modificado 2026-09-09'
            : 'Base Catastral Pública del Gestor IGAC 08-2026',
        queriedAt: queriedAt(options),
        sourceUpdatedAt: useCaliFallback
          ? (cali?.sourceUpdatedAt ?? null)
          : useNationalFallback
            ? '2026-09-09'
            : '2026-10-01',
        coverage: useCaliFallback ? 'regional' : useNationalFallback ? 'national' : 'partial',
        license: useNationalFallback ? null : 'CC BY 4.0',
        crs: 'EPSG:4326',
        query: useCaliFallback
          ? {
              method: 'POST',
              service: 'WFS 2.0.0',
              typeName: 'catastro:cat_bas_terrenos',
              pagination: 'startIndex',
              featureBatch: String(CALI_FEATURE_BATCH),
            }
          : {
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
          ...(cali === null ? [] : cali.payload),
          ...recordPayloads,
        ]),
        warnings,
      },
      ...(caliContext.evidence === null ? [] : [caliContext.evidence]),
    ],
  };
}
