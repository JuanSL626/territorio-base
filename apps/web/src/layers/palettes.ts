/*
  Paletas de DATOS — 00-legacy-inventory.md §4, hex por hex.

  Ninguna de estas entra jamás en el chrome, y el hue de `--accent` no entra
  jamás acá (02-design-brief.md §10).
*/

import type { LegendClass } from './types';

/** Rampa de pendiente del brief §10. */
export const SLOPE_RAMP = ['#f7f7f7', '#d9a441', '#b5502f'];

/** Rampa de elevación (cmap `terrain`, muestreado en 5 pasos). */
export const ELEVATION_RAMP = ['#33a02c', '#b8d96a', '#e8d9a0', '#b08968', '#ffffff'];

/** NDVI continuo (cmap `RdYlGn`, dominio fijo -1..1). */
export const NDVI_RAMP = ['#a50026', '#f46d43', '#ffffbf', '#a6d96a', '#1a9850'];

/** Inundación costera (cmap `Blues`). */
export const AQUEDUCT_RAMP = ['#f7fbff', '#c6dbef', '#6baed6', '#2171b5', '#08306b'];

/** Orientación (cmap cíclico HSV, 0-360°). */
export const ASPECT_RAMP = ['#e41a1c', '#ffff33', '#4daf4a', '#377eb8', '#e41a1c'];

/**
 * Densidad de vegetación derivada de NDVI. Colores y cortes exactos del motor:
 * `[0.2, 0.4, 0.6]`, etiquetas usadas también como clave en `run_analysis`.
 */
export const NDVI_DENSITY_CLASSES: LegendClass[] = [
  { label: 'Sin vegetación / suelo desnudo o agua', color: '#bfae96' },
  { label: 'Vegetación dispersa / matorral bajo', color: '#fee08b' },
  { label: 'Vegetación densa / bosque secundario', color: '#66bd63' },
  { label: 'Vegetación muy densa / dosel maduro', color: '#1a9850' },
];

export const NDVI_DENSITY_BREAKS = [0.2, 0.4, 0.6];

/** Clases de pendiente en PORCENTAJE (rise/run×100), no en grados. */
export const SLOPE_CLASSES: LegendClass[] = [
  { label: 'Plano (0-5%)', color: '#f7f7f7' },
  { label: 'Suave (5-15%)', color: '#fdd49e' },
  { label: 'Moderado (15-30%)', color: '#d9a441' },
  { label: 'Fuerte (>30%)', color: '#b5502f' },
];

export const SLOPE_CLASS_BREAKS = [5, 15, 30];

/** Paleta oficial ESA WorldCover. `TREE_COVER_CLASS = 10`. */
export const WORLDCOVER_CLASSES: LegendClass[] = [
  { code: 10, label: 'Bosque / cobertura arbórea', color: '#006400' },
  { code: 20, label: 'Matorral (shrubland)', color: '#ffbb22' },
  { code: 30, label: 'Pastizal', color: '#ffff4c' },
  { code: 40, label: 'Cultivos', color: '#f096ff' },
  { code: 50, label: 'Área construida', color: '#fa0000' },
  { code: 60, label: 'Suelo desnudo / disperso', color: '#b4b4b4' },
  { code: 70, label: 'Nieve/hielo', color: '#f0f0f0' },
  { code: 80, label: 'Cuerpo de agua permanente', color: '#0064c8' },
  { code: 90, label: 'Humedal herbáceo', color: '#0096a0' },
  { code: 95, label: 'Manglar', color: '#00cf75' },
  { code: 100, label: 'Musgo y liquen', color: '#fae6a0' },
];

export const TREE_COVER_CLASS = 10;

/** Hidrología OSM: un color por tipo, sólo se listan los presentes. */
export const HYDROLOGY_CLASSES: LegendClass[] = [
  { label: 'Curso de agua', color: '#1f78b4' },
  { label: 'Cuerpo de agua', color: '#08519c' },
  { label: 'Humedal', color: '#41b6c4' },
];

export const AOI_OUTLINE_COLOR = '#3388ff';
export const WDPA_COLOR = '#d95f02';

/**
 * Paleta cualitativa MEPyD: 12 colores, UN COLOR POR CAPA, reciclada entre
 * grupos y nunca dentro de uno (regresión #7 del inventario). El índice es el
 * de la lista aplanada, así que ningún grupo — el mayor tiene 10 capas —
 * repite color internamente.
 */
export const MEPYD_QUALITATIVE = [
  '#e41a1c',
  '#377eb8',
  '#4daf4a',
  '#984ea3',
  '#ff7f00',
  '#a65628',
  '#f781bf',
  '#999999',
  '#66c2a5',
  '#fc8d62',
  '#8da0cb',
  '#e78ac3',
];

export function mepydColor(flatIndex: number): string {
  return MEPYD_QUALITATIVE[flatIndex % MEPYD_QUALITATIVE.length] ?? '#999999';
}

/** Etiquetas UICN expandidas — `IUCN_CAT` crudo no llega a la pantalla (§5.2). */
export const IUCN_LABELS: Record<string, string> = {
  Ia: 'Ia · Reserva natural estricta',
  Ib: 'Ib · Área silvestre',
  II: 'II · Parque nacional',
  III: 'III · Monumento natural',
  IV: 'IV · Área de gestión de hábitats/especies',
  V: 'V · Paisaje protegido',
  VI: 'VI · Área protegida con uso sostenible de recursos',
  'Not Reported': 'No reportada',
  'Not Applicable': 'No aplica',
  'Not Assigned': 'Sin asignar',
};

export const OSM_HYDRO_KIND_LABELS: Record<string, string> = {
  waterway: 'Curso de agua',
  water_body: 'Cuerpo de agua',
  wetland: 'Humedal',
};

/** Presets WRI Aqueduct — strings exactos del inventario §4. */
export type AqueductPreset = {
  label: string;
  scenario: string;
  year: string;
  returnPeriod: number;
};

export const AQUEDUCT_PRESETS: AqueductPreset[] = [
  {
    label: 'Hoy (histórico) — 100 años de retorno',
    scenario: 'historical',
    year: 'hist',
    returnPeriod: 100,
  },
  {
    label: '2050 · RCP4.5 (optimista) — 100 años',
    scenario: 'rcp4p5',
    year: '2050',
    returnPeriod: 100,
  },
  {
    label: '2050 · RCP8.5 (pesimista) — 100 años',
    scenario: 'rcp8p5',
    year: '2050',
    returnPeriod: 100,
  },
  {
    label: '2080 · RCP8.5 (pesimista) — 100 años',
    scenario: 'rcp8p5',
    year: '2080',
    returnPeriod: 100,
  },
  {
    label: '2080 · RCP8.5 (pesimista) — 1000 años (extremo)',
    scenario: 'rcp8p5',
    year: '2080',
    returnPeriod: 1000,
  },
];

/** Comunes a los cinco presets. */
export const AQUEDUCT_FIXED_PARAMS = { subsidence: 'wtsub', percentile: 95 } as const;
