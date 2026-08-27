/**
 * Tabla de fuentes y citas — el insumo del `LEEME.txt` que viaja **dentro** del
 * ZIP (design brief §7.2: "el texto de licencia viaja adentro del bundle,
 * siempre").
 *
 * Los datos salen del inventario §5, incluidos los caveats: son la parte que
 * evita que alguien lea un resultado de screening como un estudio de detalle.
 */

export type DatasetCitation = {
  id: string;
  /** Cómo se llama la capa en la UI. */
  layer: string;
  /** Nombre oficial del dataset. */
  officialName: string;
  provider: string;
  endpoint: string;
  resolution: string;
  license: string;
  caveats?: string;
};

export const DATASET_CITATIONS: readonly DatasetCitation[] = [
  {
    id: 'dem',
    layer: 'Elevación (DEM)',
    officialName: 'Copernicus DEM GLO-30',
    provider: 'ESA, vía Microsoft Planetary Computer',
    endpoint: 'https://planetarycomputer.microsoft.com/api/stac/v1 — colección cop-dem-glo-30',
    resolution: '30 m',
    license: 'Abierto, sin registro',
  },
  {
    id: 'ndvi',
    layer: 'NDVI (continuo) y clases de densidad de vegetación',
    officialName: 'Sentinel-2 L2A',
    provider: 'ESA Copernicus, vía Microsoft Planetary Computer',
    endpoint: 'https://planetarycomputer.microsoft.com/api/stac/v1 — colección sentinel-2-l2a',
    resolution: '10 m',
    license: 'Abierto, sin registro',
    caveats:
      'Mediana de las escenas menos nubladas de los últimos 180 días; filtro eo:cloud_cover < 30; ' +
      'top 6 escenas; máscara SCL {4,5,6,7,11}. Puede fallar en zonas persistentemente nubladas.',
  },
  {
    id: 'worldcover',
    layer: 'Cobertura de suelo (WorldCover)',
    officialName: 'ESA WorldCover 2021',
    provider: 'ESA, vía Microsoft Planetary Computer',
    endpoint: 'https://planetarycomputer.microsoft.com/api/stac/v1 — colección esa-worldcover',
    resolution: '10 m',
    license: 'Abierto, sin registro',
  },
  {
    id: 'hidrologia',
    layer: 'Hidrología (OSM)',
    officialName: 'OpenStreetMap — waterway, natural=water, natural=wetland',
    provider: 'Comunidad OpenStreetMap, vía Overpass API',
    endpoint:
      'Mirrors en orden: overpass-api.de, z.overpass-api.de, lz4.overpass-api.de, ' +
      'overpass.kumi.systems, overpass.private.coffee',
    resolution: 'Vectorial (colaborativo, densidad variable)',
    license: 'Open Database License (ODbL) — © colaboradores de OpenStreetMap',
    caveats:
      'Que no aparezca un curso de agua NO prueba que no exista: OSM es un mapa colaborativo con ' +
      'cobertura desigual. Cruzar con INDRHI / Ministerio de Medio Ambiente si el proyecto lo amerita.',
  },
  {
    id: 'wdpa',
    layer: 'Áreas protegidas (WDPA)',
    officialName: 'World Database on Protected Areas (WDPA)',
    provider: 'UNEP-WCMC (misma base que Protected Planet)',
    endpoint:
      'https://data-gis.unep-wcmc.org/arcgis/rest/services/ProtectedSites/' +
      'The_World_Database_of_Protected_Areas/FeatureServer/1/query',
    resolution: 'Vectorial',
    license: 'Abierto, sin token. Citar a UNEP-WCMC como fuente.',
  },
  {
    id: 'aqueduct',
    layer: 'Inundación costera',
    officialName: 'WRI Aqueduct Floods v2 (Ward et al., 2020)',
    provider: 'World Resources Institute',
    endpoint: 'https://aqueduct.wridata.org/AqueductFloods20/',
    resolution: '~927 m (30 arcsec)',
    license: 'CC-BY',
    caveats:
      'Herramienta de screening, no estudio de detalle. Proyecciones solo hasta 2080; metodología ' +
      '2020 basada en escenarios RCP.',
  },
  {
    id: 'mepyd',
    layer: 'Contexto RD (MEPyD)',
    officialName: 'Sistema de Información para la GRD y la AC',
    provider: 'Ministerio de Economía, Planificación y Desarrollo (MEPyD), República Dominicana',
    endpoint:
      'https://services3.arcgis.com/DYnzeQNyuMo2mJ1o/arcgis/rest/services (~35 FeatureServers)',
    resolution: 'Vectorial',
    license: 'Abierto, sin token',
    caveats:
      'Solo se consulta si el AOI intersecta República Dominicana. Una capa cuyo servicio no ' +
      'responde se omite del resultado: la ausencia de una capa en este ZIP no significa ausencia ' +
      'de datos en el territorio.',
  },
];

export type ReadmeOptions = {
  /** Nombre legible del AOI (el mismo que da nombre al ZIP). */
  aoiName: string;
  areaHa: number;
  utmEpsg: number;
  bbox: readonly [number, number, number, number];
  /** EPSG en el que se escribieron los vectores. */
  outputEpsg: number;
  generatedAt: Date;
  engineVersion: string;
  /** Parámetros efectivos del análisis, en orden de presentación. */
  parameters?: readonly { label: string; value: string }[];
  /** Solo las fuentes efectivamente incluidas en este bundle. */
  datasetIds?: readonly string[];
  /** Capas que se pidieron y no se pudieron generar, con el motivo. */
  omissions?: readonly { label: string; reason: string }[];
};

function formatNumber(value: number, decimals: number): string {
  return value.toLocaleString('es-DO', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Texto completo del `LEEME.txt`. En español, como toda la copy del producto. */
export function buildReadme(options: ReadmeOptions): string {
  const citations =
    options.datasetIds === undefined
      ? DATASET_CITATIONS
      : DATASET_CITATIONS.filter((c) => options.datasetIds?.includes(c.id) === true);

  const lines: string[] = [
    'TERRITORIO BASE — DESCARGA DE DATOS',
    '===================================',
    '',
    `Zona de estudio : ${options.aoiName}`,
    `Superficie      : ${formatNumber(options.areaHa, 1)} ha`,
    `Bbox (WGS84)    : ${options.bbox.map((v) => formatNumber(v, 5)).join(', ')}`,
    `CRS de salida   : EPSG:${options.outputEpsg}`,
    `UTM local       : EPSG:${options.utmEpsg}`,
    `Generado        : ${options.generatedAt.toISOString()}`,
    `Versión motor   : ${options.engineVersion}`,
    '',
  ];

  if (options.parameters !== undefined && options.parameters.length > 0) {
    lines.push('PARÁMETROS DEL ANÁLISIS', '-----------------------');
    for (const parameter of options.parameters) {
      lines.push(`- ${parameter.label}: ${parameter.value}`);
    }
    lines.push('');
  }

  lines.push('FUENTES Y LICENCIAS', '-------------------', '');
  for (const citation of citations) {
    lines.push(
      citation.layer,
      `  Dataset    : ${citation.officialName}`,
      `  Proveedor  : ${citation.provider}`,
      `  Endpoint   : ${citation.endpoint}`,
      `  Resolución : ${citation.resolution}`,
      `  Licencia   : ${citation.license}`,
    );
    if (citation.caveats !== undefined) lines.push(`  Advertencia: ${citation.caveats}`);
    lines.push('');
  }

  if (options.omissions !== undefined && options.omissions.length > 0) {
    lines.push(
      'CAPAS NO INCLUIDAS',
      '------------------',
      'Se pidieron y no se pudieron generar. Su ausencia acá NO significa ausencia de datos',
      'en el territorio.',
      '',
    );
    for (const omission of options.omissions) {
      lines.push(`- ${omission.label}: ${omission.reason}`);
    }
    lines.push('');
  }

  lines.push(
    'SOBRE LOS NOMBRES DE COLUMNA',
    '----------------------------',
    'El formato DBF (el .dbf de cada shapefile) limita los nombres de campo a 10 caracteres.',
    'Los nombres largos se acortan y se desambiguan automáticamente. La correspondencia',
    'completa entre el nombre corto y el nombre original está en `campos_shapefile.csv`,',
    'dentro de la carpeta `vector/`. Los `.geojson` conservan los nombres completos.',
    '',
    'ALCANCE',
    '-------',
    'Este material es un análisis territorial preliminar de gabinete. No reemplaza',
    'levantamientos de campo, estudios de detalle ni consultas a los organismos competentes.',
    '',
  );

  return lines.join('\n');
}
