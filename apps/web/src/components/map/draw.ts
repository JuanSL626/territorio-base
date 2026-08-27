/*
  Dibujo del AOI: SÓLO polígono y rectángulo.

  Es la toolbar `folium.plugins.Draw` del legacy, ni una herramienta más
  (inventario §1.2a): una línea o un punto no define un área de estudio, y
  ofrecerlos sería ofrecer un camino que después falla en `loadAoiFromGeoJson`.

  El estado "dibujando" del brief §8, completo:
    · cursor de cruz,
    · vértices como círculos de 8 px,
    · el PRIMER vértice pulsa para decir "clic acá para cerrar",
    · lectura de área en ha en vivo, siguiendo el cursor,
    · Esc cancela, Backspace deshace el último vértice.

  Sin `maplibre-gl-draw`: son ~200 líneas contra una dependencia más que
  arrastra su propio CSS, su propio modelo de estilos y modos que este producto
  no ofrece.
*/

import { utmEpsgForLonLat } from '@territorio/geo/crs';
import { areaHectares } from '@territorio/geo/geometry';

import type { Feature, FeatureCollection, Position } from '@territorio/geo/geojson';
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';

export type DrawMode = 'polygon' | 'rectangle';

/** Geometría que se le entrega al resto de la app (`MapCanvasProps.onAoiDrawn`). */
export type PolygonGeometry = { type: 'Polygon'; coordinates: number[][][] };

export type DrawState = {
  mode: DrawMode;
  vertexCount: number;
  /** Área del polígono en curso, en hectáreas. `null` con menos de 3 vértices. */
  areaHa: number | null;
  /** Posición del cursor en píxeles, para el rótulo flotante de área. */
  cursor: { x: number; y: number } | null;
  /** `true` cuando el próximo clic sobre el primer vértice cierra el polígono. */
  canClose: boolean;
};

export type DrawCallbacks = {
  onState: (state: DrawState | null) => void;
  onComplete: (geometry: PolygonGeometry) => void;
  onCancel: () => void;
};

export const DRAW_SOURCE_ID = 'tb-draw';
const LAYER_FILL = 'tb-draw-fill';
const LAYER_LINE = 'tb-draw-line';
const LAYER_VERTEX = 'tb-draw-vertex';
const LAYER_FIRST = 'tb-draw-first';

/** Igual que `--accent` del §10, pero literal: este módulo no lee CSS. */
const DRAW_COLOR = '#1f6feb';

/** Radio en px del anillo que cierra el polígono al hacerle clic. */
const CLOSE_TOLERANCE_PX = 12;

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

function ring(vertices: readonly Position[]): Position[] {
  const first = vertices[0];
  if (first === undefined) return [];
  return [...vertices, first];
}

function rectangleRing(a: Position, b: Position): Position[] {
  const [ax, ay] = a as [number, number];
  const [bx, by] = b as [number, number];
  return [
    [ax, ay],
    [bx, ay],
    [bx, by],
    [ax, by],
    [ax, ay],
  ];
}

function polygonOf(coordinates: Position[]): PolygonGeometry {
  return { type: 'Polygon', coordinates: [coordinates] };
}

/** Área en ha, en la zona UTM del propio polígono (igual que el motor, §3). */
function areaOf(geometry: PolygonGeometry): number | null {
  const first = geometry.coordinates[0]?.[0];
  if (first === undefined) return null;
  const lon = first[0];
  const lat = first[1];
  if (lon === undefined || lat === undefined) return null;
  try {
    return areaHectares(geometry, utmEpsgForLonLat(lon, lat));
  } catch {
    // Un polígono degenerado (dos vértices iguales) no tiene área utilizable;
    // el rótulo muestra "—" en vez de romper el gesto de dibujo.
    return null;
  }
}

export class AoiDrawController {
  private readonly map: MapLibreMap;
  private readonly callbacks: DrawCallbacks;

  private mode: DrawMode | null = null;
  private vertices: Position[] = [];
  private hover: Position | null = null;
  private cursorPx: { x: number; y: number } | null = null;
  private rectangleAnchor: Position | null = null;
  private pulseTimer: ReturnType<typeof setInterval> | null = null;
  private pulseUp = true;

  constructor(map: MapLibreMap, callbacks: DrawCallbacks) {
    this.map = map;
    this.callbacks = callbacks;
  }

  /** Idempotente: llamarlo dos veces con el mismo modo no reinicia el dibujo. */
  start(mode: DrawMode): void {
    if (this.mode === mode) return;
    this.reset();
    this.mode = mode;
    this.ensureStyle();
    this.bind();
    this.map.getCanvas().style.cursor = 'crosshair';
    this.map.doubleClickZoom.disable();
    if (mode === 'rectangle') this.map.dragPan.disable();
    this.startPulse();
    this.emit();
  }

  stop(): void {
    if (this.mode === null) return;
    this.unbind();
    this.reset();
    this.map.getCanvas().style.cursor = '';
    this.map.doubleClickZoom.enable();
    this.map.dragPan.enable();
    this.render();
    this.callbacks.onState(null);
  }

  /** Se llama al desmontar el mapa. Después de esto el controller no sirve más. */
  destroy(): void {
    this.unbind();
    this.stopPulse();
    this.mode = null;
    this.vertices = [];
  }

  isDrawing(): boolean {
    return this.mode !== null;
  }

  /* ---------------------------------------------------------------------- */
  /* Estilo                                                                  */
  /* ---------------------------------------------------------------------- */

  /**
   * Crea (o recrea) la fuente y las capas del dibujo.
   *
   * Es idempotente porque `setStyle` — el cambio de mapa base — borra TODO el
   * estilo, y el dibujo tiene que poder rearmarse sin perder los vértices que
   * el usuario ya puso.
   */
  ensureStyle(): void {
    if (this.map.getSource(DRAW_SOURCE_ID) === undefined) {
      this.map.addSource(DRAW_SOURCE_ID, { type: 'geojson', data: EMPTY });
    }

    if (this.map.getLayer(LAYER_FILL) === undefined) {
      this.map.addLayer({
        id: LAYER_FILL,
        type: 'fill',
        source: DRAW_SOURCE_ID,
        filter: ['==', ['get', 'role'], 'area'],
        paint: { 'fill-color': DRAW_COLOR, 'fill-opacity': 0.12 },
      });
    }

    if (this.map.getLayer(LAYER_LINE) === undefined) {
      this.map.addLayer({
        id: LAYER_LINE,
        type: 'line',
        source: DRAW_SOURCE_ID,
        filter: ['==', ['get', 'role'], 'area'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': DRAW_COLOR, 'line-width': 2, 'line-dasharray': [2, 1.5] },
      });
    }

    if (this.map.getLayer(LAYER_VERTEX) === undefined) {
      this.map.addLayer({
        id: LAYER_VERTEX,
        type: 'circle',
        source: DRAW_SOURCE_ID,
        filter: ['==', ['get', 'role'], 'vertex'],
        // 8 px de diámetro = radio 4, tal cual el §8.
        paint: {
          'circle-radius': 4,
          'circle-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-stroke-color': DRAW_COLOR,
        },
      });
    }

    if (this.map.getLayer(LAYER_FIRST) === undefined) {
      this.map.addLayer({
        id: LAYER_FIRST,
        type: 'circle',
        source: DRAW_SOURCE_ID,
        filter: ['==', ['get', 'role'], 'first'],
        paint: {
          'circle-radius': 6,
          'circle-color': DRAW_COLOR,
          'circle-opacity': 0.9,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
    }

    this.render();
  }

  /*
    El pulso del primer vértice. `prefers-reduced-motion` lo apaga: es una
    señal de affordance, no información, así que quitarla no pierde nada.
  */
  private startPulse(): void {
    this.stopPulse();
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    this.pulseTimer = setInterval(() => {
      if (this.map.getLayer(LAYER_FIRST) === undefined) return;
      this.pulseUp = !this.pulseUp;
      this.map.setPaintProperty(LAYER_FIRST, 'circle-radius', this.pulseUp ? 6 : 9);
    }, 480);
  }

  private stopPulse(): void {
    if (this.pulseTimer !== null) clearInterval(this.pulseTimer);
    this.pulseTimer = null;
  }

  /* ---------------------------------------------------------------------- */
  /* Render                                                                  */
  /* ---------------------------------------------------------------------- */

  private currentRing(): Position[] {
    if (this.mode === 'rectangle') {
      const anchor = this.rectangleAnchor;
      if (anchor === null || this.hover === null) return [];
      return rectangleRing(anchor, this.hover);
    }

    const live = this.hover === null ? this.vertices : [...this.vertices, this.hover];
    return live.length >= 3 ? ring(live) : [];
  }

  private render(): void {
    const source = this.map.getSource<GeoJSONSource>(DRAW_SOURCE_ID);
    if (source === undefined) return;

    if (this.mode === null) {
      void source.setData(EMPTY);
      return;
    }

    const features: Feature[] = [];
    const shape = this.currentRing();
    if (shape.length >= 4) {
      features.push({
        type: 'Feature',
        properties: { role: 'area' },
        geometry: polygonOf(shape),
      });
    }

    this.vertices.forEach((position, index) => {
      features.push({
        type: 'Feature',
        properties: { role: index === 0 && this.vertices.length >= 3 ? 'first' : 'vertex' },
        geometry: { type: 'Point', coordinates: position },
      });
    });

    void source.setData({ type: 'FeatureCollection', features });
  }

  private emit(): void {
    if (this.mode === null) {
      this.callbacks.onState(null);
      return;
    }

    const shape = this.currentRing();
    const areaHa = shape.length >= 4 ? areaOf(polygonOf(shape)) : null;

    this.callbacks.onState({
      mode: this.mode,
      vertexCount: this.vertices.length,
      areaHa,
      cursor: this.cursorPx,
      canClose: this.mode === 'polygon' && this.vertices.length >= 3,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Eventos                                                                 */
  /* ---------------------------------------------------------------------- */

  private readonly onClick = (event: MapMouseEvent): void => {
    if (this.mode !== 'polygon') return;
    const position: Position = [event.lngLat.lng, event.lngLat.lat];

    if (this.vertices.length >= 3 && this.isNearFirst(event)) {
      this.complete(ring(this.vertices));
      return;
    }

    this.vertices.push(position);
    this.render();
    this.emit();
  };

  private readonly onDoubleClick = (event: MapMouseEvent): void => {
    if (this.mode !== 'polygon') return;
    event.preventDefault();
    if (this.vertices.length >= 3) this.complete(ring(this.vertices));
  };

  private readonly onMouseMove = (event: MapMouseEvent): void => {
    if (this.mode === null) return;
    this.hover = [event.lngLat.lng, event.lngLat.lat];
    this.cursorPx = { x: event.point.x, y: event.point.y };
    this.render();
    this.emit();
  };

  private readonly onMouseDown = (event: MapMouseEvent): void => {
    if (this.mode !== 'rectangle') return;
    event.preventDefault();
    this.rectangleAnchor = [event.lngLat.lng, event.lngLat.lat];
    this.hover = this.rectangleAnchor;
    this.render();
    this.emit();
  };

  private readonly onMouseUp = (event: MapMouseEvent): void => {
    if (this.mode !== 'rectangle') return;
    const anchor = this.rectangleAnchor;
    if (anchor === null) return;
    const corner: Position = [event.lngLat.lng, event.lngLat.lat];
    this.rectangleAnchor = null;

    const shape = rectangleRing(anchor, corner);
    const area = areaOf(polygonOf(shape));
    // Un "rectángulo" de un solo clic sin arrastre no es un AOI: se ignora en
    // vez de mandar un polígono degenerado al análisis.
    if (area === null || area <= 0) {
      this.hover = null;
      this.render();
      this.emit();
      return;
    }
    this.complete(shape);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.mode === null) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      this.stop();
      this.callbacks.onCancel();
      return;
    }

    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      this.vertices.pop();
      this.render();
      this.emit();
      return;
    }

    // Enter cierra el polígono sin obligar a apuntarle al primer vértice: el
    // §8 pide que el gesto también sea alcanzable desde el teclado.
    if (event.key === 'Enter' && this.mode === 'polygon' && this.vertices.length >= 3) {
      event.preventDefault();
      this.complete(ring(this.vertices));
    }
  };

  private isNearFirst(event: MapMouseEvent): boolean {
    const first = this.vertices[0];
    if (first === undefined) return false;
    const lon = first[0];
    const lat = first[1];
    if (lon === undefined || lat === undefined) return false;
    const projected = this.map.project([lon, lat]);
    const dx = projected.x - event.point.x;
    const dy = projected.y - event.point.y;
    return Math.hypot(dx, dy) <= CLOSE_TOLERANCE_PX;
  }

  private complete(shape: Position[]): void {
    const geometry = polygonOf(shape);
    this.stop();
    this.callbacks.onComplete(geometry);
  }

  private bind(): void {
    this.map.on('click', this.onClick);
    this.map.on('dblclick', this.onDoubleClick);
    this.map.on('mousemove', this.onMouseMove);
    this.map.on('mousedown', this.onMouseDown);
    this.map.on('mouseup', this.onMouseUp);
    if (typeof window !== 'undefined') window.addEventListener('keydown', this.onKeyDown);
  }

  private unbind(): void {
    this.map.off('click', this.onClick);
    this.map.off('dblclick', this.onDoubleClick);
    this.map.off('mousemove', this.onMouseMove);
    this.map.off('mousedown', this.onMouseDown);
    this.map.off('mouseup', this.onMouseUp);
    if (typeof window !== 'undefined') window.removeEventListener('keydown', this.onKeyDown);
    this.stopPulse();
  }

  private reset(): void {
    this.mode = null;
    this.vertices = [];
    this.hover = null;
    this.cursorPx = null;
    this.rectangleAnchor = null;
  }
}
