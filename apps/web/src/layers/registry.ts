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
  SRC_IDESC,
  SRC_IGAC,
  SRC_OSM_HYDRO,
  SRC_OSM_CONTEXT,
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
  'Contexto OpenStreetMap',
  'Áreas protegidas',
  'Riesgo costero',
  'Catastro Colombia',
  'Contexto Cali (IDESC)',
  'Contexto RD (MEPyD)',
] as const;

const AOI_LAYER: LayerDef = {
  id: 'aoi',
  label: 'Límite del AOI',
  group: 'Área de estudio',
  themes: ['topografia', 'solar', 'vegetacion', 'hidrologia', 'areas-protegidas', 'riesgo-rd'],
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
    themes: ['topografia', 'solar'],
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
    themes: ['topografia', 'solar'],
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
    themes: ['solar'],
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
    themes: ['solar'],
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

const osmPopup = {
  title: '{name}',
  subtitle: '{subtype} · OSM {osm_id}',
  fields: [
    { key: 'name', alias: 'Nombre', format: 'text' as const },
    { key: 'subtype', alias: 'Tipo OSM', format: 'text' as const },
  ],
  hiddenByDefault: true as const,
};

const OSM_CONTEXT_LAYERS: LayerDef[] = [
  {
    id: 'osm-roads',
    label: 'Vías (OSM)',
    group: 'Contexto OpenStreetMap',
    themes: [],
    kind: 'vector-line',
    role: 'contexto',
    defaultOn: false,
    defaultOpacity: 0.85,
    legend: { type: 'swatch', color: '#f59e0b', label: 'Vías mapeadas en OSM' },
    source: SRC_OSM_CONTEXT,
    popup: osmPopup,
    exports: [],
    removable: true,
  },
  {
    id: 'osm-buildings',
    label: 'Edificios (OSM)',
    group: 'Contexto OpenStreetMap',
    themes: [],
    kind: 'vector-polygon',
    role: 'contexto',
    defaultOn: false,
    defaultOpacity: 0.65,
    legend: { type: 'swatch', color: '#a78bfa', fillFactor: 0.35, label: 'Edificios OSM' },
    source: SRC_OSM_CONTEXT,
    popup: osmPopup,
    exports: [],
    removable: true,
  },
  {
    id: 'osm-amenities-points',
    label: 'Servicios y lugares (OSM)',
    group: 'Contexto OpenStreetMap',
    themes: [],
    kind: 'vector-point',
    role: 'contexto',
    defaultOn: false,
    defaultOpacity: 0.9,
    legend: { type: 'swatch', color: '#22c55e', label: 'Servicios y lugares OSM' },
    source: SRC_OSM_CONTEXT,
    popup: osmPopup,
    exports: [],
    removable: true,
  },
  {
    id: 'osm-amenities-areas',
    label: 'Áreas de servicios (OSM)',
    group: 'Contexto OpenStreetMap',
    themes: [],
    kind: 'vector-polygon',
    role: 'contexto',
    defaultOn: false,
    defaultOpacity: 0.65,
    legend: { type: 'swatch', color: '#10b981', fillFactor: 0.3, label: 'Áreas de servicios OSM' },
    source: SRC_OSM_CONTEXT,
    popup: osmPopup,
    exports: [],
    removable: true,
  },
  {
    id: 'osm-landuse',
    label: 'Usos de suelo (OSM)',
    group: 'Contexto OpenStreetMap',
    themes: [],
    kind: 'vector-polygon',
    role: 'contexto',
    defaultOn: false,
    defaultOpacity: 0.55,
    legend: { type: 'swatch', color: '#84cc16', fillFactor: 0.3, label: 'Usos de suelo OSM' },
    source: SRC_OSM_CONTEXT,
    popup: osmPopup,
    exports: [],
    removable: true,
  },
];

const PROTECTED_LAYERS: LayerDef[] = [
  {
    id: 'wdpa',
    label: 'Áreas protegidas oficiales',
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
      label: 'Área protegida',
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
        { key: 'registration_date', alias: 'Fecha de registro', format: 'text' },
        { key: 'source_name', alias: 'Fuente', format: 'text' },
        { key: 'source_year', alias: 'Año de consulta', format: 'text' },
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

const COLOMBIA_LAYERS: LayerDef[] = [
  {
    id: 'igac-parcels',
    label: 'Predios catastrales',
    group: 'Catastro Colombia',
    themes: ['topografia'],
    kind: 'vector-polygon',
    role: 'contexto',
    defaultOn: false,
    defaultOpacity: 0.75,
    legend: { type: 'swatch', color: '#f59e0b', fillFactor: 0.18, label: 'Predio IGAC' },
    source: SRC_IGAC,
    popup: {
      title: 'Predio {code}',
      subtitle: '{address}',
      fields: [
        { key: 'code', alias: 'Código predial', format: 'text' },
        { key: 'previous_code', alias: 'Código predial anterior', format: 'text' },
        { key: 'municipality_code', alias: 'Código del municipio', format: 'text' },
        { key: 'zone', alias: 'Zona', format: 'text' },
        { key: 'address', alias: 'Dirección', format: 'text' },
        { key: 'economic_destination', alias: 'Destino económico', format: 'text' },
        { key: 'land_area_m2', alias: 'Área del terreno (m²)', format: 'number', decimals: 1 },
        { key: 'built_area_m2', alias: 'Área construida (m²)', format: 'number', decimals: 1 },
        { key: 'source_year', alias: 'Año de actualización de la fuente', format: 'text' },
      ],
      hiddenByDefault: true,
    },
    exports: ['shp', 'geojson'],
    removable: false,
  },
  {
    id: 'idesc-constructions',
    label: 'Construcciones catastrales',
    group: 'Contexto Cali (IDESC)',
    subgroup: 'Catastro',
    themes: [],
    kind: 'vector-polygon',
    role: 'contexto',
    defaultOn: false,
    defaultOpacity: 0.75,
    legend: { type: 'swatch', color: '#a78bfa', fillFactor: 0.28, label: 'Construcción' },
    source: SRC_IDESC,
    popup: {
      title: 'Construcción {npn}',
      fields: [
        { key: 'npn', alias: 'Número predial', format: 'text' },
        {
          key: 'npisos',
          alias: 'Pisos',
          format: 'number',
          decimals: 0,
          valueLabels: { '0': 'No informado por IDESC' },
        },
        { key: 'shape_area', alias: 'Área geométrica (m²)', format: 'number', decimals: 1 },
        { key: 'comuna', alias: 'Comuna', format: 'text' },
        { key: 'barrio', alias: 'Barrio', format: 'text' },
        { key: 'data_source', alias: 'Fuente', format: 'text' },
        { key: 'source_year', alias: 'Año de la fuente', format: 'text' },
      ],
      hiddenByDefault: true,
    },
    exports: [],
    removable: true,
  },
  {
    id: 'idesc-pot-activity',
    label: 'Áreas de actividad POT',
    group: 'Contexto Cali (IDESC)',
    subgroup: 'POT 2014',
    themes: [],
    kind: 'vector-polygon',
    role: 'contexto',
    defaultOn: false,
    defaultOpacity: 0.58,
    legend: {
      type: 'classes',
      classes: [
        { label: 'Industrial', color: '#C500FF' },
        { label: 'Mixta', color: '#FF0000' },
        { label: 'Residencial neta', color: '#FFFF00' },
        { label: 'Residencial predominante', color: '#FFAA00' },
        { label: 'Dotacional', color: '#0070FF' },
        { label: 'Espacio público', color: '#38A800' },
        { label: 'Sin área de actividad', color: '#B2B2B2' },
      ],
      fillFactor: 0.3,
      sparse: true,
    },
    source: SRC_IDESC,
    popup: {
      title: 'Área de actividad POT',
      subtitle: '{barrio}',
      fields: [
        {
          key: 'pot_class',
          alias: 'Clasificación cartográfica',
          format: 'text',
          valueLabels: {
            Industrial: 'Industrial',
            Mixta: 'Mixta',
            'Residencial neta': 'Residencial neta',
            'Residencial predominante': 'Residencial predominante',
            Dotacional: 'Dotacional',
            'Espacio público': 'Espacio público',
            'Sin área de actividad': 'Sin área de actividad',
          },
        },
        { key: 'area_de_ac', alias: 'Área de actividad', format: 'text' },
        { key: 'tipo_activ', alias: 'Tipo de actividad', format: 'text' },
        { key: 'vocacion', alias: 'Vocación', format: 'text' },
        { key: 'barrio', alias: 'Barrio', format: 'text' },
        { key: 'actua_cat', alias: 'Actualización publicada', format: 'text' },
        { key: 'data_source', alias: 'Fuente', format: 'text' },
        { key: 'source_year', alias: 'Año de la fuente', format: 'text' },
      ],
      hiddenByDefault: true,
    },
    exports: [],
    removable: true,
  },
  {
    id: 'idesc-seismic-microzonation',
    label: 'Microzonificación sísmica',
    group: 'Contexto Cali (IDESC)',
    subgroup: 'Riesgos',
    themes: [],
    kind: 'vector-polygon',
    role: 'contexto',
    defaultOn: false,
    defaultOpacity: 0.52,
    legend: { type: 'swatch', color: '#ef4444', fillFactor: 0.3, label: 'Zona sísmica' },
    source: SRC_IDESC,
    popup: {
      title: '{zona_mzsc}',
      fields: [
        { key: 'zona_mzsc', alias: 'Zona de microzonificación', format: 'text' },
        { key: 'sucep_licu', alias: 'Susceptibilidad a licuación', format: 'number', decimals: 0 },
        { key: 'corrim_lat', alias: 'Corrimiento lateral', format: 'number', decimals: 0 },
        { key: 'data_source', alias: 'Fuente', format: 'text' },
        { key: 'source_year', alias: 'Año de la fuente', format: 'text' },
      ],
      hiddenByDefault: true,
    },
    exports: [],
    removable: true,
  },
];

export const LAYER_REGISTRY: LayerDef[] = [
  AOI_LAYER,
  ...TOPOGRAPHY_LAYERS,
  ...VEGETATION_LAYERS,
  ...HYDROLOGY_LAYERS,
  ...OSM_CONTEXT_LAYERS,
  ...PROTECTED_LAYERS,
  ...COASTAL_LAYERS,
  ...COLOMBIA_LAYERS,
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
