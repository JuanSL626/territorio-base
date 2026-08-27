/**
 * Capas del Sistema de Información para la GRD y la AC (MEPyD, República
 * Dominicana) — https://riesgos.mepyd.gob.do — vía sus FeatureServers públicos
 * de ArcGIS Online (sin token), consultadas por intersección espacial con el AOI.
 *
 * Port de `services/api/src/territorio_base/sources/mepyd_rd.py`.
 *
 * Solo aplica cuando el AOI cae dentro (o cerca) de República Dominicana; para
 * cualquier otra zona esta fuente no aporta nada y se omite entera, **sin
 * hacer una sola llamada de red** (UC-11).
 *
 * Las capas están agrupadas exactamente igual que en el "Explorador de Riesgo
 * 2.1" del MEPyD, para que el resultado sea reconocible por alguien que ya usa
 * ese portal. Quedan fuera del catálogo, a propósito, capas del mismo mapa que
 * son feeds globales/efímeros y no datos propios del MEPyD: imágenes
 * satelitales GOES en vivo, huracanes activos de NOAA, y cobertura de suelo
 * Sentinel-2 (ya cubierta por nuestra propia fuente ESA WorldCover).
 */

import { z } from 'zod';

import { bufferAoi, type Aoi } from '../aoi';
import { mapSettled } from '../concurrency';
import { isGeometry, type Bounds2D, type Geometry } from '../geojson';
import { arcgisRings } from '../geometry';
import { postFormJson, type RequestOptions } from '../http';

/**
 * bbox aproximado de República Dominicana `(lon_min, lat_min, lon_max, lat_max)`,
 * con margen — solo para decidir si vale la pena consultar estos servicios.
 */
export const RD_BBOX: Bounds2D = [-72.05, 17.45, -68.3, 19.95];

export const MEPYD_BUFFER_M = 500;

/** Tope de seguridad: capas densas tipo "Calles" pagan a lo sumo ~10× `maxRecordCount`. */
export const MEPYD_MAX_PAGES = 10;

/** `ThreadPoolExecutor(max_workers=10)` en el original. */
export const MEPYD_CONCURRENCY = 10;

const SIARDCC_PRUEBA =
  'https://services3.arcgis.com/DYnzeQNyuMo2mJ1o/arcgis/rest/services/SIARDCC_PRUEBA/FeatureServer';
const NUEVAS_CAPAS =
  'https://services3.arcgis.com/DYnzeQNyuMo2mJ1o/arcgis/rest/services/nuevas_capas/FeatureServer';
const CAPAS_SIRED =
  'https://services3.arcgis.com/DYnzeQNyuMo2mJ1o/arcgis/rest/services/CAPAS_SIRED/FeatureServer';
const CENSO_SISMICO = 'https://services3.arcgis.com/DYnzeQNyuMo2mJ1o/arcgis/rest/services';

export type MepydGroupName =
  | 'División Político-Administrativa'
  | 'Amenaza sísmica (por nivel censal 2010)'
  | 'Amenazas'
  | 'Agua'
  | 'Infraestructuras y edificaciones'
  | 'Vías'
  | 'Áreas protegidas (MEPyD)';

export type MepydLayerDef = {
  /** Slug estable: clave de URL, nombre de archivo en el ZIP, id en el panel de capas. */
  id: string;
  group: MepydGroupName;
  /** Etiqueta exacta en español, tal cual la muestra el portal MEPyD. */
  label: string;
  url: string;
};

export type MepydGroupDef = { group: MepydGroupName; layers: MepydLayerDef[] };

function layer(group: MepydGroupName, id: string, label: string, url: string): MepydLayerDef {
  return { id, group, label, url };
}

/**
 * Catálogo: 7 grupos, 39 capas, en el orden exacto del inventario §4.
 * (El inventario dice "~35 capas"; el catálogo real de `mepyd_rd.py` tiene 39:
 * 1 + 6 + 10 + 6 + 7 + 7 + 2. El número exacto está fijado en el test.)
 * El orden de los grupos y el de las capas dentro de cada grupo es parte del
 * contrato de UI (subheaders por grupo, expanders por capa).
 */
export const MEPYD_LAYERS: readonly MepydGroupDef[] = [
  {
    group: 'División Político-Administrativa',
    layers: [
      layer(
        'División Político-Administrativa',
        'dpa-municipios',
        'Municipios (límites, provincia, región, población)',
        `${SIARDCC_PRUEBA}/26`,
      ),
    ],
  },
  {
    group: 'Amenaza sísmica (por nivel censal 2010)',
    layers: [
      layer(
        'Amenaza sísmica (por nivel censal 2010)',
        'sismo-barrio-paraje',
        'Barrio/paraje',
        `${CENSO_SISMICO}/BPCenso2010_amenaza_sismica/FeatureServer/0`,
      ),
      layer(
        'Amenaza sísmica (por nivel censal 2010)',
        'sismo-seccion',
        'Sección',
        `${CENSO_SISMICO}/SECCenso2010_amenaza_sismica/FeatureServer/0`,
      ),
      layer(
        'Amenaza sísmica (por nivel censal 2010)',
        'sismo-distrito-municipal',
        'Distrito municipal',
        `${CENSO_SISMICO}/DMCenso2010_amenaza_sismica/FeatureServer/0`,
      ),
      layer(
        'Amenaza sísmica (por nivel censal 2010)',
        'sismo-municipio',
        'Municipio',
        `${CENSO_SISMICO}/MUNCenso2010_amenaza_sismica/FeatureServer/0`,
      ),
      layer(
        'Amenaza sísmica (por nivel censal 2010)',
        'sismo-vulnerabilidad-edificaciones',
        'Vulnerabilidad física de edificaciones (municipio)',
        `${CENSO_SISMICO}/Municipios_vulnerabilidad_sísmica/FeatureServer/0`,
      ),
      layer(
        'Amenaza sísmica (por nivel censal 2010)',
        'sismo-riesgo-municipio',
        'Riesgo sísmico (municipio)',
        `${CENSO_SISMICO}/Municipios_riesgo_sísmico_entero/FeatureServer/0`,
      ),
    ],
  },
  {
    group: 'Amenazas',
    layers: [
      layer(
        'Amenazas',
        'amenaza-gasoductos',
        'Gasoductos y oleoductos (buffer 500 m)',
        `${SIARDCC_PRUEBA}/8`,
      ),
      layer(
        'Amenazas',
        'amenaza-combustibles',
        'Almacenamiento de combustibles (buffer 1000 m)',
        `${SIARDCC_PRUEBA}/9`,
      ),
      layer('Amenazas', 'amenaza-vertederos', 'Vertederos (buffer 1500 m)', `${SIARDCC_PRUEBA}/11`),
      layer(
        'Amenazas',
        'amenaza-licuefaccion',
        'Área propensa a licuefacción',
        `${NUEVAS_CAPAS}/14`,
      ),
      layer(
        'Amenazas',
        'amenaza-deslizamiento',
        'Amenaza de deslizamiento',
        `${SIARDCC_PRUEBA}/22`,
      ),
      layer(
        'Amenazas',
        'amenaza-deslizamientos-sgn',
        'Áreas propensas a deslizamientos (SGN)',
        `${NUEVAS_CAPAS}/23`,
      ),
      layer(
        'Amenazas',
        'amenaza-sismica-zonificacion',
        'Amenaza sísmica (zonificación)',
        `${SIARDCC_PRUEBA}/19`,
      ),
      layer('Amenazas', 'amenaza-tsunami', 'Área propensa a tsunami', `${NUEVAS_CAPAS}/17`),
      layer('Amenazas', 'amenaza-inundacion', 'Área propensa a inundación', `${NUEVAS_CAPAS}/18`),
      layer('Amenazas', 'amenaza-ciclon', 'Amenaza de ciclón', `${SIARDCC_PRUEBA}/25`),
    ],
  },
  {
    group: 'Agua',
    layers: [
      layer(
        'Agua',
        'agua-ptar-inapa',
        'Plantas de tratamiento de residuales (INAPA)',
        `${CAPAS_SIRED}/3`,
      ),
      layer('Agua', 'agua-plantas-inapa', 'Plantas de tratamiento (INAPA)', `${CAPAS_SIRED}/1`),
      layer('Agua', 'agua-drenaje-buffer', 'Drenaje (buffer 20 m)', `${NUEVAS_CAPAS}/13`),
      layer('Agua', 'agua-drenaje-red', 'Drenaje (red)', `${NUEVAS_CAPAS}/8`),
      layer('Agua', 'agua-canales-riego', 'Canales de riego', `${NUEVAS_CAPAS}/9`),
      layer('Agua', 'agua-rios-arroyos', 'Ríos y arroyos', `${NUEVAS_CAPAS}/6`),
    ],
  },
  {
    group: 'Infraestructuras y edificaciones',
    layers: [
      layer(
        'Infraestructuras y edificaciones',
        'infra-lineas-transmision',
        'Líneas de transmisión eléctrica',
        `${CAPAS_SIRED}/4`,
      ),
      layer(
        'Infraestructuras y edificaciones',
        'infra-obras-toma',
        'Obras de toma (canales INDRHI)',
        `${NUEVAS_CAPAS}/1`,
      ),
      layer(
        'Infraestructuras y edificaciones',
        'infra-salud',
        'Infraestructura de salud',
        `${NUEVAS_CAPAS}/5`,
      ),
      layer(
        'Infraestructuras y edificaciones',
        'infra-subestaciones',
        'Subestaciones eléctricas',
        `${CAPAS_SIRED}/0`,
      ),
      layer(
        'Infraestructuras y edificaciones',
        'infra-albergues',
        'Albergues',
        `${NUEVAS_CAPAS}/4`,
      ),
      layer(
        'Infraestructuras y edificaciones',
        'infra-centros-educativos',
        'Centros educativos',
        `${NUEVAS_CAPAS}/0`,
      ),
      layer(
        'Infraestructuras y edificaciones',
        'infra-area-construida',
        'Área construida',
        `${NUEVAS_CAPAS}/20`,
      ),
    ],
  },
  {
    group: 'Vías',
    layers: [
      layer('Vías', 'vias-calles', 'Calles', `${SIARDCC_PRUEBA}/5`),
      layer('Vías', 'vias-pistas', 'Pistas', `${SIARDCC_PRUEBA}/7`),
      layer('Vías', 'vias-terciarias', 'Carreteras terciarias', `${SIARDCC_PRUEBA}/0`),
      layer('Vías', 'vias-secundarias', 'Carreteras secundarias', `${SIARDCC_PRUEBA}/1`),
      layer('Vías', 'vias-primarias', 'Carreteras primarias', `${SIARDCC_PRUEBA}/2`),
      layer('Vías', 'vias-autovias', 'Autovías', `${SIARDCC_PRUEBA}/3`),
      layer('Vías', 'vias-puentes', 'Puentes', `${CAPAS_SIRED}/2`),
    ],
  },
  {
    group: 'Áreas protegidas (MEPyD)',
    layers: [
      layer(
        'Áreas protegidas (MEPyD)',
        'ap-amortiguamiento',
        'Área de amortiguamiento',
        `${NUEVAS_CAPAS}/16`,
      ),
      layer('Áreas protegidas (MEPyD)', 'ap-protegida', 'Área protegida', `${NUEVAS_CAPAS}/15`),
    ],
  },
];

/** Las 35 capas en orden plano, para iterar. */
export const MEPYD_LAYERS_FLAT: readonly MepydLayerDef[] = MEPYD_LAYERS.flatMap((g) => g.layers);

/** `true` si el bbox del AOI intersecta `RD_BBOX`. Idéntico a `is_in_rd`. */
export function isInRd(bbox: Bounds2D): boolean {
  const [minX, minY, maxX, maxY] = bbox;
  const [bx0, by0, bx1, by1] = RD_BBOX;
  return !(maxX < bx0 || minX > bx1 || maxY < by0 || minY > by1);
}

/** Esquema de atributos **dinámico y distinto por capa** (`outFields="*"`, inventario §6). */
export type MepydFeature = { properties: Record<string, unknown>; geometry: Geometry };

export type MepydLayerResult = { layer: MepydLayerDef; features: MepydFeature[] };

export type MepydFailure = { layer: MepydLayerDef; error: unknown };

export type MepydResult = {
  /** `false` ⇒ el AOI está fuera de RD: no se hizo ninguna llamada (UC-11). */
  inRd: boolean;
  /** Solo capas con ≥1 feature, en el orden del catálogo (UC-12). */
  layers: MepydLayerResult[];
  /**
   * Capas que fallaron. El legacy las descartaba en silencio; acá se descartan
   * del resultado igual, pero el motivo queda disponible para que la UI pueda
   * mostrarlas en gris con su razón (design brief §7.2) en vez de mentir.
   */
  failures: MepydFailure[];
};

const arcgisPageSchema = z.object({
  error: z.unknown().optional(),
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

/**
 * Una capa, paginada.
 *
 * La paginación por `resultOffset` / `exceededTransferLimit` se agregó porque
 * las capas densas se **truncaban en silencio** en `maxRecordCount` (inventario
 * §5): la respuesta era un 200 perfectamente válido con la mitad de los datos.
 */
export async function fetchMepydLayer(
  definition: MepydLayerDef,
  searchAreaRings: number[][][],
  options: RequestOptions = {},
): Promise<MepydFeature[]> {
  const baseParams: Record<string, string> = {
    geometry: JSON.stringify({ rings: searchAreaRings, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPolygon',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
  };

  const collected: MepydFeature[] = [];
  let offset = 0;

  for (let page = 0; page < MEPYD_MAX_PAGES; page += 1) {
    const payload = await postFormJson(
      `${definition.url}/query`,
      { ...baseParams, resultOffset: String(offset) },
      { timeouts: { connectMs: 5_000, readMs: 30_000 }, ...options },
    );
    const parsed = arcgisPageSchema.safeParse(payload);
    if (!parsed.success) break;
    if (parsed.data.error !== undefined) break;

    const features = parsed.data.features ?? [];
    for (const feature of features) {
      const geometry: unknown = feature.geometry;
      if (!isGeometry(geometry)) continue;
      collected.push({ properties: feature.properties ?? {}, geometry });
    }

    if (parsed.data.properties?.exceededTransferLimit !== true || features.length === 0) break;
    offset += features.length;
  }

  return collected;
}

/**
 * Consulta todas las capas del catálogo que intersectan el AOI (+ buffer), con
 * concurrencia acotada a 10.
 *
 * Son ~35 servicios de terceros con confiabilidad variable (mantenimiento,
 * límites de la cuenta de ArcGIS Online del MEPyD): **una capa que falla se
 * omite, nunca tumba el análisis** (regresión #3). Una capa sin resultados
 * dentro del buffer tampoco aparece — por eso toda capa presente tiene
 * `count >= 1` y la rama "Sin atributos." del legacy era código muerto.
 */
export async function fetchAllMepyd(
  aoi: Aoi,
  options: RequestOptions & {
    bufferM?: number;
    concurrency?: number;
    layers?: readonly MepydLayerDef[];
  } = {},
): Promise<MepydResult> {
  if (!isInRd(aoi.bbox)) return { inRd: false, layers: [], failures: [] };

  const definitions = options.layers ?? MEPYD_LAYERS_FLAT;
  const searchArea = bufferAoi(aoi, options.bufferM ?? MEPYD_BUFFER_M);
  const rings = arcgisRings(searchArea);

  const settled = await mapSettled(
    definitions,
    async (definition) => await fetchMepydLayer(definition, rings, options),
    options.concurrency ?? MEPYD_CONCURRENCY,
  );

  const layers: MepydLayerResult[] = [];
  const failures: MepydFailure[] = [];
  for (const [index, outcome] of settled.entries()) {
    const definition = definitions[index];
    if (definition === undefined) continue;
    if (!outcome.ok) {
      failures.push({ layer: definition, error: outcome.error });
      continue;
    }
    if (outcome.value.length === 0) continue;
    layers.push({ layer: definition, features: outcome.value });
  }

  return { inRd: true, layers, failures };
}
