/*
  Catálogo "Contexto RD (MEPyD)" — 7 grupos, 39 capas.

  Grupos, orden y ETIQUETAS EXACTAS copiadas de `sources/mepyd_rd.py::LAYERS`:
  la recognizabilidad con el Explorador de Riesgo 2.1 del MEPyD es un activo
  deliberado (02-design-brief.md §1.3). No renombrar, no reordenar, no
  "mejorar" la ortografía de una etiqueta.

  Agregar la capa 40 acá es agregar una fila a `MEPYD_TABLE`: ningún componente
  cambia (§11).
*/

import { mepydColor } from './palettes';
import { SRC_MEPYD } from './sources';

import type { LayerDef, LayerKind, PopupConfig, ThemeId } from './types';

const SIARDCC =
  'https://services3.arcgis.com/DYnzeQNyuMo2mJ1o/arcgis/rest/services/SIARDCC_PRUEBA/FeatureServer';
const NUEVAS =
  'https://services3.arcgis.com/DYnzeQNyuMo2mJ1o/arcgis/rest/services/nuevas_capas/FeatureServer';
const SIRED =
  'https://services3.arcgis.com/DYnzeQNyuMo2mJ1o/arcgis/rest/services/CAPAS_SIRED/FeatureServer';
const CENSO = 'https://services3.arcgis.com/DYnzeQNyuMo2mJ1o/arcgis/rest/services';

export const MEPYD_GROUP = 'Contexto RD (MEPyD)';

/** Subgrupo (= grupo del Explorador) → capas, en el orden declarado por el motor. */
type MepydRow = {
  subgroup: string;
  label: string;
  url: string;
  kind: LayerKind;
};

export const MEPYD_TABLE: MepydRow[] = [
  {
    subgroup: 'División Político-Administrativa',
    label: 'Municipios (límites, provincia, región, población)',
    url: `${SIARDCC}/26`,
    kind: 'vector-polygon',
  },

  {
    subgroup: 'Amenaza sísmica (por nivel censal 2010)',
    label: 'Barrio/paraje',
    url: `${CENSO}/BPCenso2010_amenaza_sismica/FeatureServer/0`,
    kind: 'vector-polygon',
  },
  {
    subgroup: 'Amenaza sísmica (por nivel censal 2010)',
    label: 'Sección',
    url: `${CENSO}/SECCenso2010_amenaza_sismica/FeatureServer/0`,
    kind: 'vector-polygon',
  },
  {
    subgroup: 'Amenaza sísmica (por nivel censal 2010)',
    label: 'Distrito municipal',
    url: `${CENSO}/DMCenso2010_amenaza_sismica/FeatureServer/0`,
    kind: 'vector-polygon',
  },
  {
    subgroup: 'Amenaza sísmica (por nivel censal 2010)',
    label: 'Municipio',
    url: `${CENSO}/MUNCenso2010_amenaza_sismica/FeatureServer/0`,
    kind: 'vector-polygon',
  },
  {
    subgroup: 'Amenaza sísmica (por nivel censal 2010)',
    label: 'Vulnerabilidad física de edificaciones (municipio)',
    url: `${CENSO}/Municipios_vulnerabilidad_sísmica/FeatureServer/0`,
    kind: 'vector-polygon',
  },
  {
    subgroup: 'Amenaza sísmica (por nivel censal 2010)',
    label: 'Riesgo sísmico (municipio)',
    url: `${CENSO}/Municipios_riesgo_sísmico_entero/FeatureServer/0`,
    kind: 'vector-polygon',
  },

  {
    subgroup: 'Amenazas',
    label: 'Gasoductos y oleoductos (buffer 500 m)',
    url: `${SIARDCC}/8`,
    kind: 'vector-polygon',
  },
  {
    subgroup: 'Amenazas',
    label: 'Almacenamiento de combustibles (buffer 1000 m)',
    url: `${SIARDCC}/9`,
    kind: 'vector-polygon',
  },
  {
    subgroup: 'Amenazas',
    label: 'Vertederos (buffer 1500 m)',
    url: `${SIARDCC}/11`,
    kind: 'vector-polygon',
  },
  {
    subgroup: 'Amenazas',
    label: 'Área propensa a licuefacción',
    url: `${NUEVAS}/14`,
    kind: 'vector-polygon',
  },
  {
    subgroup: 'Amenazas',
    label: 'Amenaza de deslizamiento',
    url: `${SIARDCC}/22`,
    kind: 'vector-polygon',
  },
  {
    subgroup: 'Amenazas',
    label: 'Áreas propensas a deslizamientos (SGN)',
    url: `${NUEVAS}/23`,
    kind: 'vector-polygon',
  },
  {
    subgroup: 'Amenazas',
    label: 'Amenaza sísmica (zonificación)',
    url: `${SIARDCC}/19`,
    kind: 'vector-polygon',
  },
  {
    subgroup: 'Amenazas',
    label: 'Área propensa a tsunami',
    url: `${NUEVAS}/17`,
    kind: 'vector-polygon',
  },
  {
    subgroup: 'Amenazas',
    label: 'Área propensa a inundación',
    url: `${NUEVAS}/18`,
    kind: 'vector-polygon',
  },
  {
    subgroup: 'Amenazas',
    label: 'Amenaza de ciclón',
    url: `${SIARDCC}/25`,
    kind: 'vector-polygon',
  },

  {
    subgroup: 'Agua',
    label: 'Plantas de tratamiento de residuales (INAPA)',
    url: `${SIRED}/3`,
    kind: 'vector-point',
  },
  {
    subgroup: 'Agua',
    label: 'Plantas de tratamiento (INAPA)',
    url: `${SIRED}/1`,
    kind: 'vector-point',
  },
  { subgroup: 'Agua', label: 'Drenaje (buffer 20 m)', url: `${NUEVAS}/13`, kind: 'vector-polygon' },
  { subgroup: 'Agua', label: 'Drenaje (red)', url: `${NUEVAS}/8`, kind: 'vector-line' },
  { subgroup: 'Agua', label: 'Canales de riego', url: `${NUEVAS}/9`, kind: 'vector-line' },
  { subgroup: 'Agua', label: 'Ríos y arroyos', url: `${NUEVAS}/6`, kind: 'vector-line' },

  {
    subgroup: 'Infraestructuras y edificaciones',
    label: 'Líneas de transmisión eléctrica',
    url: `${SIRED}/4`,
    kind: 'vector-line',
  },
  {
    subgroup: 'Infraestructuras y edificaciones',
    label: 'Obras de toma (canales INDRHI)',
    url: `${NUEVAS}/1`,
    kind: 'vector-point',
  },
  {
    subgroup: 'Infraestructuras y edificaciones',
    label: 'Infraestructura de salud',
    url: `${NUEVAS}/5`,
    kind: 'vector-point',
  },
  {
    subgroup: 'Infraestructuras y edificaciones',
    label: 'Subestaciones eléctricas',
    url: `${SIRED}/0`,
    kind: 'vector-point',
  },
  {
    subgroup: 'Infraestructuras y edificaciones',
    label: 'Albergues',
    url: `${NUEVAS}/4`,
    kind: 'vector-point',
  },
  {
    subgroup: 'Infraestructuras y edificaciones',
    label: 'Centros educativos',
    url: `${NUEVAS}/0`,
    kind: 'vector-point',
  },
  {
    subgroup: 'Infraestructuras y edificaciones',
    label: 'Área construida',
    url: `${NUEVAS}/20`,
    kind: 'vector-polygon',
  },

  { subgroup: 'Vías', label: 'Calles', url: `${SIARDCC}/5`, kind: 'vector-line' },
  { subgroup: 'Vías', label: 'Pistas', url: `${SIARDCC}/7`, kind: 'vector-line' },
  { subgroup: 'Vías', label: 'Carreteras terciarias', url: `${SIARDCC}/0`, kind: 'vector-line' },
  { subgroup: 'Vías', label: 'Carreteras secundarias', url: `${SIARDCC}/1`, kind: 'vector-line' },
  { subgroup: 'Vías', label: 'Carreteras primarias', url: `${SIARDCC}/2`, kind: 'vector-line' },
  { subgroup: 'Vías', label: 'Autovías', url: `${SIARDCC}/3`, kind: 'vector-line' },
  { subgroup: 'Vías', label: 'Puentes', url: `${SIRED}/2`, kind: 'vector-point' },

  {
    subgroup: 'Áreas protegidas (MEPyD)',
    label: 'Área de amortiguamiento',
    url: `${NUEVAS}/16`,
    kind: 'vector-polygon',
  },
  {
    subgroup: 'Áreas protegidas (MEPyD)',
    label: 'Área protegida',
    url: `${NUEVAS}/15`,
    kind: 'vector-polygon',
  },
];

export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Popup de una capa MEPyD. El esquema es `outFields="*"` y distinto por capa
 * (inventario §6): el único campo buscado por nombre es el heurístico de
 * display. El resto se renderiza como tabla de columnas dinámicas, jamás con
 * un alias inventado.
 */
function mepydPopup(label: string): PopupConfig {
  return {
    title: '{MUN_NOM|NOMBRE|nombre|name}',
    subtitle: label,
    fields: [{ key: 'MUN_NOM|NOMBRE|nombre|name', alias: 'Nombre', format: 'text' }],
    hiddenByDefault: true,
    allowDynamicFields: true,
  };
}

/**
 * Relleno bajo + borde fuerte para polígonos superpuestos (regresión #4 del
 * inventario: con 0,34 de relleno tres amenazas apiladas daban un blob rosa
 * que no coincidía con ninguna entrada de leyenda).
 */
function fillFactorFor(kind: LayerKind): number | undefined {
  if (kind === 'vector-polygon') return 0.12;
  if (kind === 'vector-line') return 0.4;
  return undefined;
}

/**
 * Las únicas capas MEPyD que una VISTA prende sola (02-design-brief.md §3).
 * El resto es contexto puro: se prende a mano y sobrevive el cambio de vista.
 */
const MEPYD_THEME_DEFAULTS: Record<string, ThemeId[]> = {
  'mepyd:agua/rios-y-arroyos': ['hidrologia'],
  'mepyd:areas-protegidas-mepyd/area-protegida': ['areas-protegidas'],
  'mepyd:amenazas/amenaza-de-deslizamiento': ['riesgo-rd'],
  'mepyd:amenazas/area-propensa-a-inundacion': ['riesgo-rd'],
  'mepyd:amenazas/area-propensa-a-tsunami': ['riesgo-rd'],
};

export const MEPYD_LAYERS: LayerDef[] = MEPYD_TABLE.map((row, index) => {
  const color = mepydColor(index);
  const id = `mepyd:${slugify(row.subgroup)}/${slugify(row.label)}`;

  return {
    id,
    label: row.label,
    group: MEPYD_GROUP,
    subgroup: row.subgroup,
    themes: MEPYD_THEME_DEFAULTS[id] ?? [],
    kind: row.kind,
    role: 'contexto',
    defaultOn: false,
    defaultOpacity: 0.85,
    legend: {
      type: 'swatch',
      color,
      fillFactor: fillFactorFor(row.kind),
      label: row.label,
    },
    source: { ...SRC_MEPYD, url: row.url },
    popup: mepydPopup(row.label),
    exports: ['shp', 'geojson'],
    removable: true,
    requiresRd: true,
  } satisfies LayerDef;
});

export const MEPYD_SUBGROUPS: string[] = [...new Set(MEPYD_TABLE.map((row) => row.subgroup))];

/** Ids usados por las vistas del §3 — resueltos una vez para no repetir slugs. */
export const MEPYD_IDS = {
  riosArroyos: `mepyd:${slugify('Agua')}/${slugify('Ríos y arroyos')}`,
  areaProtegida: `mepyd:${slugify('Áreas protegidas (MEPyD)')}/${slugify('Área protegida')}`,
  deslizamiento: `mepyd:${slugify('Amenazas')}/${slugify('Amenaza de deslizamiento')}`,
  inundacion: `mepyd:${slugify('Amenazas')}/${slugify('Área propensa a inundación')}`,
  tsunami: `mepyd:${slugify('Amenazas')}/${slugify('Área propensa a tsunami')}`,
} as const;
