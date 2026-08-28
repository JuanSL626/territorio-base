import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import 'maplibre-gl/dist/maplibre-gl.css';

import { AoiUpload } from './aoi-upload';
import { basemapStyle } from './basemaps';
import { AoiDrawController, type DrawMode, type DrawState, type PolygonGeometry } from './draw';
import { buildCandidates, buildInspectorFeature, type FeatureHit } from './inspector-model';
import { FEATURE_ID_KEY, highlightSpecs } from './layer-style';
import { LayerSyncer, type DesiredLayer } from './layer-sync';
import { BasemapSwitcher, DrawingHud, MapReadout } from './map-hud';
import {
  fetchOverlayPlacement,
  overlayRefs,
  type OverlayPlacement,
  type RasterOverlayRef,
} from './overlays';
import { formatCoordinates, scaleBar, type ScaleBar } from './scale';
import { buildVectorData } from './vector-data';

import type { Aoi } from '@territorio/geo/aoi';
import type { Bounds2D } from '@territorio/geo/geojson';
import type { Map as MapLibreMap, MapMouseEvent, Subscription } from 'maplibre-gl';
import type { LayerRuntime } from '~/components/layers/layer-row';
import type { LegendPresence } from '~/components/layers/legend-model';
import type { InspectorCandidate, InspectorFeature } from '~/components/layout/inspector';
import type { MapTool } from '~/components/layout/map-toolbar';
import type { LayerDef } from '~/layers/types';
import type { BasemapId } from '~/layers/vistas';
import type { TerritorioAnalysis } from '~/lib/analysis-contract';
import type { Bbox, Selection } from '~/lib/search-params';

import { buildLayerRuntime } from '~/components/layers/layer-runtime';
import { LegendStack } from '~/components/layers/legend-stack';
import { OSM_HYDRO_KIND_LABELS, WORLDCOVER_CLASSES } from '~/layers/palettes';
import { getLayer, LAYER_REGISTRY } from '~/layers/registry';
import { useMediaQuery } from '~/lib/use-media-query';

/*
  EL MAPA. La página ES esto (principio 1 del brief); los paneles se le acoplan.

  Reparto de responsabilidades — este archivo cablea, no decide:
    · `basemaps.ts`      qué mapas base hay (todos SIN API key).
    · `layer-style.ts`   cómo se ve un dato (regresiones #4, #5, #7).
    · `layer-sync.ts`    qué se agrega/quita/actualiza (rendimiento).
    · `overlays.ts`      dónde va un PNG del servicio (REGRESIÓN #1).
    · `vector-data.ts`   qué GeoJSON le corresponde a cada capa.
    · `inspector-model.ts` qué se muestra de un feature (§5.2, alias opt-in).
    · `draw.ts`          el AOI dibujado (polígono y rectángulo, nada más).

  Tres cosas que NO se pueden aflojar acá:

  1. **La identidad de capa es estructural** (§12.6, §13). El click se ata a
     los ids de capa que ESTE componente registró (`map.on('click', ids, …)`)
     y cada hit se traduce a una capa del registro con la tabla del syncer.
     No existe un hit-test global que después adivine de qué capa vino.

  2. **La orientación del raster no se re-deriva.** Las esquinas del overlay
     llegan del servicio ya verificadas y se pasan tal cual. Ver el bloque de
     regresión #1 arriba de `overlays.ts` antes de tocar nada de esto.

  3. **Prender y apagar capas es 100 % cliente** (regresión #6). Nada de lo
     que hace este componente vuelve al servidor.
*/

export type MapPadding = { top: number; right: number; bottom: number; left: number };

export type { PolygonGeometry } from './draw';

export type MapInspectorState = {
  candidates: InspectorCandidate[];
  feature: InspectorFeature | null;
};

export type MapController = {
  /** Drill-down de la pila de resultados de un click en varias capas (§5.1). */
  pickLayer: (layerId: string) => void;
  back: () => void;
  zoomToSelection: () => void;
  zoomToAoi: () => void;
  /** Resalta sin seleccionar: el hover del teclado sobre la lista de resultados. */
  previewLayer: (layerId: string | null) => void;
  /**
   * Todos los elementos de una capa dentro del AOI, ya pasados por el mismo
   * constructor que usa el inspector (§5.3, "Capa: {x} — N elementos").
   *
   * Vive acá y no en la ruta porque el GeoJSON por capa ya está construido y
   * memoizado en este componente: recalcularlo afuera duplicaría en memoria
   * las geometrías MEPyD, que son megabytes.
   */
  tableFor: (layerId: string, limit: number) => LayerTable | null;
};

export type LayerTable = {
  layerId: string;
  layerLabel: string;
  /** Puede ser mayor que `rows.length` (ver `LAYER_TABLE_LIMIT`). */
  total: number;
  rows: InspectorFeature[];
};

export type MapCanvasProps = {
  basemap: BasemapId;
  visibleLayers: readonly string[];
  opacity: Readonly<Record<string, number>>;
  aoiId: string | undefined;
  bbox: Bbox | null;
  selection: Selection | null;
  padding: MapPadding;
  drawing: boolean;
  onSelect: (selection: Selection | null) => void;
  onBboxChange: (bbox: Bbox) => void;
  onAoiDrawn: (geometry: PolygonGeometry) => void;

  // Todo lo de abajo es OPCIONAL: el shell existente compila sin tocarlo.

  /** El resultado que pinta el mapa. `null` = todavía no hay análisis. */
  analysis?: TerritorioAnalysis | null;
  /** Ver `publicRasterBaseUrl()` en `~/lib/api.ts` para cuándo no hay base pública. */
  rasterBaseUrl?: string;
  drawMode?: DrawMode;
  tool?: MapTool | null;
  onToolDone?: () => void;
  onBasemapChange?: (next: BasemapId) => void;
  onAoiUploaded?: (aoi: Aoi) => void;
  onAoiError?: (message: string) => void;
  onInspect?: (state: MapInspectorState) => void;
  onLayerStatus?: (runtime: Readonly<Record<string, LayerRuntime>>) => void;
  onReady?: (controller: MapController) => void;
  /** Móvil: leyenda colapsada y sin lectura de coordenadas (§9). */
  compact?: boolean;
  /**
   * Etiqueta de la barra de escala del viewport actual. La consume el cúmulo
   * inferior izquierdo del §2, que vive FUERA del canvas y por lo tanto no
   * puede calcularla: antes estaba hardcodeada a `— m`.
   */
  onScaleChange?: (label: string) => void;
};

/** Centro y zoom del mapa de dibujo del legacy (inventario §1.2a). */
const DEFAULT_CENTER: [number, number] = [-69.571, 18.453];
const DEFAULT_ZOOM = 13;

const REGISTRY_INDEX = new Map(LAYER_REGISTRY.map((layer, index) => [layer.id, index]));

function cacheKeyOf(ref: RasterOverlayRef): string {
  return `${ref.layerId}|${ref.pngUrl ?? ''}`;
}

function boundsOf(geometry: { coordinates: unknown }): Bounds2D | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const walk = (node: unknown): void => {
    if (!Array.isArray(node)) return;
    const x: unknown = node[0];
    const y: unknown = node[1];
    if (typeof x === 'number' && typeof y === 'number') {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      return;
    }
    for (const child of node) walk(child);
  };

  walk(geometry.coordinates);
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}

export function MapCanvas(props: MapCanvasProps) {
  const {
    basemap,
    visibleLayers,
    opacity,
    bbox,
    selection,
    padding,
    drawing,
    onSelect,
    onBboxChange,
    onAoiDrawn,
    analysis = null,
    rasterBaseUrl,
    drawMode = 'polygon',
    tool = null,
    onToolDone,
    onBasemapChange,
    onAoiUploaded,
    onAoiError,
    onInspect,
    onLayerStatus,
    onReady,
    compact = false,
    onScaleChange,
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const syncerRef = useRef<LayerSyncer | null>(null);
  const drawRef = useRef<AoiDrawController | null>(null);

  /*
    Refs de "último valor". El mapa vive FUERA de React: sus handlers se
    registran una vez y sobreviven a cientos de renders; si leyeran los props
    por clausura verían los de la primera pintada. Se escriben en un efecto sin
    lista de dependencias — o sea, después de cada commit y antes de cualquier
    otro efecto de este componente — porque escribir un ref durante el render
    rompe el modo concurrente.
  */
  const paddingRef = useRef(padding);
  const inspectRef = useRef(onInspect);
  const selectRef = useRef(onSelect);
  const vectorDataRef = useRef<ReturnType<typeof buildVectorData> | null>(null);
  const aoiContextRef = useRef<{ areaHa: number; utmEpsg: number }>({ areaHa: 0, utmEpsg: 0 });
  const initialRef = useRef({ basemap, dark: false });
  /** Estilo REALMENTE aplicado al mapa; evita un `setStyle` inicial redundante. */
  const appliedStyleRef = useRef<{ basemap: BasemapId; dark: boolean } | null>(null);
  const onAoiDrawnRef = useRef(onAoiDrawn);
  const onBboxChangeRef = useRef(onBboxChange);
  const onToolDoneRef = useRef(onToolDone);
  const onReadyRef = useRef(onReady);
  const selectionRef = useRef(selection);
  const aoiGeometryRef = useRef<TerritorioAnalysis['aoi_geometry'] | null>(null);

  const [ready, setReady] = useState(false);
  /** Cambia con cada `setStyle`: fuerza a rearmar todo lo que el estilo borró. */
  const [styleEpoch, setStyleEpoch] = useState(0);
  const [drawState, setDrawState] = useState<DrawState | null>(null);
  const [placements, setPlacements] = useState<Readonly<Record<string, OverlayPlacement>>>({});
  /**
   * Ubicaciones ya resueltas, por `layerId|url`. Es un espejo de `placements`
   * en un ref para poder consultarlo desde el efecto sin meterlo en las
   * dependencias (y provocar un bucle). Ver el comentario del efecto.
   */
  const placementCacheRef = useRef(new Map<string, OverlayPlacement>());
  /**
   * UN `AbortController` por MONTAJE, no uno por corrida del efecto.
   *
   * Se re-crea dentro del efecto de montaje y no en el `useRef`: en modo
   * estricto React monta, desmonta y vuelve a montar, y el `abort()` de esa
   * limpieza dejaba el controller inutilizable para siempre — todas las
   * peticiones posteriores salían ya canceladas y ningún overlay se ubicaba.
   */
  const overlayAbortRef = useRef(new AbortController());
  const visibleLayersRef = useRef(visibleLayers);
  const overlaysRef = useRef<ReturnType<typeof overlayRefs> | null>(null);
  const [cursor, setCursor] = useState<string>(
    formatCoordinates(DEFAULT_CENTER[0], DEFAULT_CENTER[1]),
  );
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [scale, setScale] = useState<ScaleBar>(() => scaleBar(DEFAULT_CENTER[1], DEFAULT_ZOOM));

  const dark = useMediaQuery('(prefers-color-scheme: dark)');

  // Datos derivados, memoizados: su IDENTIDAD es la señal de cambio.
  const vectorData = useMemo(() => buildVectorData(analysis), [analysis]);
  const overlays = useMemo(() => overlayRefs(analysis, rasterBaseUrl), [analysis, rasterBaseUrl]);
  const aoiGeometry = analysis?.aoi_geometry ?? null;
  const aoiContext = useMemo(
    () =>
      analysis === null
        ? { areaHa: 0, utmEpsg: 0 }
        : { areaHa: analysis.aoi.area_ha, utmEpsg: analysis.aoi.utm_epsg },
    [analysis],
  );

  /* Sincroniza los refs de "último valor" en cada commit, antes que cualquier
     otro efecto de este componente (van en orden de declaración). */
  useEffect(() => {
    paddingRef.current = padding;
    inspectRef.current = onInspect;
    selectRef.current = onSelect;
    vectorDataRef.current = vectorData;
    aoiContextRef.current = aoiContext;
    initialRef.current = { basemap, dark };
    onAoiDrawnRef.current = onAoiDrawn;
    onBboxChangeRef.current = onBboxChange;
    onToolDoneRef.current = onToolDone;
    onReadyRef.current = onReady;
    selectionRef.current = selection;
    aoiGeometryRef.current = aoiGeometry;
    visibleLayersRef.current = visibleLayers;
    overlaysRef.current = overlays;
  });

  const desired = useMemo<DesiredLayer[]>(() => {
    const layers: DesiredLayer[] = [];

    for (const layerId of visibleLayers) {
      const layer = getLayer(layerId);
      if (layer === undefined) continue;
      const registryIndex = REGISTRY_INDEX.get(layerId) ?? 0;
      const layerOpacity = opacity[layerId] ?? layer.defaultOpacity;

      const vector = vectorData.get(layerId);
      if (vector !== undefined) {
        if (vector.data.features.length === 0) continue;
        layers.push({
          kind: 'vector',
          layer,
          registryIndex,
          opacity: layerOpacity,
          data: vector.data,
        });
        continue;
      }

      const overlay = overlays.get(layerId);
      const placement = placements[layerId];
      if (overlay?.pngUrl != null && overlay.available && placement !== undefined) {
        layers.push({
          kind: 'raster',
          layer,
          registryIndex,
          opacity: layerOpacity,
          url: overlay.pngUrl,
          coordinates: placement.coordinates,
        });
      }
    }

    return layers;
  }, [visibleLayers, opacity, vectorData, overlays, placements]);

  // Estado por capa para el panel (§4.3) y presencia para la leyenda (§5).
  const renderedLayers = useMemo(() => desired.map((item) => item.layer.id), [desired]);

  const runtime = useMemo(() => {
    const featureCounts = new Map<string, number>();
    for (const [layerId, entry] of vectorData) featureCounts.set(layerId, entry.count);

    const producedRasters = new Set<string>();
    for (const [layerId, ref] of overlays) {
      if (ref.available) producedRasters.add(layerId);
    }

    return buildLayerRuntime({ analysis, featureCounts, producedRasters });
  }, [analysis, vectorData, overlays]);

  useEffect(() => {
    onLayerStatus?.(runtime);
  }, [runtime, onLayerStatus]);

  const presence = useMemo<LegendPresence>(() => {
    const result: Record<
      string,
      { presentLabels?: string[]; domain?: { min: number; max: number } }
    > = {};

    // Hidrología: sólo los tipos que el AOI trajo de verdad (inventario §4).
    if (analysis !== null) {
      const kinds = new Set(analysis.hydrology.features.map((item) => item.kind));
      result['osm-hydro'] = {
        presentLabels: [...kinds]
          .map((kind) => OSM_HYDRO_KIND_LABELS[kind])
          .filter((label): label is string => label !== undefined),
      };

      /*
        WorldCover es DISPERSO: el motor omite las clases con 0 %. Las claves de
        `worldcover_landcover_pct` son las etiquetas en español y son las
        mismas del registro, así que la leyenda se filtra con ellas sin
        traducir nada. Si el overlay ya trajo su sidecar, ese gana: es la
        leyenda que el servicio realmente pintó.
      */
      const worldcoverPct = analysis.vegetation.summary?.worldcover_landcover_pct;
      if (worldcoverPct != null) {
        const known = new Set(WORLDCOVER_CLASSES.map((item) => item.label));
        result.worldcover = {
          presentLabels: Object.keys(worldcoverPct).filter((label) => known.has(label)),
        };
      }
    }

    for (const [layerId, placement] of Object.entries(placements)) {
      const metadata = placement.metadata;
      if (metadata === null) continue;

      const labels = metadata.legend.map((entry) => entry.label);
      const existing = result[layerId] ?? {};
      const vmin = metadata.vmin;
      const vmax = metadata.vmax;
      result[layerId] = {
        ...existing,
        ...(labels.length > 0 ? { presentLabels: labels } : {}),
        ...(vmin != null && vmax != null ? { domain: { min: vmin, max: vmax } } : {}),
      };
    }

    return result;
  }, [analysis, placements]);

  // Pila de resultados del último click (§5.1).
  const hitsRef = useRef<FeatureHit[]>([]);

  const emitInspector = useCallback((hits: readonly FeatureHit[], focus: FeatureHit | null) => {
    const candidates = buildCandidates(hits);
    const feature =
      focus === null
        ? null
        : buildInspectorFeature({
            hit: focus,
            aoi: aoiContextRef.current,
            layerFeatureCount: vectorDataRef.current?.get(focus.layerId)?.count ?? 0,
          });

    inspectRef.current?.({ candidates, feature });
  }, []);

  // Creación del mapa.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return undefined;

    let disposed = false;
    let created: MapLibreMap | null = null;
    const overlayAbort = new AbortController();
    overlayAbortRef.current = overlayAbort;

    /*
      Import dinámico: `maplibre-gl` toca `window` al evaluarse y este
      componente se renderiza también en el servidor (TanStack Start, SSR).
      Además saca ~800 kB del bundle inicial y del render del servidor.
    */
    void import('maplibre-gl').then((maplibre) => {
      if (disposed) return;

      const start = initialRef.current;
      const map = new maplibre.Map({
        container,
        style: basemapStyle(start.basemap, start.dark),
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        attributionControl: { compact: true },
        // El teclado de MapLibre (flechas para desplazar, +/- para zoom) queda
        // ACTIVO a propósito: es la accesibilidad de teclado del mapa.
        keyboard: true,
        maxPitch: 0,
      });
      created = map;
      mapRef.current = map;

      /*
        Asa de pruebas OPT-IN (plan de validación §2.12). El validador de
        Puppeteer necesita `map.getStyle()` para comprobar las regresiones #4,
        #5 y #7 sobre el estilo REAL, no sobre el código. Sólo se publica si la
        página la pidió antes de cargar (`window.__tbExposeMap = true`), así
        que en producción no hay ninguna global nueva.
      */
      if ((window as unknown as { __tbExposeMap?: boolean }).__tbExposeMap === true) {
        (window as unknown as { __tbMap?: unknown }).__tbMap = map;
      }
      appliedStyleRef.current = { basemap: start.basemap, dark: start.dark };

      map.on('load', () => {
        if (disposed) return;
        syncerRef.current = new LayerSyncer(map);
        drawRef.current = new AoiDrawController(map, {
          onState: setDrawState,
          onComplete: (geometry) => {
            onAoiDrawnRef.current(geometry);
          },
          onCancel: () => {
            onToolDoneRef.current?.();
          },
        });
        setReady(true);
        setStyleEpoch((value) => value + 1);
      });

      map.on('mousemove', (event: MapMouseEvent) => {
        setCursor(formatCoordinates(event.lngLat.lng, event.lngLat.lat));
      });

      const refreshView = () => {
        const center = map.getCenter();
        const nextZoom = map.getZoom();
        setZoom(nextZoom);
        setScale(scaleBar(center.lat, nextZoom));
      };
      map.on('move', refreshView);
      map.on('moveend', () => {
        refreshView();
        const viewport = map.getBounds();
        onBboxChangeRef.current([
          viewport.getWest(),
          viewport.getSouth(),
          viewport.getEast(),
          viewport.getNorth(),
        ]);
      });
    });

    return () => {
      disposed = true;
      overlayAbort.abort();
      drawRef.current?.destroy();
      drawRef.current = null;
      syncerRef.current = null;
      mapRef.current = null;
      setReady(false);
      created?.remove();
    };
  }, []);

  // Cambio de mapa base.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || map === null) return;

    /*
      El mapa se CREA con este mismo estilo, así que la primera corrida del
      efecto no tiene nada que cambiar. Volver a aplicarlo no sería inocuo:
      `setStyle` descarta el estilo en vuelo y deja al mapa recargando todo por
      nada, justo mientras el usuario ya puede estar dibujando.
    */
    const applied = appliedStyleRef.current;
    if (applied !== null && applied.basemap === basemap && applied.dark === dark) return;
    appliedStyleRef.current = { basemap, dark };

    /*
      `setStyle` BORRA el estilo entero: fuentes, capas y el dibujo del AOI.
      Por eso el syncer olvida su contabilidad y `styleEpoch` obliga a los
      efectos de abajo a rearmar todo. Sin este par, cambiar de mapa base deja
      un mapa sin capas — el bug clásico del basemap switcher.
    */
    map.setStyle(basemapStyle(basemap, dark));
    syncerRef.current?.forget();
    map.once('styledata', () => {
      drawRef.current?.ensureStyle();
      setStyleEpoch((value) => value + 1);
    });
  }, [basemap, dark, ready]);

  // Overlays raster: bounds y leyenda del sidecar.
  const overlayKey = visibleLayers.filter((id) => overlays.has(id)).join('|');

  useEffect(() => {
    /*
      Se pide la ubicación de cada overlay raster VISIBLE que todavía no se
      tenga. Tres decisiones, y las tres importan:

      1. La única dependencia es `overlayKey` — la firma en TEXTO del conjunto
         de capas raster visibles. `visibleLayers` y `overlays` se leen de refs
         a propósito: son objetos nuevos en cada render, y con ellos en las
         dependencias el efecto se re-ejecutaría constantemente.
      2. El `AbortController` es UNO por vida del componente, no uno por
         corrida. Estos GET traen datos INMUTABLES de un análisis terminado;
         cancelarlos en cada re-ejecución sólo lograba que la respuesta llegara
         cancelada, la caché nunca se llenara, y prender la capa volviera a
         pedir lo mismo para siempre.
      3. Un overlay ya ubicado no se vuelve a pedir. La clave incluye la URL,
         así que un análisis nuevo — o el costero, que cambia con el escenario
         — sí vuelve a pedir. Un fallo no deja nada en la caché: reintentar es
         apagar y prender la capa.
    */
    const controller = overlayAbortRef.current;

    const known = overlaysRef.current ?? new Map<string, RasterOverlayRef>();
    const pending = visibleLayersRef.current
      .map((id) => known.get(id))
      .filter((ref): ref is RasterOverlayRef => ref?.available === true)
      .filter((ref) => !placementCacheRef.current.has(cacheKeyOf(ref)));

    for (const ref of pending) {
      fetchOverlayPlacement(ref, controller.signal).then(
        (placement) => {
          if (placement === null) return;
          placementCacheRef.current.set(cacheKeyOf(ref), placement);
          setPlacements((current) => ({ ...current, [ref.layerId]: placement }));
        },
        () => {
          /*
            Un overlay que no se puede ubicar NO se pinta: dibujarlo con bounds
            adivinados es exactamente cómo se veía la regresión #1. La fila de
            la capa ya reporta su estado; acá no hay nada más que hacer.
          */
        },
      );
    }
  }, [overlayKey]);

  useEffect(() => {
    if (!ready || styleEpoch === 0) return;
    syncerRef.current?.sync(desired);
  }, [desired, ready, styleEpoch]);

  // Click y hover: un handler ATADO A LAS CAPAS, no un hit-test global.
  const interactiveIds = useMemo(
    () =>
      desired
        .filter((item) => item.kind === 'vector')
        .flatMap((item) => vectorMapLayerIds(item.layer)),
    [desired],
  );
  const interactiveKey = interactiveIds.join('|');

  useEffect(() => {
    const map = mapRef.current;
    const syncer = syncerRef.current;
    if (!ready || map === null || syncer === null || interactiveIds.length === 0) return undefined;

    const present = interactiveIds.filter((id) => map.getLayer(id) !== undefined);
    if (present.length === 0) return undefined;

    const toHit = (feature: {
      layer: { id: string };
      properties: Record<string, unknown>;
    }): FeatureHit | null => {
      // La capa NO se infiere del feature: se resuelve contra la tabla que
      // armó el syncer al montarla (§12.6).
      const layerId = syncer.registryLayerOf(feature.layer.id);
      const featureId = feature.properties[FEATURE_ID_KEY];
      if (layerId === undefined || typeof featureId !== 'string') return null;
      return { layerId, featureId, properties: feature.properties };
    };

    const subscriptions: Subscription[] = [];

    subscriptions.push(
      map.on('click', present, (event) => {
        const hits: FeatureHit[] = [];
        const seen = new Set<string>();
        for (const feature of event.features ?? []) {
          const hit = toHit(feature);
          if (hit === null) continue;
          const key = `${hit.layerId}:${hit.featureId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          hits.push(hit);
        }

        hitsRef.current = hits;
        const first = hits[0];

        if (first === undefined) {
          selectRef.current(null);
          emitInspector([], null);
          return;
        }

        /*
          §5.1: si el click pega en MÁS DE UNA capa no se elige ganador — el
          inspector abre con la pila de resultados y el usuario decide. Con una
          sola capa se entra directo al feature.
        */
        const layers = new Set(hits.map((hit) => hit.layerId));
        const focus = layers.size === 1 ? first : null;
        selectRef.current(
          focus === null ? null : { layerId: focus.layerId, featureId: focus.featureId },
        );
        emitInspector(hits, focus);
      }),
    );

    let hovered: { source: string; id: string } | null = null;
    const clearHover = () => {
      if (hovered === null) return;
      map.setFeatureState({ source: hovered.source, id: hovered.id }, { hover: false });
      hovered = null;
    };

    subscriptions.push(
      map.on('mousemove', present, (event) => {
        map.getCanvas().style.cursor =
          drawRef.current?.isDrawing() === true ? 'crosshair' : 'pointer';
        const feature = event.features?.[0];
        if (feature === undefined) return;
        const id = feature.id;
        if (typeof id !== 'string') return;
        if (hovered !== null && hovered.id === id && hovered.source === feature.source) return;
        clearHover();
        hovered = { source: feature.source, id };
        map.setFeatureState({ source: feature.source, id }, { hover: true });
      }),
    );

    subscriptions.push(
      map.on('mouseleave', present, () => {
        map.getCanvas().style.cursor = drawRef.current?.isDrawing() === true ? 'crosshair' : '';
        clearHover();
      }),
    );

    return () => {
      clearHover();
      for (const subscription of subscriptions) subscription.unsubscribe();
    };
    // `interactiveKey` es la firma estable de `interactiveIds`: sin ella el
    // efecto se re-suscribiría en cada render por identidad de array.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ver arriba
  }, [interactiveKey, ready, styleEpoch, emitInspector]);

  // Resaltado del feature seleccionado.
  useEffect(() => {
    const syncer = syncerRef.current;
    if (!ready || syncer === null || styleEpoch === 0) return;

    if (selection === null) {
      syncer.clearHighlight();
      return;
    }

    const layer = getLayer(selection.layerId);
    if (layer === undefined || !syncer.hasLayer(layer.id)) {
      syncer.clearHighlight();
      return;
    }

    syncer.setHighlight(highlightSpecs(layer, selection.featureId), layer.id, selection.featureId);
  }, [selection, ready, styleEpoch, desired]);

  /*
    Selección que llega por URL (`sel=`) sin haber pasado por un click: se
    reconstruye el contenido del inspector desde el GeoJSON que ya está en
    memoria. Es lo que hace que un link compartido abra el mismo panel.
  */
  useEffect(() => {
    if (selection === null) return;
    if (hitsRef.current.some((hit) => hit.featureId === selection.featureId)) return;

    const entry = vectorData.get(selection.layerId);
    const found = entry?.data.features.find(
      (feature) => feature.properties?.[FEATURE_ID_KEY] === selection.featureId,
    );
    if (entry === undefined || found === undefined) return;

    const hit: FeatureHit = {
      layerId: selection.layerId,
      featureId: selection.featureId,
      properties: found.properties ?? {},
    };
    hitsRef.current = [hit];
    emitInspector([hit], hit);
  }, [selection, vectorData, emitInspector]);

  const fitTo = useCallback((target: Bounds2D) => {
    const map = mapRef.current;
    if (map === null) return;
    // El padding llega por props para que el AOI no quede debajo de un panel
    // (§2). Se lee del ref: el encuadre usa SIEMPRE el layout actual.
    map.fitBounds(target, { padding: paddingRef.current, duration: 600, maxZoom: 17 });
  }, []);

  useEffect(() => {
    if (!ready || aoiGeometry === null) return;
    const target = boundsOf(aoiGeometry);
    if (target !== null) fitTo(target);
  }, [aoiGeometry, ready, fitTo]);

  /* Encuadre inicial desde la URL, sólo cuando todavía no hay AOI. */
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!ready || restoredRef.current || bbox === null || aoiGeometry !== null) return;
    restoredRef.current = true;
    fitTo(bbox);
  }, [ready, bbox, aoiGeometry, fitTo]);

  const controller = useMemo<MapController>(
    () => ({
      pickLayer: (layerId) => {
        const hit = hitsRef.current.find((candidate) => candidate.layerId === layerId);
        if (hit === undefined) return;
        selectRef.current({ layerId: hit.layerId, featureId: hit.featureId });
        emitInspector(hitsRef.current, hit);
      },
      back: () => {
        selectRef.current(null);
        emitInspector(hitsRef.current, null);
      },
      zoomToSelection: () => {
        const map = mapRef.current;
        const current = selectionRef.current;
        if (map === null || current === null) return;
        const entry = vectorDataRef.current?.get(current.layerId);
        const found = entry?.data.features.find(
          (feature) => feature.properties?.[FEATURE_ID_KEY] === current.featureId,
        );
        if (found === undefined) return;
        const target = boundsOf(found.geometry as { coordinates: unknown });
        if (target !== null) fitTo(target);
      },
      zoomToAoi: () => {
        const geometry = aoiGeometryRef.current;
        if (geometry === null) return;
        const target = boundsOf(geometry);
        if (target !== null) fitTo(target);
      },
      tableFor: (layerId, limit) => {
        const entry = vectorDataRef.current?.get(layerId);
        const layer = getLayer(layerId);
        if (entry === undefined || layer === undefined) return null;

        const rows: InspectorFeature[] = [];
        for (const item of entry.data.features.slice(0, limit)) {
          const featureId = item.properties?.[FEATURE_ID_KEY];
          if (typeof featureId !== 'string') continue;
          const built = buildInspectorFeature({
            hit: { layerId, featureId, properties: item.properties ?? {} },
            aoi: aoiContextRef.current,
            layerFeatureCount: entry.count,
          });
          if (built !== null) rows.push(built);
        }

        return { layerId, layerLabel: layer.label, total: entry.count, rows };
      },
      previewLayer: (layerId) => {
        const syncer = syncerRef.current;
        if (syncer === null) return;
        if (layerId === null) {
          syncer.clearHighlight();
          return;
        }
        const hit = hitsRef.current.find((candidate) => candidate.layerId === layerId);
        const layer = hit === undefined ? undefined : getLayer(hit.layerId);
        if (hit === undefined || layer === undefined) return;
        syncer.setHighlight(highlightSpecs(layer, hit.featureId), layer.id, hit.featureId);
      },
    }),
    [emitInspector, fitTo],
  );

  useEffect(() => {
    if (ready) onReadyRef.current?.(controller);
  }, [ready, controller]);

  useEffect(() => {
    const draw = drawRef.current;
    if (!ready || draw === null) return;
    if (drawing) draw.start(drawMode);
    else draw.stop();
  }, [drawing, drawMode, ready, styleEpoch]);

  /*
    El panel de mapa base NO tiene estado propio: se deriva de la herramienta
    activa de la toolbar. Una segunda fuente de verdad para "¿está abierto?"
    es cómo se llega a un botón marcado como activo con el panel cerrado.
  */
  const basemapOpen = tool === 'basemap';

  useEffect(() => {
    onScaleChange?.(scale.label);
  }, [scale, onScaleChange]);

  useEffect(() => {
    if (tool !== 'ubicacion') return;
    controller.zoomToAoi();
    onToolDoneRef.current?.();
  }, [tool, controller]);

  return (
    <div
      ref={containerRef}
      className="bg-surface-3 relative h-full w-full"
      role="application"
      aria-label="Mapa de la zona de estudio"
      aria-describedby="tb-map-help"
    >
      <p id="tb-map-help" className="sr-only">
        Usá las flechas del teclado para desplazar el mapa y las teclas más y menos para acercar y
        alejar. Los elementos de las capas visibles se abren en el panel de detalle al hacerles
        clic. En modo dibujo, Escape cancela y Retroceso deshace el último vértice.
      </p>

      <AoiUpload
        open={tool === 'subir'}
        containerRef={containerRef}
        onClose={() => {
          onToolDoneRef.current?.();
        }}
        onLoaded={(aoi) => {
          onAoiUploaded?.(aoi);
        }}
        onError={(message) => {
          onAoiError?.(message);
        }}
      />

      {drawState !== null ? <DrawingHud state={drawState} /> : null}

      {basemapOpen ? (
        <BasemapSwitcher
          value={basemap}
          onChange={(next) => {
            onBasemapChange?.(next);
          }}
          onClose={() => {
            onToolDoneRef.current?.();
          }}
        />
      ) : null}

      <div className="pointer-events-none absolute top-4 right-4 bottom-16 z-10 flex flex-col items-end justify-end">
        <LegendStack
          visibleLayers={visibleLayers}
          renderedLayers={renderedLayers}
          presence={presence}
          compact={compact}
        />
      </div>

      {compact ? null : <MapReadout coordinates={cursor} zoom={zoom} scale={scale} />}
    </div>
  );
}

/**
 * Ids de capa de estilo interactivas de una capa del registro. Es el mismo
 * cálculo que hace el syncer al montarla — se repite acá para poder armar la
 * suscripción ANTES de que MapLibre confirme el alta.
 */
function vectorMapLayerIds(layer: LayerDef): string[] {
  switch (layer.kind) {
    case 'vector-polygon':
      return [`tb-fill:${layer.id}`, `tb-outline:${layer.id}`];
    case 'vector-line':
      return [`tb-fill:${layer.id}`, `tb-line:${layer.id}`];
    case 'vector-point':
      return [`tb-point:${layer.id}`];
    case 'raster-continuous':
    case 'raster-categorical':
      return [];
  }
}
