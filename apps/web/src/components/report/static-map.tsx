import type { ReportMapState } from './report-model';
import type { Geometry } from '@territorio/geo';
import type { LegendClass, LayerDef } from '~/layers/types';
import type {
  HydrologyFeatureGeo,
  MepydLayerGeo,
  ProtectedAreaGeo,
  TerritorioAnalysis,
} from '~/lib/analysis-contract';
import type { Bbox } from '~/lib/search-params';

import { AOI_OUTLINE_COLOR, HYDROLOGY_CLASSES, WDPA_COLOR } from '~/layers/palettes';
import { getLayer } from '~/layers/registry';
import { formatNumber } from '~/lib/format';

/**
 * MAPA ESTÁTICO EN SVG — el mapa del reporte.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ SVG Y NO UN CANVAS GL
 * ─────────────────────────────────────────────────────────────────────────────
 * §6.6 es explícito: **no se imprime la página GL viva**. Esri sigue sacando
 * cajas grises en blanco pasados ~16 mapas vivos por pasada de impresión, y un
 * reporte de 8 secciones con un mapa cada una entra justo en esa zona. Este
 * componente dibuja las mismas geometrías que el mapa interactivo con `<path>`:
 * sale idéntico en pantalla, en PDF y en papel, no pide una sola petición de
 * red, y no depende de que el navegador tenga WebGL.
 *
 * En pantalla ancha el mapa pegajoso puede ser el mapa GL cuando exista; en
 * móvil (§9) y en `/imprimir` este SVG es la respuesta correcta, no un
 * reemplazo pobre.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REGRESIONES DEL INVENTARIO QUE ESTE ARCHIVO TIENE QUE RESPETAR
 * ─────────────────────────────────────────────────────────────────────────────
 * · #1 (rasters espejados): la proyección va de lon/lat a Mercator y **invierte
 *   Y explícitamente** (`y` crece hacia el sur en SVG, la latitud crece hacia el
 *   norte). Verificado contra la convención de bounds, no heredado.
 * · #4 (polígonos de amenaza ilegibles): relleno bajo + borde fuerte, y el
 *   estilo se calcula DENTRO de la iteración, sin closures tardíos.
 * · #5 (puntos como pines default): los puntos son círculos coloreados por
 *   capa, nunca marcadores genéricos.
 * · #7 (un color por grupo): el color sale del `legend.color` de CADA capa del
 *   registro, que ya está ciclado por capa.
 */

/* -------------------------------------------------------------------------- */
/* Proyección                                                                  */
/* -------------------------------------------------------------------------- */

/** Lienzo fijo 1600×1000 — el mismo tamaño que pide §6.6 para el PNG impreso. */
const VIEW_W = 1600;
const VIEW_H = 1000;
const PAD = 28;

type Projector = (lon: number, lat: number) => [number, number];

type Projection = {
  project: Projector;
  /** Metros → unidades del lienzo. Es lo que hace exacta la barra de escala. */
  metersToUnits: (meters: number) => number;
};

const EARTH_RADIUS_M = 6_378_137;

function mercatorX(lon: number): number {
  return (lon * Math.PI) / 180;
}

/**
 * Mercator esférica, en las MISMAS unidades que `mercatorX` (radianes sobre la
 * esfera unitaria). Mezclar grados en X con logaritmos en Y —que es lo natural
 * si uno escribe `x = lon` y `y = ln(tan(...))`— aplasta el mapa a una banda:
 * las dos escalas difieren en dos órdenes de magnitud y el `min()` del ajuste
 * se queda con la de X.
 */
function mercatorY(lat: number): number {
  const clamped = Math.max(Math.min(lat, 85), -85);
  const rad = (clamped * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + rad / 2));
}

/**
 * Encaja `bounds` en el lienzo manteniendo la relación de aspecto (contain).
 * El AOI nunca sale deformado y el sobrante queda como margen simétrico.
 */
function makeProjection(bounds: Bbox): Projection {
  const [minLon, minLat, maxLon, maxLat] = bounds;
  const x0 = mercatorX(minLon);
  const x1 = mercatorX(maxLon);
  const y0 = mercatorY(minLat);
  const y1 = mercatorY(maxLat);

  const spanX = Math.max(x1 - x0, 1e-9);
  const spanY = Math.max(y1 - y0, 1e-9);

  const innerW = VIEW_W - PAD * 2;
  const innerH = VIEW_H - PAD * 2;
  const scale = Math.min(innerW / spanX, innerH / spanY);

  const offsetX = PAD + (innerW - spanX * scale) / 2;
  const offsetY = PAD + (innerH - spanY * scale) / 2;

  const midLatRad = (((minLat + maxLat) / 2) * Math.PI) / 180;
  const cosLat = Math.max(Math.cos(midLatRad), 0.01);

  return {
    project: (lon, lat) => {
      const x = offsetX + (mercatorX(lon) - x0) * scale;
      // Y invertida a propósito: la latitud crece al norte y la `y` del SVG
      // crece al sur. Verificado contra la convención de bounds, no heredado
      // (regresión #1 del inventario).
      const y = offsetY + (y1 - mercatorY(lat)) * scale;
      return [x, y];
    },
    metersToUnits: (meters) => (meters / (EARTH_RADIUS_M * cosLat)) * scale,
  };
}

/* -------------------------------------------------------------------------- */
/* Geometría → path                                                            */
/* -------------------------------------------------------------------------- */

function ringPath(ring: readonly (readonly number[])[], project: Projector): string {
  let path = '';
  for (const [index, position] of ring.entries()) {
    const lon = position[0];
    const lat = position[1];
    if (lon === undefined || lat === undefined) continue;
    const [x, y] = project(lon, lat);
    path += `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return path === '' ? '' : `${path}Z`;
}

function linePath(line: readonly (readonly number[])[], project: Projector): string {
  let path = '';
  for (const [index, position] of line.entries()) {
    const lon = position[0];
    const lat = position[1];
    if (lon === undefined || lat === undefined) continue;
    const [x, y] = project(lon, lat);
    path += `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return path;
}

type Drawn = { paths: string[]; points: [number, number][] };

/** Aplana cualquier geometría GeoJSON a paths + puntos, sin perder nada. */
function drawGeometry(geometry: Geometry, project: Projector, into: Drawn): Drawn {
  switch (geometry.type) {
    case 'Point': {
      const lon = geometry.coordinates[0];
      const lat = geometry.coordinates[1];
      if (lon !== undefined && lat !== undefined) into.points.push(project(lon, lat));
      break;
    }
    case 'MultiPoint':
      for (const position of geometry.coordinates) {
        const lon = position[0];
        const lat = position[1];
        if (lon !== undefined && lat !== undefined) into.points.push(project(lon, lat));
      }
      break;
    case 'LineString': {
      const path = linePath(geometry.coordinates, project);
      if (path !== '') into.paths.push(path);
      break;
    }
    case 'MultiLineString':
      for (const line of geometry.coordinates) {
        const path = linePath(line, project);
        if (path !== '') into.paths.push(path);
      }
      break;
    case 'Polygon': {
      const path = geometry.coordinates.map((ring) => ringPath(ring, project)).join('');
      if (path !== '') into.paths.push(path);
      break;
    }
    case 'MultiPolygon':
      for (const polygon of geometry.coordinates) {
        const path = polygon.map((ring) => ringPath(ring, project)).join('');
        if (path !== '') into.paths.push(path);
      }
      break;
    case 'GeometryCollection':
      for (const child of geometry.geometries) drawGeometry(child, project, into);
      break;
  }
  return into;
}

function shapeOf(geometry: Geometry, project: Projector): Drawn {
  return drawGeometry(geometry, project, { paths: [], points: [] });
}

/* -------------------------------------------------------------------------- */
/* Estilo por capa                                                             */
/* -------------------------------------------------------------------------- */

type ShapeStyle = {
  stroke: string;
  strokeWidth: number;
  fill: string;
  fillOpacity: number;
  pointRadius: number;
};

/**
 * El estilo de una capa vectorial, derivado del registro.
 *
 * Los polígonos usan relleno bajo (0,12 de la opacidad) y borde grueso: es la
 * corrección de la regresión #4, donde tres capas de "Amenazas" superpuestas a
 * 0,34 de relleno se mezclaban en un blob rosa que no coincidía con ninguna
 * entrada de la leyenda.
 */
function styleFor(layer: LayerDef, highlighted: boolean): ShapeStyle {
  const color =
    layer.legend.type === 'swatch'
      ? layer.legend.color
      : layer.legend.type === 'classes'
        ? (layer.legend.classes[0]?.color ?? AOI_OUTLINE_COLOR)
        : (layer.legend.colors.at(-1) ?? AOI_OUTLINE_COLOR);

  const fillFactor =
    layer.legend.type === 'swatch' ? (layer.legend.fillFactor ?? 0.2) : 0.2;

  return {
    stroke: color,
    strokeWidth: highlighted ? 4 : layer.kind === 'vector-polygon' ? 2.5 : 2,
    fill: layer.kind === 'vector-line' ? 'none' : color,
    fillOpacity: highlighted ? Math.min(fillFactor * 2, 0.55) : fillFactor,
    pointRadius: highlighted ? 6 : 4,
  };
}

/* -------------------------------------------------------------------------- */
/* Escala                                                                      */
/* -------------------------------------------------------------------------- */

const NICE_SCALE_M = [50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000];

/**
 * Barra de escala calculada con la escala REAL de la proyección, no con el
 * ancho del bbox: con ajuste "contain" el bbox casi nunca ocupa todo el lienzo,
 * y una barra derivada del ancho miente por el factor del letterbox.
 */
function scaleBar(projection: Projection): { widthUnits: number; label: string } | null {
  const oneKm = projection.metersToUnits(1000);
  if (!Number.isFinite(oneKm) || oneKm <= 0) return null;

  const targetUnits = (VIEW_W - PAD * 2) / 4;
  const chosen =
    NICE_SCALE_M.find((step) => projection.metersToUnits(step) >= targetUnits) ??
    NICE_SCALE_M.at(-1) ??
    1000;

  const widthUnits = projection.metersToUnits(chosen);
  if (!Number.isFinite(widthUnits) || widthUnits <= 0) return null;

  return {
    widthUnits,
    label: chosen >= 1000 ? `${formatNumber(chosen / 1000, 0)} km` : `${formatNumber(chosen, 0)} m`,
  };
}

/* -------------------------------------------------------------------------- */
/* Componente                                                                  */
/* -------------------------------------------------------------------------- */

export type StaticMapGeometries = {
  aoi: TerritorioAnalysis['aoi_geometry'] | null;
  hydrology: readonly HydrologyFeatureGeo[];
  protectedAreas: readonly ProtectedAreaGeo[];
  mepyd: readonly MepydLayerGeo[];
};

export const EMPTY_GEOMETRIES: StaticMapGeometries = {
  aoi: null,
  hydrology: [],
  protectedAreas: [],
  mepyd: [],
};

export function geometriesOf(analysis: TerritorioAnalysis): StaticMapGeometries {
  return {
    aoi: analysis.aoi_geometry,
    hydrology: analysis.hydrology.features,
    protectedAreas: analysis.protected_areas.areas,
    mepyd: analysis.mepyd_rd.layers,
  };
}

export type StaticMapProps = {
  state: ReportMapState;
  geometries: StaticMapGeometries;
  /** Texto alternativo. Sale del `caption` del estado más lo que se dibujó. */
  title: string;
  className?: string;
};

const HYDRO_COLOR: Record<string, string> = {
  waterway: HYDROLOGY_CLASSES[0]?.color ?? '#1f78b4',
  water_body: HYDROLOGY_CLASSES[1]?.color ?? '#08519c',
  wetland: HYDROLOGY_CLASSES[2]?.color ?? '#41b6c4',
};

export function StaticMap({ state, geometries, title, className }: StaticMapProps) {
  const { project, metersToUnits } = makeProjection(state.bounds);
  const active = new Set(state.layers);
  const bar = scaleBar({ project, metersToUnits });

  const showHydro = active.has('osm-hydro');
  const showProtected = active.has('wdpa');
  const highlightProtected = state.highlight.includes('wdpa:*');
  const mepydLayers = geometries.mepyd.filter((layer) => active.has(layer.layer_id));

  const aoiShape = geometries.aoi === null ? null : shapeOf(geometries.aoi, project);

  return (
    <figure className={className}>
      <svg
        viewBox={`0 0 ${String(VIEW_W)} ${String(VIEW_H)}`}
        role="img"
        aria-label={title}
        preserveAspectRatio="xMidYMid meet"
        className="bg-surface-3 h-full w-full"
      >
        <defs>
          <pattern id="grid-graticule" width="80" height="80" patternUnits="userSpaceOnUse">
            <path
              d="M80 0H0V80"
              fill="none"
              stroke="var(--border)"
              strokeWidth="1"
              opacity="0.7"
            />
          </pattern>
        </defs>
        <rect width={VIEW_W} height={VIEW_H} fill="url(#grid-graticule)" />

        {/* Relleno tenue del AOI: da contexto sin competir con los datos. */}
        {aoiShape === null
          ? null
          : aoiShape.paths.map((path, index) => (
              <path
                key={`aoi-fill-${String(index)}`}
                d={path}
                fill={AOI_OUTLINE_COLOR}
                fillOpacity={0.06}
                stroke="none"
              />
            ))}

        {/* Hidrología — un color por tipo, sólo los tipos presentes (§4). */}
        {showHydro
          ? geometries.hydrology.map((feature) => {
              // Estilo calculado DENTRO de la iteración (regresión #4).
              const color = HYDRO_COLOR[feature.kind] ?? '#1f78b4';
              const shape = shapeOf(feature.geometry, project);
              const isArea = feature.kind !== 'waterway';
              const key = `hydro-${String(feature.osm_id)}`;
              const highlighted = state.highlight.includes(`osm-hydro:${String(feature.osm_id)}`);
              return (
                <g key={key}>
                  {shape.paths.map((path, index) => (
                    <path
                      key={`${key}-${String(index)}`}
                      d={path}
                      fill={isArea ? color : 'none'}
                      fillOpacity={isArea ? 0.35 : 0}
                      stroke={color}
                      strokeWidth={highlighted ? 5 : 3}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  ))}
                  {shape.points.map((point, index) => (
                    <circle
                      key={`${key}-p-${String(index)}`}
                      cx={point[0]}
                      cy={point[1]}
                      r={highlighted ? 6 : 4}
                      fill={color}
                    />
                  ))}
                </g>
              );
            })
          : null}

        {/* Áreas protegidas — relleno = opacidad × 0,5, igual que el legacy. */}
        {showProtected
          ? geometries.protectedAreas.map((area, areaIndex) => {
              const shape = shapeOf(area.geometry, project);
              const highlighted = highlightProtected && area.overlap_ha > 0;
              const key = `wdpa-${String(areaIndex)}`;
              return (
                <g key={key}>
                  {shape.paths.map((path, index) => (
                    <path
                      key={`${key}-${String(index)}`}
                      d={path}
                      fill={WDPA_COLOR}
                      fillOpacity={highlighted ? 0.45 : 0.25}
                      stroke={WDPA_COLOR}
                      strokeWidth={highlighted ? 4 : 2}
                      strokeLinejoin="round"
                    />
                  ))}
                </g>
              );
            })
          : null}

        {/* MEPyD — un color POR CAPA (regresión #7), puntos como círculos (#5). */}
        {mepydLayers.map((layer) => {
          const def = getLayer(layer.layer_id);
          if (def === undefined) return null;
          const style = styleFor(def, state.highlight.includes(layer.layer_id));
          return (
            <g key={layer.layer_id}>
              {layer.features.map((feature, featureIndex) => {
                const shape = shapeOf(feature.geometry, project);
                const key = `${layer.layer_id}-${String(featureIndex)}`;
                return (
                  <g key={key}>
                    {shape.paths.map((path, index) => (
                      <path
                        key={`${key}-${String(index)}`}
                        d={path}
                        fill={style.fill}
                        fillOpacity={style.fill === 'none' ? 0 : style.fillOpacity}
                        stroke={style.stroke}
                        strokeWidth={style.strokeWidth}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                    ))}
                    {shape.points.map((point, index) => (
                      <circle
                        key={`${key}-p-${String(index)}`}
                        cx={point[0]}
                        cy={point[1]}
                        r={style.pointRadius}
                        fill={style.stroke}
                        fillOpacity={0.9}
                      />
                    ))}
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* El límite del AOI SIEMPRE arriba: es el objeto de primera clase (§0.3). */}
        {aoiShape === null
          ? null
          : aoiShape.paths.map((path, index) => (
              <path
                key={`aoi-line-${String(index)}`}
                d={path}
                fill="none"
                stroke={AOI_OUTLINE_COLOR}
                strokeWidth={3}
                strokeLinejoin="round"
              />
            ))}

        {/* Norte y escala: sin ellos esto es un dibujo, no un mapa. */}
        {/*
          Norte y escala dimensionados para el LIENZO de 1600×1000: un texto de
          18 unidades queda en 8 px cuando el SVG se reduce a la columna, que es
          ilegible en pantalla y peor en papel.
        */}
        <g transform={`translate(${String(VIEW_W - 78)}, 34)`} aria-hidden="true">
          <path d="M0 40 L15 0 L30 40 L15 29 Z" fill="var(--fg-muted)" />
          <text x="15" y="68" textAnchor="middle" fontSize="30" fill="var(--fg-muted)">
            N
          </text>
        </g>

        {bar === null ? null : (
          <g transform={`translate(${String(PAD)}, ${String(VIEW_H - 52)})`} aria-hidden="true">
            <rect x="0" y="0" width={bar.widthUnits} height="9" fill="var(--fg-muted)" />
            <rect x="0" y="-6" width="3" height="21" fill="var(--fg-muted)" />
            <rect x={bar.widthUnits - 3} y="-6" width="3" height="21" fill="var(--fg-muted)" />
            <text x="0" y="42" fontSize="30" fill="var(--fg-muted)">
              {bar.label}
            </text>
          </g>
        )}
      </svg>
    </figure>
  );
}

/** Leyenda del mapa del reporte: las capas activas de ese paso, con su swatch. */
export function StaticMapLegend({ state }: { state: ReportMapState }) {
  const entries: { id: string; label: string; classes: LegendClass[]; color?: string }[] = [];

  for (const id of state.layers) {
    const layer = getLayer(id);
    if (layer === undefined) continue;
    if (layer.legend.type === 'classes') {
      entries.push({ id, label: layer.label, classes: layer.legend.classes });
    } else if (layer.legend.type === 'swatch') {
      entries.push({ id, label: layer.label, classes: [], color: layer.legend.color });
    } else {
      entries.push({ id, label: layer.label, classes: [], color: layer.legend.colors.at(-1) });
    }
  }

  if (entries.length === 0) return null;

  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {entries.map((entry) => (
        <li key={entry.id} className="text-11 text-fg-muted flex items-center gap-1.5">
          {entry.classes.length > 0 ? (
            <span aria-hidden="true" className="flex gap-0.5">
              {entry.classes.slice(0, 4).map((item) => (
                <span
                  key={item.label}
                  className="block h-2.5 w-2.5 rounded-[2px]"
                  style={{ backgroundColor: item.color }}
                />
              ))}
            </span>
          ) : (
            <span
              aria-hidden="true"
              className="block h-2.5 w-2.5 rounded-[2px]"
              style={{ backgroundColor: entry.color ?? 'var(--border-strong)' }}
            />
          )}
          {entry.label}
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Extensiones                                                                 */
/* -------------------------------------------------------------------------- */

function walkPositions(geometry: Geometry, visit: (lon: number, lat: number) => void): void {
  switch (geometry.type) {
    case 'Point': {
      const lon = geometry.coordinates[0];
      const lat = geometry.coordinates[1];
      if (lon !== undefined && lat !== undefined) visit(lon, lat);
      break;
    }
    case 'MultiPoint':
    case 'LineString':
      for (const position of geometry.coordinates) {
        const lon = position[0];
        const lat = position[1];
        if (lon !== undefined && lat !== undefined) visit(lon, lat);
      }
      break;
    case 'MultiLineString':
    case 'Polygon':
      for (const part of geometry.coordinates) {
        for (const position of part) {
          const lon = position[0];
          const lat = position[1];
          if (lon !== undefined && lat !== undefined) visit(lon, lat);
        }
      }
      break;
    case 'MultiPolygon':
      for (const polygon of geometry.coordinates) {
        for (const ring of polygon) {
          for (const position of ring) {
            const lon = position[0];
            const lat = position[1];
            if (lon !== undefined && lat !== undefined) visit(lon, lat);
          }
        }
      }
      break;
    case 'GeometryCollection':
      for (const child of geometry.geometries) walkPositions(child, visit);
      break;
  }
}

/** Extensión de una geometría. Alimenta las acciones de mapa del §6.3. */
export function geometryBbox(geometry: Geometry): Bbox | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  walkPositions(geometry, (lon, lat) => {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  });

  if (!Number.isFinite(minLon) || !Number.isFinite(minLat)) return null;
  return [minLon, minLat, maxLon, maxLat];
}

export function unionBbox(a: Bbox, b: Bbox): Bbox {
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3]),
  ];
}
