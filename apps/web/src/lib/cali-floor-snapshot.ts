import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type {
  CaliContextFeature,
  CaliContextLayer,
  IgacCadastre,
  SourceEvidence,
} from '@territorio/geo';

const MAGIC = 'TBFLOOR1';
const SNAPSHOT_YEAR = 2024;
const HEADER_SIZE = 14;
const RECORD_SIZE = 13;
const SNAPSHOT_HASH = '7b28477affaf0885bf498066ec9d083f40884bd62727e5bcff99140413a8c0fa';
const SOURCE_URL = 'https://www.cali.gov.co/hacienda/publicaciones/147969/geoportal-catastral/';

let snapshotPromise: Promise<Uint8Array> | undefined;

type EnrichmentOptions = {
  snapshot?: Uint8Array;
  now?: Date;
};

type SnapshotIndex = {
  bytes: Uint8Array;
  view: DataView;
  year: number;
  count: number;
};

function parseSnapshot(bytes: Uint8Array): SnapshotIndex {
  if (bytes.byteLength < HEADER_SIZE) throw new Error('Snapshot de pisos de Cali incompleto.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = new TextDecoder().decode(bytes.subarray(0, 8));
  const year = view.getUint16(8);
  const count = view.getUint32(10);
  if (
    magic !== MAGIC ||
    year !== SNAPSHOT_YEAR ||
    bytes.byteLength !== HEADER_SIZE + count * RECORD_SIZE
  ) {
    throw new Error('Snapshot de pisos de Cali inválido.');
  }
  return { bytes, view, year, count };
}

async function loadSnapshot(): Promise<Uint8Array> {
  snapshotPromise ??= (async () => {
    const paths = [
      resolve(process.cwd(), 'public/datasets/cali-floors-2024.bin'),
      resolve(process.cwd(), 'dist/client/datasets/cali-floors-2024.bin'),
    ];
    let failure: unknown;
    for (const path of paths) {
      try {
        return await readFile(path);
      } catch (error) {
        failure = error;
      }
    }
    throw failure;
  })();
  return await snapshotPromise;
}

function recordKey(index: SnapshotIndex, position: number): bigint {
  return index.view.getBigUint64(HEADER_SIZE + position * RECORD_SIZE);
}

function lowerBound(index: SnapshotIndex, key: bigint): number {
  let low = 0;
  let high = index.count;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (recordKey(index, middle) < key) low = middle + 1;
    else high = middle;
  }
  return low;
}

function floorFromSnapshot(
  index: SnapshotIndex,
  terrainKey: bigint,
  areaM2: number,
): number | null {
  const tolerance = Math.max(0.05, areaM2 * 0.001);
  let position = lowerBound(index, terrainKey);
  let bestFloor: number | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  let ambiguous = false;

  while (position < index.count && recordKey(index, position) === terrainKey) {
    const offset = HEADER_SIZE + position * RECORD_SIZE;
    const candidateArea = index.view.getFloat32(offset + 8);
    const candidateFloor = index.view.getUint8(offset + 12);
    const delta = Math.abs(candidateArea - areaM2);
    if (delta <= tolerance) {
      if (delta + 0.001 < bestDelta) {
        bestDelta = delta;
        bestFloor = candidateFloor;
        ambiguous = false;
      } else if (Math.abs(delta - bestDelta) <= 0.001 && candidateFloor !== bestFloor) {
        ambiguous = true;
      }
    }
    position += 1;
  }

  return ambiguous ? null : bestFloor;
}

function terrainKey(properties: Record<string, string | number | boolean | null>): bigint | null {
  const npn = properties.npn;
  if (typeof npn !== 'string') return null;
  const value = npn.slice(7, 21);
  return /^\d{14}$/.test(value) ? BigInt(value) : null;
}

function constructionProperties(
  feature: CaliContextFeature,
  index: SnapshotIndex | null,
  queryYear: number,
): { properties: CaliContextFeature['properties']; recovered: boolean } {
  const liveFloors = feature.properties.npisos;
  const area = feature.properties.shape_area;
  const key = terrainKey(feature.properties);
  const fallback =
    index !== null &&
    (typeof liveFloors !== 'number' || liveFloors <= 0) &&
    typeof area === 'number' &&
    Number.isFinite(area) &&
    key !== null
      ? floorFromSnapshot(index, key, area)
      : null;

  if (fallback !== null) {
    return {
      properties: {
        ...feature.properties,
        npisos: fallback,
        npisos_servicio_idesc: liveFloors ?? null,
        data_source: 'IDESC — Geodatabase catastral',
        source_year: String(SNAPSHOT_YEAR),
      },
      recovered: true,
    };
  }

  return {
    properties: {
      ...feature.properties,
      data_source: 'IDESC — servicio catastral en línea',
      source_year: `Consulta ${String(queryYear)}; vigencia no publicada`,
    },
    recovered: false,
  };
}

function enrichLayer(
  layer: CaliContextLayer,
  index: SnapshotIndex | null,
  queryYear: number,
): { layer: CaliContextLayer; recovered: number } {
  let recovered = 0;
  const features = layer.features.map((feature) => {
    if (layer.layerId === 'idesc-constructions') {
      const result = constructionProperties(feature, index, queryYear);
      recovered += result.recovered ? 1 : 0;
      return { ...feature, properties: result.properties };
    }
    if (layer.layerId === 'idesc-pot-activity') {
      return {
        ...feature,
        properties: {
          ...feature.properties,
          data_source: 'IDESC — POT de Santiago de Cali',
          source_year: '2014',
        },
      };
    }
    return {
      ...feature,
      properties: {
        ...feature.properties,
        data_source: 'IDESC — Microzonificación sísmica',
        source_year: `Consulta ${String(queryYear)}; vigencia no publicada`,
      },
    };
  });
  return { layer: { ...layer, features }, recovered };
}

function snapshotEvidence(queriedAt: string, recovered: number): SourceEvidence {
  return {
    authority: 'Distrito de Santiago de Cali — Catastro Municipal',
    accessProvider: 'Geoportal Catastral de Santiago de Cali',
    sourceId: 'cali-idesc-construcciones-2024',
    endpoint: SOURCE_URL,
    sourceVersion: 'Geodatabase catastral con corte a enero de 2024',
    queriedAt,
    sourceUpdatedAt: '2024-01-20',
    coverage: 'regional',
    license: null,
    crs: 'EPSG:6249',
    query: {
      method: 'snapshot',
      match: 'terreno + área geométrica (tolerancia 0,1 %)',
      recoveredFeatures: String(recovered),
    },
    payloadHash: SNAPSHOT_HASH,
    warnings: [
      'El número de pisos 2024 sólo reemplaza ceros del servicio en línea cuando coinciden el terreno y el área geométrica; los demás valores no se estiman.',
    ],
  };
}

export async function enrichCaliContextSources(
  cadastre: IgacCadastre,
  options: EnrichmentOptions = {},
): Promise<IgacCadastre> {
  if (cadastre.idescLayers === undefined) return cadastre;

  let index: SnapshotIndex | null = null;
  try {
    index = parseSnapshot(options.snapshot ?? (await loadSnapshot()));
  } catch {
    index = null;
  }

  const now = options.now ?? new Date();
  const queryYear = now.getUTCFullYear();
  let recovered = 0;
  const idescLayers = cadastre.idescLayers.map((layer) => {
    const result = enrichLayer(layer, index, queryYear);
    recovered += result.recovered;
    return result.layer;
  });

  const queriedAt =
    cadastre.evidence.find((item) => item.sourceId === 'cali-idesc-context')?.queriedAt ??
    now.toISOString();
  return {
    ...cadastre,
    idescLayers,
    evidence: [
      ...cadastre.evidence,
      ...(recovered > 0 ? [snapshotEvidence(queriedAt, recovered)] : []),
    ],
  };
}
