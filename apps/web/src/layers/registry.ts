/*
  REGISTRO DE CAPAS — fuente única de verdad (02-design-brief.md §1.2 y §11).

  Agregar la capa 40 es exactamente esto y nada más:
    1. una entrada acá (o una fila en `MEPYD_TABLE`),
    2. un `PopupConfig` con alias si es vectorial (el test lo exige),
    3. un adaptador de fetch en el motor con el MISMO id,
    4. opcionalmente `metrics: [...]` para que produzca tarjetas del reporte.
  Cero cambios de componentes.

  Etiquetas, paletas, visibilidad y opacidad por defecto salen tal cual del
  00-legacy-inventory.md §4. `defaultOn` documenta el estado heredado del motor
  Streamlit; qué capa de MEDICIÓN está prendida en cada momento lo decide la
  VISTA activa (§3, `vistas.ts`), que es la autoridad en tiempo de ejecución.
*/

import { MEPYD_LAYERS } from './mepyd';
import {
  AOI_OUTLINE_COLOR,
  AQUEDUCT_RAMP,
  ASPECT_RAMP,
  ELEVATION_RAMP,
  HYDROLOGY_CLASSES,
  IUCN_LABELS,
  NDVI_DENSITY_BREAKS,
  NDVI_DENSITY_CLASSES,
  NDVI_RAMP,
  OSM_HYDRO_KIND_LABELS,
  SLOPE_CLASSES,
  SLOPE_CLASS_BREAKS,
  SLOPE_RAMP,
  WDPA_COLOR,
  WORLDCOVER_CLASSES,
} from './palettes';
import {
  SRC_AOI,
  SRC_AQUEDUCT,
  SRC_COPERNICUS_DEM,
  SRC_OSM_HYDRO,
  SRC_SENTINEL2,
  SRC_SLOPE,
  SRC_WDPA,
  SRC_WORLDCOVER,
} from './sources';
import { formatDistance, formatHectares, formatNumber, formatPercent } from '../lib/format';

import type { FeatureProperties, LayerDef, ThemeId } from './types';

function numberProp(properties: FeatureProperties, key: string): number | null {
  const raw = properties[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

export const GROUP_ORDER = [
  'Área de estudio',
  'Topografía',
  'Vegetación',
  'Hidrología',
  'Áreas protegidas',
  'Riesgo costero',
  'Contexto RD (MEPyD)',
] as const;

const AOI_LAYER: LayerDef = {
  id: 'aoi',
  label: 'Límite del AOI',
  group: 'Área de estudio',
  themes: ['topografia', 'vegetacion', 'hidrologia', 'areas-protegidas', 'riesgo-rd'],
  kind: 'vector-polygon',
  role: 'contexto',
  defaultOn: true,
  alwaysOn: true,
  defaultOpacity: 1,
  legend: { type: 'swatch', color: AOI_OUTLINE_COLOR, fillFactor: 0, label: 'Límite del AOI' },
  source: SRC_AOI,
  popup: {
    title: 'Zona de estudio',
    fields: [{ key: 'area_ha', alias: 'Área', format: 'area-ha', decimals: 1 }],
    derived: [
      {
        alias: 'Zona UTM',
        compute: (_properties, aoi) => `EPSG:${String(aoi.utmEpsg)}`,
      },
    ],
    hiddenByDefault: true,
  },
  exports: ['shp', 'geojson'],
  removable: false,
};

const TOPOGRAPHY_LAYERS: LayerDef[] = [
  {
    id: 'slope-classes',
    label: 'Clases de pendiente',
    group: 'Topografía',
    themes: ['topografia'],
    kind: 'raster-categorical',
    role: 'medicion',
    defaultOn: true,
    defaultOpacity: 0.7,
    legend: { type: 'classes', classes: SLOPE_CLASSES, sparse: false },
    source: SRC_SLOPE,
    exports: ['geotiff'],
    metrics: ['clases-pendiente'],
    thresholds: [
      {
        id: 'slope-breaks',
        label: 'Cortes de clase (%)',
        defaults: SLOPE_CLASS_BREAKS,
        min: 0,
        max: 100,
        step: 1,
        unit: '%',
        help: 'Se reclasifica el GeoTIFF continuo que ya produjo el servidor. No re-lanza el análisis.',
      },
    ],
    removable: false,
  },
  {
    id: 'dem',
    label: 'Elevación (DEM)',
    group: 'Topografía',
    themes: ['topografia'],
    kind: 'raster-continuous',
    role: 'medicion',
    defaultOn: false,
    defaultOpacity: 0.7,
    legend: { type: 'ramp', colors: ELEVATION_RAMP, domain: 'dynamic', unit: 'm', decimals: 0 },
    source: SRC_COPERNICUS_DEM,
    exports: ['geotiff'],
    metrics: ['elevacion'],
    removable: false,
  },
  {
    id: 'slope',
    label: 'Pendiente (%)',
    group: 'Topografía',
    themes: [],
    kind: 'raster-continuous',
    role: 'medicion',
    defaultOn: false,
    defaultOpacity: 0.7,
    legend: { type: 'ramp', colors: SLOPE_RAMP, domain: 'p98', unit: '%', decimals: 0 },
    source: SRC_SLOPE,
    exports: ['geotiff'],
    metrics: ['pendiente'],
    removable: false,
  },
  {
    id: 'aspect',
    label: 'Orientación',
    group: 'Topografía',
    themes: [],
    kind: 'raster-continuous',
    role: 'medicion',
    defaultOn: false,
    defaultOpacity: 0.7,
    legend: {
      type: 'ramp',
      colors: ASPECT_RAMP,
      domain: { min: 0, max: 360 },
      unit: '°',
      decimals: 0,
    },
    source: {
      ...SRC_COPERNICUS_DEM,
      name: 'Orientación derivada del Copernicus DEM GLO-30',
      method:
        'Orientación de la ladera en grados (0-360°, 0 = norte) derivada del gradiente del DEM. El motor legacy la calculaba pero nunca la mostraba ni la exportaba.',
    },
    exports: ['geotiff'],
    metrics: ['orientacion'],
    removable: false,
  },
];

const VEGETATION_LAYERS: LayerDef[] = [
  {
    id: 'ndvi-density',
    label: 'Densidad de vegetación (clasificada)',
    group: 'Vegetación',
    themes: ['vegetacion'],
    kind: 'raster-categorical',
    role: 'medicion',
    defaultOn: true,
    defaultOpacity: 0.75,
    legend: { type: 'classes', classes: NDVI_DENSITY_CLASSES, sparse: false },
    source: SRC_SENTINEL2,
    exports: ['geotiff'],
    metrics: ['clases-ndvi'],
    thresholds: [
      {
        id: 'ndvi-breaks',
        label: 'Cortes de clase (NDVI)',
        defaults: NDVI_DENSITY_BREAKS,
        min: -1,
        max: 1,
        step: 0.05,
        unit: '',
        help: 'Se reclasifica el NDVI continuo del servidor. No re-lanza el análisis.',
      },
    ],
    removable: false,
  },
  {
    id: 'ndvi',
    label: 'NDVI (continuo)',
    group: 'Vegetación',
    themes: [],
    kind: 'raster-continuous',
    role: 'medicion',
    defaultOn: false,
    defaultOpacity: 0.7,
    legend: {
      type: 'ramp',
      colors: NDVI_RAMP,
      domain: { min: -1, max: 1 },
      unit: '',
      decimals: 1,
    },
    source: SRC_SENTINEL2,
    exports: ['geotiff'],
    metrics: ['ndvi'],
    removable: false,
  },
  {
    id: 'worldcover',
    label: 'Cobertura de suelo (WorldCover)',
    group: 'Vegetación',
    themes: ['vegetacion'],
    kind: 'raster-categorical',
    role: 'medicion',
    defaultOn: false,
    defaultOpacity: 0.7,
    legend: { type: 'classes', classes: WORLDCOVER_CLASSES, sparse: true },
    source: SRC_WORLDCOVER,
    exports: ['geotiff'],
    metrics: ['worldcover', 'cobertura-arborea'],
    removable: false,
  },
];

const HYDROLOGY_LAYERS: LayerDef[] = [
  {
    id: 'osm-hydro',
    label: 'Hidrología (OSM)',
    group: 'Hidrología',
    themes: ['hidrologia'],
    kind: 'vector-line',
    role: 'medicion',
    defaultOn: true,
    defaultOpacity: 0.9,
    legend: { type: 'classes', classes: HYDROLOGY_CLASSES, sparse: true },
    source: SRC_OSM_HYDRO,
    popup: {
      title: '{name}',
      subtitle: '{kind} · OSM {osm_id}',
      fields: [
        { key: 'name', alias: 'Nombre', format: 'text' },
        { key: 'kind', alias: 'Tipo', format: 'text', valueLabels: OSM_HYDRO_KIND_LABELS },
      ],
      derived: [
        {
          alias: 'Distancia al AOI',
          compute: (properties) => {
            const distance = numberProp(properties, 'distance_m');
            if (distance === null) return '—';
            return distance <= 0 ? '0 m (intersecta)' : formatDistance(distance);
          },
        },
      ],
      hiddenByDefault: true,
    },
    exports: ['shp', 'geojson'],
    metrics: ['hidrologia'],
    removable: false,
  },
];

const PROTECTED_LAYERS: LayerDef[] = [
  {
    id: 'wdpa',
    label: 'Áreas protegidas (WDPA)',
    group: 'Áreas protegidas',
    themes: ['areas-protegidas'],
    kind: 'vector-polygon',
    role: 'medicion',
    defaultOn: true,
    defaultOpacity: 0.8,
    legend: {
      type: 'swatch',
      color: WDPA_COLOR,
      fillFactor: 0.5,
      label: 'Área protegida (WDPA)',
    },
    source: SRC_WDPA,
    popup: {
      title: '{name}',
      subtitle: '{desig}',
      fields: [
        { key: 'name', alias: 'Nombre', format: 'text' },
        { key: 'desig', alias: 'Designación', format: 'text' },
        { key: 'iucn_cat', alias: 'Categoría UICN', format: 'text', valueLabels: IUCN_LABELS },
        { key: 'status', alias: 'Estado', format: 'text' },
      ],
      derived: [
        {
          alias: 'Solape con el AOI',
          compute: (properties) => {
            const overlap = numberProp(properties, 'overlap_ha');
            return overlap === null ? '—' : formatHectares(overlap);
          },
        },
        {
          alias: 'Solape (% del AOI)',
          compute: (properties, aoi) => {
            const overlap = numberProp(properties, 'overlap_ha');
            if (overlap === null || aoi.areaHa <= 0) return '—';
            return formatPercent((overlap / aoi.areaHa) * 100);
          },
        },
        {
          alias: 'Distancia al AOI',
          compute: (properties) => {
            const distance = numberProp(properties, 'distance_m');
            if (distance === null) return '—';
            return distance <= 0 ? '0 m (intersecta)' : formatDistance(distance);
          },
        },
      ],
      hiddenByDefault: true,
    },
    exports: ['shp', 'geojson'],
    metrics: ['areas-protegidas'],
    removable: false,
  },
];

const COASTAL_LAYERS: LayerDef[] = [
  {
    id: 'aqueduct',
    label: 'Inundación costera (WRI Aqueduct)',
    group: 'Riesgo costero',
    themes: [],
    kind: 'raster-continuous',
    role: 'medicion',
    defaultOn: false,
    defaultOpacity: 0.8,
    legend: { type: 'ramp', colors: AQUEDUCT_RAMP, domain: 'dynamic', unit: 'm', decimals: 1 },
    source: SRC_AQUEDUCT,
    exports: ['geotiff'],
    metrics: ['inundacion-costera'],
    removable: true,
  },
];

export const LAYER_REGISTRY: LayerDef[] = [
  AOI_LAYER,
  ...TOPOGRAPHY_LAYERS,
  ...VEGETATION_LAYERS,
  ...HYDROLOGY_LAYERS,
  ...PROTECTED_LAYERS,
  ...COASTAL_LAYERS,
  ...MEPYD_LAYERS,
];

const REGISTRY_INDEX = new Map(LAYER_REGISTRY.map((layer) => [layer.id, layer]));

export function getLayer(id: string): LayerDef | undefined {
  return REGISTRY_INDEX.get(id);
}

export type LayerSubgroupNode = {
  name: string;
  layers: LayerDef[];
};

export type LayerGroupNode = {
  name: string;
  /** Capas directas del grupo (todos menos MEPyD, que anida un nivel más). */
  layers: LayerDef[];
  subgroups: LayerSubgroupNode[];
};

/** Árbol grupo → subgrupo → capa, en el orden declarado (nunca alfabético). */
export function buildLayerTree(layers: LayerDef[] = LAYER_REGISTRY): LayerGroupNode[] {
  const groups: LayerGroupNode[] = [];

  for (const groupName of GROUP_ORDER) {
    const inGroup = layers.filter((layer) => layer.group === groupName);
    if (inGroup.length === 0) continue;

    const direct = inGroup.filter((layer) => layer.subgroup === undefined);
    const subgroups: LayerSubgroupNode[] = [];

    for (const layer of inGroup) {
      const name = layer.subgroup;
      if (name === undefined) continue;
      const existing = subgroups.find((node) => node.name === name);
      if (existing) existing.layers.push(layer);
      else subgroups.push({ name, layers: [layer] });
    }

    groups.push({ name: groupName, layers: direct, subgroups });
  }

  return groups;
}

export function layersForTheme(theme: ThemeId): LayerDef[] {
  return LAYER_REGISTRY.filter((layer) => layer.themes.includes(theme));
}

/** §7.2 — el menú de formatos sale de lo que las capas seleccionadas producen. */
export function exportFormatsFor(layerIds: readonly string[]): string[] {
  const formats = new Set<string>();
  for (const id of layerIds) {
    const layer = getLayer(id);
    if (!layer) continue;
    for (const format of layer.exports) formats.add(format);
  }
  return [...formats];
}

/** Texto plano de una rampa, para el equivalente accesible de la leyenda. */
export function describeLegend(layer: LayerDef): string {
  const legend = layer.legend;
  switch (legend.type) {
    case 'ramp': {
      if (legend.domain === 'dynamic') return `Rampa continua, mínimo y máximo reales del AOI.`;
      if (legend.domain === 'p98') return `Rampa continua de 0 al percentil 98 (recorta outliers).`;
      return `Rampa continua de ${formatNumber(legend.domain.min, legend.decimals)} a ${formatNumber(
        legend.domain.max,
        legend.decimals,
      )} ${legend.unit}`.trim();
    }
    case 'classes':
      return legend.classes.map((item) => item.label).join(', ');
    case 'swatch':
      return legend.label;
  }
}
