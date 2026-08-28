/**
 * Armado del ZIP de descarga (design brief §7.3).
 *
 * Este paquete produce la mitad vectorial del bundle:
 *
 *     territorio-base_<aoi-slug>_<YYYY-MM-DD>.zip
 *     ├── LEEME.txt                    fuentes, licencias, citas, versión, parámetros
 *     ├── vector/
 *     │   ├── campos_shapefile.csv     mapa {campo DBF → nombre original} (H6)
 *     │   ├── aoi.geojson / aoi.shp …
 *     │   ├── hidrologia_osm.*
 *     │   ├── wdpa.*
 *     │   └── mepyd_<grupo>_<capa>.*
 *     └── …                            los archivos raster los agrega el servicio Python
 *
 * Los `.geojson` van siempre junto a los `.shp`: son los que conservan los
 * nombres de columna completos y los tipos sin el corsé del DBF.
 */

import { ZipArchive } from 'archiver';

import { projectGeometry, WGS84_EPSG } from '../crs';
import {
  flattenGeometry,
  type AreaGeometry,
  type Feature,
  type FeatureCollection,
  type Geometry,
} from '../geojson';
import { intersects, planarIntersection } from '../geometry';
import {
  GEOMETRY_CLASS_SUFFIX,
  writeShapefileSet,
  type ExportFeature,
  type ShapefileParts,
} from './shapefile';
import { buildReadme, type ReadmeOptions } from './sources';

import type { Aoi } from '../aoi';

export type VectorLayerExport = {
  /** Base del nombre de archivo, sin extensión. Ej.: `hidrologia_osm`. */
  name: string;
  /** Etiqueta legible, para el CSV de campos y el LEEME. */
  label: string;
  features: readonly Feature[];
};

export type BundleFile = { path: string; content: string | Uint8Array };

/**
 * Recorta las features al AOI.
 *
 * - **Polígonos**: intersección real, calculada en UTM (donde el clipping es
 *   métricamente correcto) y devuelta en WGS84.
 * - **Líneas y puntos**: se **filtran** por intersección, no se parten. Cortar
 *   un `waterway` en el borde del AOI produce un arroyo que "termina" en una
 *   línea recta imaginaria y engaña más de lo que ayuda; se prefiere entregar
 *   el elemento completo. Queda documentado acá y en el `LEEME.txt`.
 */
export function clipFeaturesToAoi(features: readonly Feature[], aoi: Aoi): Feature[] {
  const aoiUtm = projectGeometry(aoi.geometry, WGS84_EPSG, aoi.utmEpsg);
  if (aoiUtm.type !== 'Polygon' && aoiUtm.type !== 'MultiPolygon') {
    throw new Error('clipFeaturesToAoi: el AOI no es una geometría de área.');
  }

  const out: Feature[] = [];
  for (const feature of features) {
    const geometry: Geometry = feature.geometry;

    const areaParts = flattenGeometry(geometry).filter(
      (part): part is AreaGeometry => part.type === 'Polygon' || part.type === 'MultiPolygon',
    );

    if (areaParts.length === flattenGeometry(geometry).length && areaParts.length > 0) {
      const clipped: AreaGeometry[] = [];
      for (const part of areaParts) {
        const projected = projectGeometry(part, WGS84_EPSG, aoi.utmEpsg);
        if (projected.type !== 'Polygon' && projected.type !== 'MultiPolygon') continue;
        const piece = planarIntersection(projected, aoiUtm);
        if (piece === null) continue;
        const back = projectGeometry(piece, aoi.utmEpsg, WGS84_EPSG);
        if (back.type === 'Polygon' || back.type === 'MultiPolygon') clipped.push(back);
      }
      const onlyPiece = clipped[0];
      if (onlyPiece === undefined) continue;
      const merged: Geometry =
        clipped.length === 1
          ? onlyPiece
          : {
              type: 'MultiPolygon',
              coordinates: clipped.flatMap((g) =>
                g.type === 'Polygon' ? [g.coordinates] : g.coordinates,
              ),
            };
      out.push({ ...feature, geometry: merged });
      continue;
    }

    if (intersects(aoi.geometry, geometry)) out.push(feature);
  }
  return out;
}

function featureCollection(features: readonly Feature[]): FeatureCollection {
  return { type: 'FeatureCollection', features: [...features] };
}

export type VectorBundleOptions = {
  aoi: Aoi;
  /** Nombre legible de la zona; también da nombre al ZIP. */
  aoiName: string;
  layers: readonly VectorLayerExport[];
  /** EPSG de salida de los vectores. Default WGS84 (design brief §7.2). */
  outputEpsg?: number;
  /** Recortar las capas al AOI antes de escribir. Default `true`. */
  clipToAoi?: boolean;
  /** Archivos ya generados por otro workstream (rasters, reporte, resumen.csv). */
  extraFiles?: readonly BundleFile[];
  readme: Omit<ReadmeOptions, 'aoiName' | 'areaHa' | 'utmEpsg' | 'bbox' | 'outputEpsg'>;
};

export type VectorBundle = {
  filename: string;
  bytes: Buffer;
  /** Rutas incluidas, en orden — útil para tests y para el listado del job. */
  entries: string[];
};

/** `Zona Norte, Puerto Plata` → `zona-norte-puerto-plata`. */
export function slugify(value: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'aoi' : slug;
}

function shapefileEntries(
  base: string,
  parts: ShapefileParts,
  multiple: boolean,
): { path: string; content: Uint8Array | string }[] {
  const stem = multiple ? `${base}_${GEOMETRY_CLASS_SUFFIX[parts.geometryClass]}` : base;
  return [
    { path: `vector/${stem}.shp`, content: parts.shp },
    { path: `vector/${stem}.shx`, content: parts.shx },
    { path: `vector/${stem}.dbf`, content: parts.dbf },
    { path: `vector/${stem}.prj`, content: parts.prj },
    { path: `vector/${stem}.cpg`, content: parts.cpg },
  ];
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Genera todos los archivos del bundle vectorial **sin** comprimirlos.
 * Se expone aparte del zipeado para poder testear el contenido sin abrir un ZIP.
 */
export function buildVectorBundleFiles(options: VectorBundleOptions): BundleFile[] {
  const outputEpsg = options.outputEpsg ?? WGS84_EPSG;
  const clip = options.clipToAoi ?? true;
  const files: BundleFile[] = [];
  const fieldRows: string[] = ['capa,campo_dbf,campo_original,tipo,largo,decimales'];

  const layers: VectorLayerExport[] = [
    {
      name: 'aoi',
      label: 'Límite del AOI',
      features: [
        {
          type: 'Feature',
          geometry: options.aoi.geometry,
          properties: {
            nombre: options.aoiName,
            area_ha: options.aoi.areaHa,
            utm_epsg: options.aoi.utmEpsg,
          },
        },
      ],
    },
    ...options.layers,
  ];

  for (const layer of layers) {
    const clipped =
      clip && layer.name !== 'aoi'
        ? clipFeaturesToAoi(layer.features, options.aoi)
        : [...layer.features];
    if (clipped.length === 0) continue;

    const projected: ExportFeature[] = clipped.map((feature) => ({
      ...feature,
      geometry: projectGeometry(feature.geometry, WGS84_EPSG, outputEpsg),
    }));

    // El GeoJSON va siempre en WGS84, que es lo único que RFC 7946 admite.
    files.push({
      path: `vector/${layer.name}.geojson`,
      content: JSON.stringify(featureCollection(clipped)),
    });

    const set = writeShapefileSet({ features: projected, epsg: outputEpsg });
    const multiple = set.size > 1;
    for (const parts of set.values()) {
      files.push(...shapefileEntries(layer.name, parts, multiple));
      for (const field of parts.fields) {
        fieldRows.push(
          [
            layer.label,
            field.name,
            field.longName,
            field.type,
            String(field.length),
            String(field.decimals),
          ]
            .map(csvCell)
            .join(','),
        );
      }
    }
  }

  files.push({ path: 'vector/campos_shapefile.csv', content: `${fieldRows.join('\n')}\n` });
  files.unshift({
    path: 'LEEME.txt',
    content: buildReadme({
      ...options.readme,
      aoiName: options.aoiName,
      areaHa: options.aoi.areaHa,
      utmEpsg: options.aoi.utmEpsg,
      bbox: options.aoi.bbox,
      outputEpsg,
    }),
  });
  files.push(...(options.extraFiles ?? []));
  return files;
}

/** Nombre del ZIP: `territorio-base_<aoi-slug>_<YYYY-MM-DD>.zip`. */
export function bundleFilename(aoiName: string, generatedAt: Date): string {
  const date = generatedAt.toISOString().slice(0, 10);
  return `territorio-base_${slugify(aoiName)}_${date}.zip`;
}

/**
 * Comprime el bundle. La fecha de cada entrada se fija a `generatedAt` para que
 * dos corridas con la misma entrada produzcan el mismo ZIP — requisito del
 * cacheo por `aoi_hash + layer_versions + params` (design brief §7.3).
 */
export async function buildVectorBundle(options: VectorBundleOptions): Promise<VectorBundle> {
  const files = buildVectorBundleFiles(options);
  const generatedAt = options.readme.generatedAt;

  const archive = new ZipArchive({ zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  archive.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });

  const finished = new Promise<void>((resolve, reject) => {
    archive.on('end', () => {
      resolve();
    });
    archive.on('warning', reject);
    archive.on('error', reject);
  });

  for (const file of files) {
    const content =
      typeof file.content === 'string'
        ? Buffer.from(file.content, 'utf-8')
        : Buffer.from(file.content);
    archive.append(content, { name: file.path, date: generatedAt });
  }
  await archive.finalize();
  await finished;

  return {
    filename: bundleFilename(options.aoiName, generatedAt),
    bytes: Buffer.concat(chunks),
    entries: files.map((file) => file.path),
  };
}
