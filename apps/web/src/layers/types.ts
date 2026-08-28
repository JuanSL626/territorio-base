/*
  Contratos del registro de capas — 02-design-brief.md §1.2.

  Este módulo es la ÚNICA fuente de verdad de: panel de leyenda, capas de
  estilo del mapa, handlers de click, orden de las tarjetas del reporte, menú
  de exportación y tabla de fuentes. Nada de una capa se hardcodea en otro
  lado (§11).

  Vive en `apps/web/src/layers/` y no importa NADA de `~/components`, para que
  pueda moverse tal cual a `packages/layers/` cuando ese paquete exista.
*/

export type ThemeId = 'topografia' | 'vegetacion' | 'hidrologia' | 'areas-protegidas' | 'riesgo-rd';

export type LayerKind =
  'raster-continuous' | 'raster-categorical' | 'vector-line' | 'vector-polygon' | 'vector-point';

/** GFW research-vs-AOI split, hecho visible en el panel (§4.4). */
export type LayerRole = 'medicion' | 'contexto';

export type ExportFormat = 'geotiff' | 'shp' | 'geojson';

/** §0.5 — ninguna capa se computa ni falla en silencio. */
export type LayerStatus = 'pending' | 'ok' | 'empty' | 'error' | 'skipped';

export type MetricCardId =
  | 'elevacion'
  | 'pendiente'
  | 'clases-pendiente'
  | 'orientacion'
  | 'ndvi'
  | 'clases-ndvi'
  | 'worldcover'
  | 'cobertura-arborea'
  | 'hidrologia'
  | 'areas-protegidas'
  | 'inundacion-costera'
  | 'contexto-rd';

export type RampLegend = {
  type: 'ramp';
  /** Paradas de color de izquierda a derecha. */
  colors: string[];
  /** `dynamic` = min/max reales del AOI (DEM); `p98` = recorte de outliers (pendiente). */
  domain: { min: number; max: number } | 'dynamic' | 'p98';
  unit: string;
  decimals: number;
};

export type LegendClass = {
  /** Código nativo del dataset (WorldCover 10..100). Ausente en clases derivadas. */
  code?: number;
  label: string;
  color: string;
};

export type ClassLegend = {
  type: 'classes';
  classes: LegendClass[];
  /** WorldCover es disperso: sólo se listan las clases presentes en el AOI. */
  sparse: boolean;
};

export type SwatchLegend = {
  type: 'swatch';
  color: string;
  /** Relleno como fracción de la opacidad de la capa (WDPA usa 0,5; MEPyD 0,12). */
  fillFactor?: number;
  label: string;
};

export type LegendSpec = RampLegend | ClassLegend | SwatchLegend;

export type SourceRef = {
  name: string;
  provider: string;
  url: string;
  /** Vigencia o versión — columna fija de la tabla de metodología (§6.5). */
  vintage: string;
  /** Resolución espacial nativa, en texto ("30 m", "Vectorial"). */
  resolution: string;
  coverage: string;
  license: string;
  citation: string;
  /** Una frase de método, en castellano llano, para el popover ⓘ (§6.4). */
  method: string;
  caveat?: string;
};

export type PopupFieldFormat = 'number' | 'area-ha' | 'distance-m' | 'date' | 'text';

export type PopupField = {
  key: string;
  alias: string;
  format?: PopupFieldFormat;
  decimals?: number;
  /** Mapa código→etiqueta legible (kind de OSM, IUCN_CAT de WDPA). */
  valueLabels?: Record<string, string>;
};

export type FeatureProperties = Record<string, unknown>;

export type AoiContext = {
  areaHa: number;
  utmEpsg: number;
};

export type DerivedField = {
  alias: string;
  compute: (properties: FeatureProperties, aoi: AoiContext) => string;
};

/**
 * §5.2 — alias explícitos y visibilidad opt-in. Un `IUCN_CAT` o un
 * `waterway=stream` crudo no llega jamás a la pantalla.
 */
export type PopupConfig = {
  title: string;
  subtitle?: string;
  fields: PopupField[];
  derived?: DerivedField[];
  hiddenByDefault: true;
  /**
   * MEPyD trae `outFields="*"` con esquema distinto por capa (inventario §6):
   * las columnas no listadas se renderizan en una tabla defensiva de columnas
   * dinámicas, nunca como campos con alias inventado.
   */
  allowDynamicFields?: boolean;
};

/** Sub-control indentado del §4.3: cortes de clase editables por el usuario. */
export type ThresholdControl = {
  id: string;
  label: string;
  /** Cortes por defecto = los bins del motor. */
  defaults: number[];
  min: number;
  max: number;
  step: number;
  unit: string;
  help: string;
};

export type LayerDef = {
  id: string;
  label: string;
  group: string;
  /** Segundo nivel, sólo MEPyD (grupo → subgrupo → capa). */
  subgroup?: string;
  themes: ThemeId[];
  kind: LayerKind;
  role: LayerRole;
  defaultOn: boolean;
  /** El límite del AOI no se apaga: es el objeto de primera clase del §0.3. */
  alwaysOn?: boolean;
  defaultOpacity: number;
  legend: LegendSpec;
  source: SourceRef;
  popup?: PopupConfig;
  exports: ExportFormat[];
  metrics?: MetricCardId[];
  thresholds?: ThresholdControl[];
  /** ✕ en la fila: sólo capas de contexto / agregadas por el usuario (§4.3). */
  removable: boolean;
  /** Sólo se ofrece si el AOI intersecta RD_BBOX (`is_in_rd`). */
  requiresRd?: boolean;
};

export function isVectorLayer(layer: LayerDef): boolean {
  return (
    layer.kind === 'vector-line' || layer.kind === 'vector-polygon' || layer.kind === 'vector-point'
  );
}

export function isRasterLayer(layer: LayerDef): boolean {
  return layer.kind === 'raster-continuous' || layer.kind === 'raster-categorical';
}
