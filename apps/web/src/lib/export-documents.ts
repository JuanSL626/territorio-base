/**
 * Los documentos de texto del bundle: `FUENTES.txt`, `LEEME.txt`, `reporte.md`
 * y `resumen.csv`.
 *
 * Puro y sin efectos: recibe el análisis y devuelve strings. Se testea sin
 * abrir un ZIP y sin levantar un servidor.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ `FUENTES.txt` ES OBLIGATORIO
 * ─────────────────────────────────────────────────────────────────────────────
 * El pedido es explícito: el entregable tiene que decir DE DÓNDE salió cada
 * dato. Un GeoTIFF suelto en la carpeta de descargas de alguien, seis meses
 * después, no tiene proveedor, ni resolución, ni licencia, ni fecha de
 * consulta — y en ese estado no sirve para una decisión territorial ni se puede
 * citar en un informe. Por eso el manifiesto de fuentes viaja ADENTRO del ZIP,
 * no en una pantalla, no en un pie de página, y no se puede destildar.
 *
 * Y por eso también lista lo que NO está: una capa que falló figura en
 * `FUENTES.txt` y en `LEEME.txt` con su motivo. La ausencia silenciosa de una
 * capa es indistinguible de "no hay nada ahí", que es la regresión #3 del
 * inventario trasladada al archivo entregado.
 */
import { DATASET_CITATIONS, type DatasetCitation } from '@territorio/geo/export/sources';

import {
  REPORT_SECTION_LABELS,
  type ExportOmission,
  type ReportSectionId,
} from './export-contract';
import { formatHectares, formatNumber, formatPercent } from './format';

import type { TerritorioAnalysis } from './analysis-contract';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function rule(char: string, length: number): string {
  return char.repeat(length);
}

/* -------------------------------------------------------------------------- */
/* FUENTES.txt                                                                 */
/* -------------------------------------------------------------------------- */

export type SourcesManifestOptions = {
  aoiName: string;
  generatedAt: Date;
  /** Ids de `DATASET_CITATIONS` efectivamente incluidos en el bundle. */
  datasetIds: readonly string[];
  /** Capas pedidas y no incluidas, con el motivo. */
  omissions: readonly ExportOmission[];
  /** Parámetros efectivos de la corrida (ventana S2, nubosidad, resolución). */
  parameters: readonly { label: string; value: string }[];
  engineVersion: string;
};

/**
 * El manifiesto de fuentes. Una ficha por dataset con **nombre oficial,
 * proveedor, endpoint, resolución, licencia, fecha de consulta y advertencias**
 * — las siete columnas del inventario §5, ninguna opcional.
 */
export function buildSourcesManifest(options: SourcesManifestOptions): string {
  const included: DatasetCitation[] = DATASET_CITATIONS.filter((citation) =>
    options.datasetIds.includes(citation.id),
  );

  const lines: string[] = [
    'TERRITORIO BASE — FUENTES Y CITACIÓN',
    rule('=', 60),
    '',
    `Zona de estudio  : ${options.aoiName}`,
    `Fecha de consulta: ${isoDay(options.generatedAt)}`,
    `Versión del motor: ${options.engineVersion}`,
    '',
    'Cada capa de este ZIP proviene de una de las fuentes de abajo. La fecha de',
    'consulta es la misma para todas: es el momento en que corrió el análisis.',
    'Los servicios en vivo (OpenStreetMap, WDPA, MEPyD) pueden haber cambiado',
    'desde entonces; los datasets satelitales no.',
    '',
  ];

  if (options.parameters.length > 0) {
    lines.push('PARÁMETROS DE LA CORRIDA', rule('-', 60));
    for (const parameter of options.parameters) {
      lines.push(`  ${parameter.label}: ${parameter.value}`);
    }
    lines.push('');
  }

  lines.push('FUENTES INCLUIDAS', rule('-', 60), '');

  if (included.length === 0) {
    lines.push('  (ninguna capa de datos entró a este bundle)', '');
  }

  for (const citation of included) {
    lines.push(
      citation.layer,
      `  Nombre oficial   : ${citation.officialName}`,
      `  Proveedor        : ${citation.provider}`,
      `  Endpoint         : ${citation.endpoint}`,
      `  Resolución       : ${citation.resolution}`,
      `  Licencia         : ${citation.license}`,
      `  Fecha de consulta: ${isoDay(options.generatedAt)}`,
    );
    if (citation.caveats !== undefined) {
      lines.push(`  Advertencias     : ${citation.caveats}`);
    }
    lines.push('');
  }

  if (options.omissions.length > 0) {
    lines.push(
      'CAPAS QUE NO ESTÁN EN ESTE ZIP',
      rule('-', 60),
      'Se ofrecían o se pidieron y no se pudieron generar. Su ausencia acá NO',
      'significa ausencia de datos en el territorio: significa que el servicio no',
      'respondió, que el AOI queda fuera de su cobertura, o que la consulta no',
      'devolvió elementos.',
      '',
    );
    for (const omission of options.omissions) {
      lines.push(`  - ${omission.label}`, `    ${omission.reason}`);
    }
    lines.push('');
  }

  lines.push(
    'CÓMO CITAR ESTE MATERIAL',
    rule('-', 60),
    'Citá cada dataset por su nombre oficial y proveedor tal como figuran arriba,',
    'agregando la fecha de consulta. Territorio Base es la herramienta que armó el',
    'recorte, no la fuente del dato.',
    '',
    'ALCANCE',
    rule('-', 60),
    'Análisis territorial preliminar de gabinete. No reemplaza levantamientos de',
    'campo, estudios de detalle ni consultas a los organismos competentes.',
    '',
  );

  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/* LEEME.txt                                                                   */
/* -------------------------------------------------------------------------- */

export type BundleEntryNote = {
  path: string;
  description: string;
  /** CRS del archivo, en texto: `EPSG:32619 (UTM 19N)`. */
  crs: string;
};

export type ReadmeOptions = {
  aoiName: string;
  analysisId: string;
  areaHa: number;
  vertexCount: number;
  bbox: readonly [number, number, number, number];
  utmEpsg: number;
  vectorEpsg: number;
  clipToAoi: boolean;
  generatedAt: Date;
  engineVersion: string;
  entries: readonly BundleEntryNote[];
  omissions: readonly ExportOmission[];
};

/**
 * El `LEEME.txt`: qué es cada archivo, **en qué CRS está** y cuál fue el AOI.
 *
 * El CRS por archivo no es un detalle: los rasters salen en la UTM local (así
 * los escribe el servicio Python), los shapefiles en el CRS que eligió el
 * usuario y los `.geojson` siempre en WGS84, porque es lo único que admite el
 * RFC 7946. Tres CRS en un mismo ZIP, y quien lo abra tiene que saber cuál es
 * cuál antes de superponerlos.
 */
export function buildBundleReadme(options: ReadmeOptions): string {
  const [minLon, minLat, maxLon, maxLat] = options.bbox;

  const lines: string[] = [
    'TERRITORIO BASE — LEEME',
    rule('=', 60),
    '',
    `Zona de estudio : ${options.aoiName}`,
    `Análisis        : ${options.analysisId}`,
    `Generado        : ${isoDay(options.generatedAt)}`,
    `Versión del motor: ${options.engineVersion}`,
    '',
    'EL ÁREA DE INTERÉS (AOI)',
    rule('-', 60),
    `  Superficie      : ${formatHectares(options.areaHa, 1)}`,
    `  Vértices        : ${formatNumber(options.vertexCount, 0)}`,
    `  Bbox (WGS84)    : ${formatNumber(minLon, 5)}, ${formatNumber(minLat, 5)}, ${formatNumber(maxLon, 5)}, ${formatNumber(maxLat, 5)}`,
    `  UTM local       : EPSG:${options.utmEpsg}`,
    '',
    '  El polígono exacto está en `vector/aoi.geojson` y `vector/aoi.shp`. Es el',
    '  mismo que produjo TODOS los resultados de este ZIP: si redibujaste el área',
    '  después de analizar, este archivo tiene el polígono viejo, que es el que',
    '  corresponde a estos datos.',
    '',
    'SISTEMAS DE COORDENADAS',
    rule('-', 60),
    `  Rasters (.tif)  : EPSG:${options.utmEpsg} — la UTM local del AOI, tal como los`,
    '                    escribe el motor. Compresión DEFLATE y nodata explícito.',
    `  Shapefiles      : EPSG:${options.vectorEpsg}${
      options.vectorEpsg === 4326 ? ' (WGS84, grados)' : ' (UTM local, metros)'
    }`,
    '  GeoJSON (.geojson): EPSG:4326 SIEMPRE. El RFC 7946 no admite otro CRS.',
    '',
    '  Las áreas y distancias de los resúmenes están calculadas en la UTM local,',
    '  no en grados: medir en EPSG:4326 daría números distintos y equivocados.',
    '',
    'CONTENIDO',
    rule('-', 60),
  ];

  for (const entry of options.entries) {
    lines.push(`  ${entry.path}`, `      ${entry.description}`, `      CRS: ${entry.crs}`);
  }
  lines.push('');

  lines.push(
    'RECORTE AL AOI',
    rule('-', 60),
    options.clipToAoi
      ? '  Los POLÍGONOS están recortados al AOI (intersección real, calculada en UTM).'
      : '  Los vectores NO están recortados: se incluyen completos tal como llegaron.',
    '  Las LÍNEAS y los PUNTOS nunca se parten: se incluyen enteros si intersectan',
    '  el AOI. Cortar un curso de agua en el borde produce un arroyo que "termina"',
    '  en una línea recta imaginaria y engaña más de lo que ayuda.',
    '',
    'NOMBRES DE COLUMNA EN LOS SHAPEFILES',
    rule('-', 60),
    '  El formato DBF limita los nombres de campo a 10 caracteres. Los nombres',
    '  largos se acortan y se desambiguan automáticamente, y la correspondencia',
    '  completa `campo_dbf → campo_original` está en `vector/campos_shapefile.csv`.',
    '  Los `.geojson` conservan los nombres completos y los tipos sin recortar.',
    '',
  );

  if (options.omissions.length > 0) {
    lines.push(
      'CAPAS NO INCLUIDAS',
      rule('-', 60),
      '  Se ofrecían o se pidieron y no se pudieron generar. Su ausencia acá NO',
      '  significa ausencia de datos en el territorio.',
      '',
    );
    for (const omission of options.omissions) {
      lines.push(`  - ${omission.label}`, `    ${omission.reason}`);
    }
    lines.push('');
  }

  lines.push(
    'FUENTES Y LICENCIAS',
    rule('-', 60),
    '  Ver `FUENTES.txt`: cita completa, proveedor, endpoint, resolución, licencia,',
    '  fecha de consulta y advertencias de cada capa.',
    '',
    'ALCANCE',
    rule('-', 60),
    '  Análisis territorial preliminar de gabinete. No reemplaza levantamientos de',
    '  campo, estudios de detalle ni consultas a los organismos competentes.',
    '',
  );

  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/* resumen.csv                                                                 */
/* -------------------------------------------------------------------------- */

export type SummaryRow = {
  tema: string;
  indicador: string;
  valor: string;
  unidad: string;
  fuente: string;
};

/**
 * Una fila por indicador (§7.3). Es la tabla que alguien abre en Excel para
 * pegar en un informe, así que los valores van con coma decimal y la fuente
 * viaja en la MISMA fila: un CSV cuyo origen hay que buscar en otro archivo se
 * copia sin la cita.
 */
export function buildSummaryRows(analysis: TerritorioAnalysis): SummaryRow[] {
  const rows: SummaryRow[] = [];
  const DEM = 'Copernicus DEM GLO-30 (ESA / Planetary Computer)';
  const S2 = 'Sentinel-2 L2A (ESA Copernicus / Planetary Computer)';
  const WC = 'ESA WorldCover 2021';
  const OSM = 'OpenStreetMap vía Overpass API';
  const WDPA = 'WDPA — UNEP-WCMC';
  const MEPYD = 'MEPyD — Sistema de Información para la GRD y la AC';
  const AQUEDUCT = 'WRI Aqueduct Floods v2';

  rows.push(
    {
      tema: 'AOI',
      indicador: 'Superficie',
      valor: formatNumber(analysis.aoi.area_ha, 2),
      unidad: 'ha',
      fuente: 'Polígono del usuario',
    },
    {
      tema: 'AOI',
      indicador: 'Vértices',
      valor: formatNumber(analysis.aoi.vertex_count, 0),
      unidad: '',
      fuente: 'Polígono del usuario',
    },
    {
      tema: 'AOI',
      indicador: 'Zona UTM',
      valor: `EPSG:${String(analysis.aoi.utm_epsg)}`,
      unidad: '',
      fuente: 'Derivado del centroide',
    },
  );

  const topo = analysis.topography.summary;
  if (analysis.topography.available && topo != null) {
    rows.push(
      {
        tema: 'Topografía',
        indicador: 'Elevación mínima',
        valor: formatNumber(topo.elevation_min_m, 1),
        unidad: 'm',
        fuente: DEM,
      },
      {
        tema: 'Topografía',
        indicador: 'Elevación máxima',
        valor: formatNumber(topo.elevation_max_m, 1),
        unidad: 'm',
        fuente: DEM,
      },
      {
        tema: 'Topografía',
        indicador: 'Elevación media',
        valor: formatNumber(topo.elevation_mean_m, 1),
        unidad: 'm',
        fuente: DEM,
      },
      {
        tema: 'Topografía',
        indicador: 'Desnivel',
        valor: formatNumber(topo.elevation_range_m, 1),
        unidad: 'm',
        fuente: DEM,
      },
      {
        tema: 'Topografía',
        indicador: 'Pendiente media',
        valor: formatNumber(topo.slope_mean_pct, 1),
        unidad: '% (rise/run)',
        fuente: DEM,
      },
      {
        tema: 'Topografía',
        indicador: 'Pendiente máxima',
        valor: formatNumber(topo.slope_max_pct, 1),
        unidad: '% (rise/run)',
        fuente: DEM,
      },
    );
    for (const [label, pct] of Object.entries(topo.slope_class_pct)) {
      rows.push({
        tema: 'Topografía',
        indicador: `Superficie ${label}`,
        valor: formatNumber(pct, 1),
        unidad: '% del AOI',
        fuente: DEM,
      });
    }
  } else {
    rows.push({
      tema: 'Topografía',
      indicador: 'No disponible',
      valor: analysis.topography.error ?? 'El servicio no devolvió topografía.',
      unidad: '',
      fuente: DEM,
    });
  }

  const veg = analysis.vegetation.summary;
  if (analysis.vegetation.ndvi_available && veg?.ndvi_mean != null) {
    rows.push({
      tema: 'Vegetación',
      indicador: 'NDVI medio',
      valor: formatNumber(veg.ndvi_mean, 3),
      unidad: '-1..1',
      fuente: S2,
    });
    if (veg.ndvi_median != null) {
      rows.push({
        tema: 'Vegetación',
        indicador: 'NDVI mediana',
        valor: formatNumber(veg.ndvi_median, 3),
        unidad: '-1..1',
        fuente: S2,
      });
    }
    if (veg.ndvi_p90 != null) {
      rows.push({
        tema: 'Vegetación',
        indicador: 'NDVI percentil 90',
        valor: formatNumber(veg.ndvi_p90, 3),
        unidad: '-1..1',
        fuente: S2,
      });
    }
    for (const [label, pct] of Object.entries(veg.ndvi_density_class_pct ?? {})) {
      rows.push({
        tema: 'Vegetación',
        indicador: `Superficie ${label}`,
        valor: formatNumber(pct, 1),
        unidad: '% del AOI',
        fuente: S2,
      });
    }
  } else {
    rows.push({
      tema: 'Vegetación',
      indicador: 'NDVI no disponible',
      valor: analysis.vegetation.ndvi_error ?? 'No hubo escenas Sentinel-2 utilizables.',
      unidad: '',
      fuente: S2,
    });
  }

  if (analysis.vegetation.worldcover_available && veg != null) {
    if (veg.worldcover_tree_cover_pct != null) {
      rows.push({
        tema: 'Vegetación',
        indicador: 'Cobertura arbórea',
        valor: formatNumber(veg.worldcover_tree_cover_pct, 1),
        unidad: '% del AOI',
        fuente: WC,
      });
    }
    for (const [label, pct] of Object.entries(veg.worldcover_landcover_pct ?? {})) {
      rows.push({
        tema: 'Vegetación',
        indicador: `Cobertura ${label}`,
        valor: formatNumber(pct, 1),
        unidad: '% del AOI',
        fuente: WC,
      });
    }
  } else {
    rows.push({
      tema: 'Vegetación',
      indicador: 'WorldCover no disponible',
      valor: analysis.vegetation.worldcover_error ?? 'El servicio no devolvió cobertura de suelo.',
      unidad: '',
      fuente: WC,
    });
  }

  const hydro = analysis.hydrology.summary;
  if (hydro.available) {
    rows.push(
      {
        tema: 'Hidrología',
        indicador: 'Elementos hídricos hallados',
        valor: formatNumber(hydro.features_found, 0),
        unidad: '',
        fuente: OSM,
      },
      {
        tema: 'Hidrología',
        indicador: 'Intersecta el AOI',
        valor: hydro.intersects_aoi ? 'sí' : 'no',
        unidad: '',
        fuente: OSM,
      },
    );
    if (hydro.nearest_distance_m != null) {
      rows.push({
        tema: 'Hidrología',
        indicador: 'Distancia al más cercano',
        valor: formatNumber(hydro.nearest_distance_m, 0),
        unidad: 'm',
        fuente: OSM,
      });
    }
  } else {
    rows.push({
      tema: 'Hidrología',
      indicador: 'Fuente no disponible',
      valor: 'Overpass no respondió durante el análisis.',
      unidad: '',
      fuente: OSM,
    });
  }

  const wdpa = analysis.protected_areas.summary;
  if (wdpa.available) {
    rows.push(
      {
        tema: 'Áreas protegidas',
        indicador: 'Áreas halladas',
        valor: formatNumber(wdpa.areas_found, 0),
        unidad: '',
        fuente: WDPA,
      },
      {
        tema: 'Áreas protegidas',
        indicador: 'Intersecta el AOI',
        valor: wdpa.intersects_aoi ? 'sí' : 'no',
        unidad: '',
        fuente: WDPA,
      },
      {
        tema: 'Áreas protegidas',
        indicador: 'Superficie solapada',
        valor: formatNumber(wdpa.overlap_ha, 2),
        unidad: 'ha',
        fuente: WDPA,
      },
      {
        tema: 'Áreas protegidas',
        indicador: 'Solape sobre el AOI',
        valor: formatNumber(wdpa.overlap_pct_of_aoi, 1),
        unidad: '% del AOI',
        fuente: WDPA,
      },
    );
    if (wdpa.nearest_distance_m != null) {
      rows.push({
        tema: 'Áreas protegidas',
        indicador: 'Distancia a la más cercana',
        valor: formatNumber(wdpa.nearest_distance_m, 0),
        unidad: 'm',
        fuente: WDPA,
      });
    }
  } else {
    rows.push({
      tema: 'Áreas protegidas',
      indicador: 'Fuente no disponible',
      valor: 'WDPA no respondió durante el análisis.',
      unidad: '',
      fuente: WDPA,
    });
  }

  if (analysis.mepyd_rd.in_rd) {
    for (const [group, layers] of Object.entries(analysis.mepyd_rd.summary)) {
      for (const [label, entry] of Object.entries(layers)) {
        rows.push({
          tema: 'Contexto RD',
          indicador: `${group} · ${label}`,
          valor: formatNumber(entry.count, 0),
          unidad: 'elementos',
          fuente: MEPYD,
        });
      }
    }
    for (const failure of analysis.mepyd_rd.failures) {
      rows.push({
        tema: 'Contexto RD',
        indicador: `${failure.group} · ${failure.label}`,
        valor: `no disponible: ${failure.reason}`,
        unidad: '',
        fuente: MEPYD,
      });
    }
  } else {
    rows.push({
      tema: 'Contexto RD',
      indicador: 'No aplica',
      valor: 'El AOI está fuera de República Dominicana.',
      unidad: '',
      fuente: MEPYD,
    });
  }

  const coastal = analysis.coastal;
  if (coastal !== null && coastal.available && coastal.summary != null) {
    rows.push({
      tema: 'Riesgo costero',
      indicador: 'Escenario',
      valor: coastal.preset,
      unidad: '',
      fuente: AQUEDUCT,
    });
    if (coastal.summary.pct_area_flooded != null) {
      rows.push({
        tema: 'Riesgo costero',
        indicador: 'Superficie inundada',
        valor: formatNumber(coastal.summary.pct_area_flooded, 1),
        unidad: '% del AOI',
        fuente: AQUEDUCT,
      });
    }
    if (coastal.summary.max_depth_m != null) {
      rows.push({
        tema: 'Riesgo costero',
        indicador: 'Profundidad máxima',
        valor: formatNumber(coastal.summary.max_depth_m, 2),
        unidad: 'm',
        fuente: AQUEDUCT,
      });
    }
    if (coastal.summary.mean_depth_where_flooded_m != null) {
      rows.push({
        tema: 'Riesgo costero',
        indicador: 'Profundidad media donde inunda',
        valor: formatNumber(coastal.summary.mean_depth_where_flooded_m, 2),
        unidad: 'm',
        fuente: AQUEDUCT,
      });
    }
  }

  return rows;
}

export function buildSummaryCsv(analysis: TerritorioAnalysis): string {
  const header = 'tema,indicador,valor,unidad,fuente';
  const rows = buildSummaryRows(analysis).map((row) =>
    [row.tema, row.indicador, row.valor, row.unidad, row.fuente].map(csvCell).join(','),
  );
  return `${[header, ...rows].join('\n')}\n`;
}

/* -------------------------------------------------------------------------- */
/* reporte.md                                                                  */
/* -------------------------------------------------------------------------- */

export type ReportOptions = {
  analysis: TerritorioAnalysis;
  aoiName: string;
  generatedAt: Date;
  /** Vacío = todas las secciones. */
  sections?: readonly ReportSectionId[];
};

function wants(sections: readonly ReportSectionId[] | undefined, id: ReportSectionId): boolean {
  return sections === undefined || sections.length === 0 || sections.includes(id);
}

/** Bloque en rojo para una fuente que no respondió. El texto es el del §3. */
function unavailableBlock(message: string): string[] {
  return ['', `> **No disponible.** ${message}`, ''];
}

function percentTable(title: string, entries: Record<string, number>): string[] {
  const rows = Object.entries(entries);
  if (rows.length === 0) return [];
  return [
    '',
    `**${title}**`,
    '',
    '| Clase | % del AOI |',
    '| --- | ---: |',
    ...rows.map(([label, pct]) => `| ${label} | ${formatPercent(pct, 1)} |`),
  ];
}

/**
 * El reporte territorial en Markdown.
 *
 * Dos diferencias deliberadas con el reporte del legacy:
 *   1. **Incluye la inundación costera.** En el legacy vivía sólo en
 *      `session_state` y nunca llegaba al Markdown, aunque el usuario la
 *      hubiera visto en el mapa (inventario §9). Acá es parte del artefacto.
 *   2. **Dice qué NO se pudo consultar.** Un reporte que omite una fuente caída
 *      se lee como "no hay nada ahí", que es lo contrario de lo que pasó.
 */
export function buildReportMarkdown(options: ReportOptions): string {
  const { analysis, sections } = options;
  const lines: string[] = [];

  if (wants(sections, 'portada')) {
    const [minLon, minLat, maxLon, maxLat] = analysis.aoi.bbox;
    lines.push(
      '# Reporte territorial',
      '',
      `**Zona de estudio:** ${options.aoiName}`,
      '',
      `- **Superficie:** ${formatHectares(analysis.aoi.area_ha, 1)}`,
      `- **Bbox (WGS84):** ${formatNumber(minLon, 5)}, ${formatNumber(minLat, 5)}, ${formatNumber(maxLon, 5)}, ${formatNumber(maxLat, 5)}`,
      `- **Zona UTM:** EPSG:${String(analysis.aoi.utm_epsg)}`,
      `- **Generado:** ${isoDay(options.generatedAt)}`,
      `- **Análisis:** \`${analysis.id}\``,
      `- **Parámetros:** NDVI a ${String(analysis.params.ndvi_resolution_m)} m · ventana ${String(analysis.params.lookback_days)} días · nubosidad < ${String(analysis.params.max_cloud_cover)} %`,
      '',
    );

    const down = analysis.sources.filter((source) => source.state === 'error');
    if (down.length > 0) {
      lines.push(
        '## Fuentes que no respondieron',
        '',
        'Estas fuentes no se pudieron consultar durante el análisis. Su ausencia en',
        'las secciones de abajo **no significa que no haya datos en el territorio**.',
        '',
        ...down.map((source) => `- **${source.service}** — ${source.error ?? 'no respondió.'}`),
        '',
      );
    }
  }

  if (wants(sections, 'topografia')) {
    lines.push('## Topografía', '');
    const topo = analysis.topography.summary;
    if (analysis.topography.available && topo != null) {
      lines.push(
        `- Elevación: **${formatNumber(topo.elevation_min_m, 0)} – ${formatNumber(topo.elevation_max_m, 0)} m** (media ${formatNumber(topo.elevation_mean_m, 0)} m, desnivel ${formatNumber(topo.elevation_range_m, 0)} m).`,
        `- Pendiente: media **${formatPercent(topo.slope_mean_pct, 1)}**, máxima ${formatPercent(topo.slope_max_pct, 1)}. Es porcentaje de pendiente (rise/run), no grados.`,
        ...percentTable('Distribución de pendiente', topo.slope_class_pct),
        '',
      );
    } else {
      lines.push(
        ...unavailableBlock(
          analysis.topography.error ?? 'El servicio raster no devolvió topografía para este AOI.',
        ),
      );
    }
  }

  if (wants(sections, 'vegetacion')) {
    lines.push('## Vegetación', '');
    const veg = analysis.vegetation.summary;

    if (analysis.vegetation.ndvi_available && veg?.ndvi_mean != null) {
      lines.push(
        `- NDVI medio **${formatNumber(veg.ndvi_mean, 3)}**` +
          (veg.ndvi_median == null ? '' : `, mediana ${formatNumber(veg.ndvi_median, 3)}`) +
          (veg.ndvi_p90 == null ? '' : `, p90 ${formatNumber(veg.ndvi_p90, 3)}`) +
          '.',
        ...percentTable('Densidad de vegetación', veg.ndvi_density_class_pct ?? {}),
        '',
      );
    } else {
      lines.push(
        ...unavailableBlock(
          analysis.vegetation.ndvi_error ??
            'No hubo escenas Sentinel-2 utilizables para este AOI y esta ventana temporal.',
        ),
      );
    }

    if (analysis.vegetation.worldcover_available && veg != null) {
      if (veg.worldcover_tree_cover_pct != null) {
        lines.push(
          `- Cobertura arbórea (WorldCover clase 10): **${formatPercent(veg.worldcover_tree_cover_pct, 1)}** del AOI.`,
        );
      }
      lines.push(...percentTable('Cobertura de suelo', veg.worldcover_landcover_pct ?? {}), '');
    } else {
      lines.push(
        ...unavailableBlock(
          analysis.vegetation.worldcover_error ??
            'El servicio no devolvió cobertura de suelo para este AOI.',
        ),
      );
    }
  }

  if (wants(sections, 'hidrologia')) {
    lines.push('## Hidrología', '');
    const hydro = analysis.hydrology.summary;
    if (!hydro.available) {
      lines.push(
        ...unavailableBlock(
          'No se pudo consultar hidrología (Overpass API) — el servicio no respondió.',
        ),
      );
    } else if (hydro.features_found === 0) {
      lines.push(
        'Se consultó OpenStreetMap y **no hay elementos hídricos** dentro del buffer de 500 m',
        'alrededor del AOI. OSM es un mapa colaborativo: que no aparezca un curso de agua no',
        'prueba que no exista.',
        '',
      );
    } else {
      lines.push(
        `- **${formatNumber(hydro.features_found, 0)}** elementos hídricos dentro del buffer de 500 m.`,
        `- ${hydro.intersects_aoi ? 'Al menos uno **intersecta** el AOI.' : 'Ninguno intersecta el AOI.'}`,
        ...(hydro.nearest_distance_m == null
          ? []
          : [`- Más cercano a **${formatNumber(hydro.nearest_distance_m, 0)} m**.`]),
        '',
        '| Elemento | Tipo | Distancia |',
        '| --- | --- | ---: |',
        ...hydro.features
          .slice(0, 25)
          .map(
            (feature) =>
              `| ${feature.name ?? '(sin nombre)'} | ${feature.kind} | ${formatNumber(feature.distance_m, 0)} m |`,
          ),
        '',
      );
    }
  }

  if (wants(sections, 'areas-protegidas')) {
    lines.push('## Áreas protegidas', '');
    const wdpa = analysis.protected_areas.summary;
    if (!wdpa.available) {
      lines.push(
        ...unavailableBlock(
          'No se pudo consultar áreas protegidas (WDPA) — el servicio no respondió.',
        ),
      );
    } else if (wdpa.areas_found === 0) {
      lines.push(
        'Se consultó WDPA y **no hay áreas protegidas** dentro del buffer de 1 km alrededor del AOI.',
        '',
      );
    } else {
      lines.push(
        `- **${formatNumber(wdpa.areas_found, 0)}** áreas protegidas dentro del buffer de 1 km.`,
        `- Solape con el AOI: **${formatHectares(wdpa.overlap_ha, 2)}** (${formatPercent(wdpa.overlap_pct_of_aoi, 1)} del AOI).`,
        ...(wdpa.nearest_distance_m == null
          ? []
          : [`- Más cercana a **${formatNumber(wdpa.nearest_distance_m, 0)} m**.`]),
        '',
        '| Área | Designación | IUCN | Estado | Solape | Distancia |',
        '| --- | --- | --- | --- | ---: | ---: |',
        ...wdpa.areas.map(
          (area) =>
            `| ${area.name ?? '(sin nombre)'} | ${area.desig ?? '—'} | ${area.iucn_cat ?? '—'} | ${area.status ?? '—'} | ${formatHectares(area.overlap_ha, 2)} | ${formatNumber(area.distance_m, 0)} m |`,
        ),
        '',
      );
    }
  }

  if (wants(sections, 'riesgo-costero')) {
    const coastal = analysis.coastal;
    if (coastal !== null) {
      lines.push('## Riesgo costero (WRI Aqueduct)', '');
      if (!coastal.available) {
        lines.push(
          ...unavailableBlock(
            coastal.error ?? 'No se pudo consultar la inundación costera (WRI Aqueduct).',
          ),
        );
      } else if (!coastal.summary?.has_data) {
        lines.push(
          `Escenario **${coastal.preset}**: el AOI no registra inundación en este escenario.`,
          '',
        );
      } else {
        const summary = coastal.summary;
        lines.push(
          `Escenario **${coastal.preset}**.`,
          '',
          ...(summary.pct_area_flooded == null
            ? []
            : [
                `- Superficie inundada: **${formatPercent(summary.pct_area_flooded, 1)}** del AOI.`,
              ]),
          ...(summary.max_depth_m == null
            ? []
            : [`- Profundidad máxima: **${formatNumber(summary.max_depth_m, 2)} m**.`]),
          ...(summary.mean_depth_where_flooded_m == null
            ? []
            : [
                `- Profundidad media donde inunda: ${formatNumber(summary.mean_depth_where_flooded_m, 2)} m.`,
              ]),
          '',
          '> Herramienta de **screening**, no estudio de detalle. Resolución ~927 m; metodología',
          '> 2020 basada en escenarios RCP, con proyecciones sólo hasta 2080.',
          '',
        );
      }
    }
  }

  if (wants(sections, 'contexto-rd') && analysis.mepyd_rd.in_rd) {
    lines.push('## Contexto RD (MEPyD)', '');
    const groups = Object.entries(analysis.mepyd_rd.summary);
    if (groups.length === 0) {
      lines.push('Ninguna capa del MEPyD devolvió elementos dentro del AOI.', '');
    } else {
      lines.push('| Grupo | Capa | Elementos |', '| --- | --- | ---: |');
      for (const [group, layers] of groups) {
        for (const [label, entry] of Object.entries(layers)) {
          lines.push(`| ${group} | ${label} | ${formatNumber(entry.count, 0)} |`);
        }
      }
      lines.push('');
    }
    if (analysis.mepyd_rd.failures.length > 0) {
      lines.push(
        '**Capas MEPyD que no respondieron.** En el motor legacy se descartaban en silencio.',
        '',
        ...analysis.mepyd_rd.failures.map(
          (failure) => `- ${failure.group} · ${failure.label} — ${failure.reason}`,
        ),
        '',
      );
    }
  }

  if (wants(sections, 'fuentes')) {
    lines.push(
      '## Fuentes y licencias',
      '',
      'La ficha completa de cada dataset —nombre oficial, proveedor, endpoint, resolución,',
      'licencia, fecha de consulta y advertencias— está en `FUENTES.txt`, dentro de este mismo ZIP.',
      '',
      '| Capa | Fuente | Resolución | Licencia |',
      '| --- | --- | --- | --- |',
      ...DATASET_CITATIONS.map(
        (citation) =>
          `| ${citation.layer} | ${citation.officialName} — ${citation.provider} | ${citation.resolution} | ${citation.license} |`,
      ),
      '',
      '---',
      '',
      '_Análisis territorial preliminar de gabinete. No reemplaza levantamientos de campo,_',
      '_estudios de detalle ni consultas a los organismos competentes._',
      '',
    );
  }

  return lines.join('\n');
}

/** Etiquetas de sección, para el checklist del modal. */
export { REPORT_SECTION_LABELS };
