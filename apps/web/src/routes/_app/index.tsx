import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { LayerRuntime } from '~/components/layers/layer-row';
import type { ThemeId } from '~/layers/types';

import { AnalysisPanel } from '~/components/analysis/analysis-panel';
import { buildAnalysisCards } from '~/components/analysis/cards-model';
import { analysisThemeProgress } from '~/components/analysis/progress-model';
import { DownloadModal } from '~/components/download/download-modal';
import { CoastalControl } from '~/components/layers/coastal-control';
import { COASTAL_LAYER_ID, LayerPanel } from '~/components/layers/layer-panel';
import { LayerTableDialog, LAYER_TABLE_LIMIT } from '~/components/layers/layer-table';
import { AppShell } from '~/components/layout/app-shell';
import { BottomCluster } from '~/components/layout/bottom-cluster';
import { Inspector } from '~/components/layout/inspector';
import { MapToolbar, type MapTool } from '~/components/layout/map-toolbar';
import { Topbar } from '~/components/layout/topbar';
import { aoiErrorMessage, readAoiFile } from '~/components/map/aoi-upload';
import {
  type LayerTable,
  type MapController,
  type MapInspectorState,
  MapCanvas,
} from '~/components/map/map-canvas';
import { publicRasterBaseUrl } from '~/components/map/raster-base';
import { ServiceDownStrip } from '~/components/states/service-strip';
import { useToast } from '~/components/ui/toast';
import { getLayer, LAYER_REGISTRY } from '~/layers/registry';
import { isInRd } from '~/layers/sources';
import {
  type BasemapId,
  applyVista,
  getVista,
  initialVisibility,
  VISTAS,
  type LayerVisibility,
} from '~/layers/vistas';
import { downSources } from '~/lib/analysis-contract';
import {
  useAnalysisFlow,
  useStartAnalysis,
  type StartAnalysisVariables,
} from '~/lib/analysis-queries';
import { signOut } from '~/lib/auth-client';
import { clearSessionCache } from '~/lib/auth-server';
import {
  type Bbox,
  mapSearchSchema,
  parseBbox,
  parseSelection,
  serializeBbox,
  serializeSelection,
  visibilityFromSearch,
  visibilityToSearch,
} from '~/lib/search-params';
import { useBreakpoint } from '~/lib/use-media-query';

export const Route = createFileRoute('/_app/')({
  validateSearch: mapSearchSchema,
  component: MapWorkspace,
});

/** 20 m es la resolución alternativa que ofrece el guard de tamaño (§7.4). */
const DOWNGRADED_NDVI_M = 20;

/** Cuánto se espera antes de escribir el viewport en la URL. */
const BBOX_WRITE_DEBOUNCE_MS = 600;

function MapWorkspace() {
  const search = Route.useSearch();
  const { user, queryClient } = Route.useRouteContext();
  const navigate = useNavigate({ from: Route.fullPath });
  const router = useRouter();
  const breakpoint = useBreakpoint();

  /*
    Cableado del mapa (workstream MapLibre). El mapa calcula tres cosas que el
    shell necesita y no puede derivar solo: el contenido del inspector, el
    estado por capa y un controlador imperativo para "zoom a la geometría" y
    el drill-down de la pila de resultados (§5.1/§5.3).
  */
  const controllerRef = useRef<MapController | null>(null);
  const [inspectorState, setInspectorState] = useState<MapInspectorState>({
    candidates: [],
    feature: null,
  });
  const [layerRuntime, setLayerRuntime] = useState<Record<string, LayerRuntime>>({});
  const [basemapOverride, setBasemapOverride] = useState<BasemapId | null>(null);

  /*
    ────────────────────────────────────────────────────────────────────────
    EL CICLO DE VIDA DEL ANÁLISIS
    ────────────────────────────────────────────────────────────────────────
    Un solo hook: lanza, sigue el progreso vivo, transiciona al resultado y
    expone el error. La ruta ya no decide "¿terminó?" — antes lo hacía con
    `phase = hasAoi ? 'listo' : 'sin-aoi'`, que era falso desde el instante en
    que `startAnalysis` devuelve el id (~120 ms) hasta que el pipeline termina
    (10–90 s): la pantalla decía "listo" con cero resultados y no volvía a
    pedir nada nunca más.
  */
  const flow = useAnalysisFlow(search.aoi);
  const analysis = flow.analysis;
  const startAnalysis = useStartAnalysis();
  const toast = useToast();

  const [activeTool, setActiveTool] = useState<MapTool | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [table, setTable] = useState<LayerTable | null>(null);
  const [scaleLabel, setScaleLabel] = useState('— m');
  const [signingOut, setSigningOut] = useState(false);
  const [incidentsDismissed, setIncidentsDismissed] = useState(false);
  /** AOI rechazado por tamaño: espera la decisión del §7.4, no se perdió. */
  const [largeAoi, setLargeAoi] = useState<{ geometry: unknown; areaHa: number } | null>(null);

  const bbox = useMemo(() => parseBbox(search.bbox), [search.bbox]);
  const selection = useMemo(() => parseSelection(search.sel), [search.sel]);

  /*
    §3 — de qué depende ofrecer la vista `Riesgo RD` y las 39 capas MEPyD.

    La respuesta la da el MOTOR (`mepyd_rd.in_rd`), que la calculó contra la
    geometría real del AOI. El bbox del viewport es sólo el respaldo para el
    mapa vacío, antes de que exista un AOI. Derivarlo del viewport cuando hay
    análisis sería peor que el bug original: bastaba desplazar el mapa hacia
    Haití para que las capas MEPyD de un AOI dominicano desaparecieran.
  */
  const inRd = analysis !== null ? analysis.mepyd_rd.in_rd : bbox === null || isInRd(bbox);

  /*
    Sin `layers=` en la URL todavía no hay estado del usuario: se usa el preset
    de la vista en memoria en vez de reescribir la URL en el primer render
    (eso rompería el botón Atrás del navegador).

    Las dependencias son los TRES campos que se leen, no `search` entero: el
    objeto de search cambia de identidad cada vez que el mapa escribe `?bbox=`,
    y con `[search]` esto devolvía `visible`/`opacity` NUEVOS en cada `moveend`
    — lo que re-aplicaba el estilo de todas las capas del mapa por mover el
    mapa.
  */
  const visibility: LayerVisibility = useMemo(
    () =>
      search.layers === undefined
        ? initialVisibility(search.theme)
        : visibilityFromSearch({ layers: search.layers, op: search.op }),
    [search.layers, search.op, search.theme],
  );

  const patchVisibility = (next: LayerVisibility, theme?: ThemeId) => {
    void navigate({
      search: (previous) => ({
        ...previous,
        ...visibilityToSearch(next),
        ...(theme === undefined ? {} : { theme }),
      }),
      replace: true,
    });
  };

  const handleToggle = (layerId: string, next: boolean) => {
    const visible = next
      ? [...visibility.visible, layerId]
      : visibility.visible.filter((id) => id !== layerId);
    patchVisibility({ ...visibility, visible });
  };

  const handleOpacity = (layerId: string, value: number) => {
    patchVisibility({ ...visibility, opacity: { ...visibility.opacity, [layerId]: value } });
  };

  const handleTheme = (theme: ThemeId) => {
    patchVisibility(applyVista(visibility, theme, search.theme), theme);
  };

  const setSelection = (next: string | undefined) => {
    void navigate({ search: (previous) => ({ ...previous, sel: next }), replace: true });
  };

  /*
    El viewport SÍ se escribe en la URL (§1.1: "si un colega pega el link, ve
    el mismo mapa"). Estaba declarado en el esquema, el mapa lo emitía en cada
    `moveend`, y la ruta lo tiraba a la basura con `() => undefined`.

    Va con debounce y `replace: true`: un `pan` produce decenas de eventos y
    ninguno de ellos es un paso de navegación que el botón Atrás deba recorrer.
  */
  const bboxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleBboxChange = useCallback(
    (next: Bbox) => {
      if (bboxTimer.current !== null) clearTimeout(bboxTimer.current);
      bboxTimer.current = setTimeout(() => {
        void navigate({
          search: (previous) => ({ ...previous, bbox: serializeBbox(next) }),
          replace: true,
        });
      }, BBOX_WRITE_DEBOUNCE_MS);
    },
    [navigate],
  );

  useEffect(
    () => () => {
      if (bboxTimer.current !== null) clearTimeout(bboxTimer.current);
    },
    [],
  );

  /*
    Un AOI nuevo (dibujado o subido) lanza el análisis y su id va a la URL: es
    el "sin botón de submit" del §8, y deja el AOI como objeto de primera clase
    del §0.3 — quien pega el link ve el mismo mapa.
  */
  const launch = useCallback(
    (geometry: unknown, extra: Omit<StartAnalysisVariables, 'aoi'> = {}) => {
      setActiveTool(null);
      setIncidentsDismissed(false);
      startAnalysis.mutate(
        { aoi: geometry, ...extra },
        {
          onSuccess: (result) => {
            if (result.ok) {
              setLargeAoi(null);
              void navigate({
                search: (previous) => ({ ...previous, aoi: result.analysisId, panel: 'analisis' }),
              });
              return;
            }

            /*
              §7.4 — el AOI demasiado grande NO es un toast que se va solo: es
              una pregunta con tres respuestas concretas. La geometría se
              guarda para poder relanzarla con la decisión del usuario, en vez
              de obligarlo a volver a dibujar.
            */
            if (result.reason === 'aoi-demasiado-grande') {
              setLargeAoi({ geometry, areaHa: result.areaHa ?? 0 });
              void navigate({
                search: (previous) => ({ ...previous, panel: 'analisis' }),
                replace: true,
              });
              return;
            }

            // Un rechazo (AOI inválido) NO es un servicio caído: la franja
            // ámbar del §8 nombra servicios, esto es un aviso.
            toast.push({
              tone: 'warning',
              title: 'No se pudo analizar',
              description: result.message,
            });
          },
          onError: (error: Error) => {
            toast.push({ tone: 'error', title: 'No se pudo analizar', description: error.message });
          },
        },
      );
    },
    [navigate, startAnalysis, toast],
  );

  const acceptAoi = (geometry: unknown) => {
    launch(geometry);
  };

  /*
    El dropzone del panel (`EmptyAoiState`) tiene su PROPIO `input[type=file]`
    y su propio `drop`, así que emite un `FileList` real. Antes se descartaba y
    sólo se prendía la herramienta `subir` del mapa: elegir un archivo ahí no
    producía NADA (y en un browser de verdad abría un segundo diálogo del
    sistema encima del que la persona acababa de usar). Se parsea con el mismo
    camino que la subida del mapa — mismos límites, mismos mensajes.
  */
  const handlePanelFiles = (files: FileList) => {
    const file = files[0];
    if (file === undefined) {
      setActiveTool('subir');
      return;
    }
    readAoiFile(file).then(
      (aoi) => {
        acceptAoi(aoi.geometry);
      },
      (error: unknown) => {
        toast.push({
          tone: 'error',
          title: 'No se pudo leer el archivo',
          description: aoiErrorMessage(error),
        });
      },
    );
  };

  /*
    Cerrar el inspector limpia LAS DOS fuentes de `inspectorOpen`: el `?sel=`
    de la URL y la pila que dejó el último clic en el mapa. Con sólo borrar
    `sel`, el panel seguía abierto sobre el mismo feature — el botón
    "Cerrar detalle" no cerraba nada.
  */
  const closeInspector = () => {
    setSelection(undefined);
    setInspectorState({ candidates: [], feature: null });
  };

  const vista = getVista(search.theme);
  const availableVistas = VISTAS.filter((item) => (item.requiresRd === true ? inRd : true));
  const hasAoi = search.aoi !== undefined;
  const analysisReady = analysis !== null;
  const inspectorOpen =
    selection !== null || inspectorState.feature !== null || inspectorState.candidates.length > 1;

  const openReport = useCallback(() => {
    if (search.aoi === undefined) return;
    void navigate({ to: '/reporte/$analysisId', params: { analysisId: search.aoi } });
  }, [navigate, search.aoi]);

  const handleSignOut = useCallback(() => {
    setSigningOut(true);
    void (async () => {
      try {
        await signOut();
        // Dos pasos, y el orden importa. `clearSessionCache` tira la sesión
        // que el guard tiene cacheada (ver `~/lib/auth-server`); sin eso
        // `requireUser` seguiría devolviendo al usuario recién deslogueado.
        // `invalidate()` re-corre los `beforeLoad`: sin esto el router sigue
        // creyendo que hay sesión y `/login` rebota de vuelta al mapa
        // (`redirectIfSignedIn`).
        clearSessionCache(queryClient);
        await router.invalidate();
        await navigate({ to: '/login', search: {} });
      } finally {
        setSigningOut(false);
      }
    })();
  }, [navigate, queryClient, router]);

  /* ---------------------------------------------------------------------- */
  /* Acciones del AOI (§2, popover del chip)                                 */
  /* ---------------------------------------------------------------------- */

  const downloadAoi = () => {
    if (analysis === null) return;
    const geojson = {
      type: 'Feature',
      properties: {
        analysis_id: analysis.id,
        area_ha: analysis.aoi.area_ha,
        utm_epsg: analysis.aoi.utm_epsg,
      },
      geometry: analysis.aoi_geometry,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `aoi_${analysis.id}.geojson`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const clearAoi = () => {
    setLargeAoi(null);
    setInspectorState({ candidates: [], feature: null });
    void navigate({
      search: (previous) => ({ ...previous, aoi: undefined, sel: undefined }),
    });
  };

  /* ---------------------------------------------------------------------- */
  /* Estado derivado del análisis                                            */
  /* ---------------------------------------------------------------------- */

  const cards = useMemo(
    () => (analysis === null ? [] : buildAnalysisCards({ analysis, onRetry: flow.retry })),
    [analysis, flow.retry],
  );

  const progress = useMemo(
    () => (flow.phase === 'analizando' ? analysisThemeProgress(flow.run) : []),
    [flow.phase, flow.run],
  );

  /*
    §8 — la franja ámbar existe para nombrar el servicio concreto que no
    respondió. Se alimenta de las fuentes en `error` del análisis: el motor
    aísla cada una (regresión #3) y esto es lo que hace visible ese
    aislamiento en vez de dejar tarjetas mudas.
  */
  const incidents = useMemo(
    () =>
      analysis === null || incidentsDismissed
        ? []
        : downSources(analysis).map((source) => ({ service: source.service })),
    [analysis, incidentsDismissed],
  );

  const coastalLayer = getLayer(COASTAL_LAYER_ID);
  const coastalVisible = visibility.visible.includes(COASTAL_LAYER_ID);

  const capas = (
    <LayerPanel
      theme={search.theme}
      visible={visibility.visible}
      opacity={visibility.opacity}
      runtime={layerRuntime}
      hasAoi={hasAoi}
      inRd={inRd}
      touch={breakpoint === 'mobile' || breakpoint === 'tablet'}
      onToggle={handleToggle}
      onOpacityChange={handleOpacity}
      onRemove={(layerId) => {
        handleToggle(layerId, false);
      }}
      onDownloadLayer={() => {
        setExportOpen(true);
      }}
      onRetryLayer={() => {
        flow.retry();
      }}
      coastalControl={
        coastalLayer === undefined ? null : (
          <CoastalControl
            layer={coastalLayer}
            runtime={layerRuntime[COASTAL_LAYER_ID] ?? { status: 'skipped' }}
            analysisId={analysisReady ? search.aoi : undefined}
            visible={coastalVisible}
            opacity={visibility.opacity[COASTAL_LAYER_ID] ?? coastalLayer.defaultOpacity}
            touch={breakpoint === 'mobile' || breakpoint === 'tablet'}
            onToggleVisible={(next) => {
              handleToggle(COASTAL_LAYER_ID, next);
            }}
            onOpacityChange={(value) => {
              handleOpacity(COASTAL_LAYER_ID, value);
            }}
            onDownload={() => {
              setExportOpen(true);
            }}
          />
        )
      }
    />
  );

  const analisis = (
    <AnalysisPanel
      phase={flow.phase}
      theme={search.theme}
      areaHa={analysis?.aoi.area_ha ?? null}
      inRd={inRd}
      cards={cards}
      progress={progress}
      elapsedMs={flow.elapsedMs}
      errorMessage={flow.errorMessage}
      sizeGuard={largeAoi === null ? null : { areaHa: largeAoi.areaHa }}
      onDraw={() => {
        setActiveTool('dibujar');
      }}
      onFiles={handlePanelFiles}
      onCancel={() => {
        setActiveTool(null);
        flow.cancel();
      }}
      onRetry={flow.retry}
      onProceedLargeAoi={() => {
        if (largeAoi !== null) launch(largeAoi.geometry, { confirmLargeAoi: true });
      }}
      onDowngradeResolution={() => {
        if (largeAoi !== null) {
          launch(largeAoi.geometry, {
            ndviResolutionM: DOWNGRADED_NDVI_M,
            confirmLargeAoi: true,
          });
        }
      }}
      onSplitAoi={() => {
        setLargeAoi(null);
        setActiveTool('dibujar');
        toast.push({
          tone: 'info',
          title: 'Dibujá un AOI más chico',
          description:
            'Dividí la zona en partes de hasta 2 000 ha y analizá cada una por separado.',
        });
      }}
    />
  );

  return (
    <>
      <AppShell
        hasAoi={hasAoi && analysisReady}
        onReport={openReport}
        panelTab={search.panel}
        onPanelTabChange={(panel) => {
          void navigate({ search: (previous) => ({ ...previous, panel }), replace: true });
        }}
        topbar={
          <Topbar
            theme={search.theme}
            vistas={availableVistas}
            onThemeChange={handleTheme}
            compactVistas={breakpoint === 'tablet' || breakpoint === 'mobile'}
            hasAoi={hasAoi}
            areaHa={analysis?.aoi.area_ha ?? null}
            analysisReady={analysisReady}
            exportJob={null}
            user={user}
            signingOut={signingOut}
            onSignOut={handleSignOut}
            onAoiAction={(action) => {
              if (action === 'ver') controllerRef.current?.zoomToAoi();
              if (action === 'reemplazar') setActiveTool('subir');
              if (action === 'descargar') downloadAoi();
              if (action === 'borrar') clearAoi();
            }}
            onReport={openReport}
            onExport={() => {
              setExportOpen(true);
            }}
          />
        }
        serviceStrip={
          <ServiceDownStrip
            incidents={incidents}
            onDismiss={() => {
              setIncidentsDismissed(true);
            }}
          />
        }
        capas={capas}
        analisis={analisis}
        inspectorOpen={inspectorOpen}
        onInspectorClose={closeInspector}
        inspector={
          <Inspector
            open={inspectorOpen}
            onClose={closeInspector}
            candidates={inspectorState.candidates}
            feature={inspectorState.feature}
            defaultTab={vista.inspectorDefaultTab}
            onPickCandidate={(layerId) => {
              controllerRef.current?.pickLayer(layerId);
            }}
            onBack={() => {
              controllerRef.current?.back();
            }}
            onZoom={() => {
              controllerRef.current?.zoomToSelection();
            }}
            onDownload={() => {
              setExportOpen(true);
            }}
            onOpenTable={() => {
              const layerId = inspectorState.feature?.layerId;
              if (layerId === undefined) return;
              setTable(controllerRef.current?.tableFor(layerId, LAYER_TABLE_LIMIT) ?? null);
            }}
          />
        }
        map={
          <>
            <MapCanvas
              basemap={basemapOverride ?? vista.basemap}
              visibleLayers={visibility.visible}
              opacity={visibility.opacity}
              aoiId={search.aoi}
              analysis={analysis}
              rasterBaseUrl={publicRasterBaseUrl()}
              bbox={bbox}
              selection={selection}
              drawing={activeTool === 'dibujar'}
              tool={activeTool}
              compact={breakpoint === 'mobile'}
              padding={{
                top: 48 + 24,
                right: inspectorOpen ? 380 + 24 : 24,
                bottom: 24,
                left: 360 + 24,
              }}
              onSelect={(next) => {
                setSelection(serializeSelection(next));
              }}
              onBboxChange={handleBboxChange}
              onScaleChange={setScaleLabel}
              onAoiDrawn={acceptAoi}
              onAoiUploaded={(aoi) => {
                acceptAoi(aoi.geometry);
              }}
              onAoiError={(message) => {
                // UC-03: un archivo corrupto se cuenta en castellano, no como
                // un traceback (que es exactamente lo que hacía el legacy).
                toast.push({
                  tone: 'error',
                  title: 'No se pudo leer el archivo',
                  description: message,
                });
              }}
              onToolDone={() => {
                setActiveTool(null);
              }}
              onBasemapChange={setBasemapOverride}
              onInspect={setInspectorState}
              onLayerStatus={setLayerRuntime}
              onReady={(controller) => {
                controllerRef.current = controller;
              }}
            />
            <MapToolbar
              activeTool={activeTool}
              hasAoi={hasAoi}
              onTool={(tool) => {
                setActiveTool((current) => (current === tool ? null : tool));
              }}
            />
            <BottomCluster visibleLayers={visibility.visible} scaleLabel={scaleLabel} />
          </>
        }
      />

      <LayerTableDialog
        table={table}
        onClose={() => {
          setTable(null);
        }}
      />

      <DownloadModal
        open={exportOpen}
        onClose={() => {
          setExportOpen(false);
        }}
        analysisId={search.aoi}
        aoiName={analysis === null ? undefined : 'Zona de estudio'}
        availableLayerIds={LAYER_REGISTRY.filter((layer) =>
          visibility.visible.includes(layer.id),
        ).map((layer) => layer.id)}
        aoiSlug={search.aoi ?? 'sin-aoi'}
      />
    </>
  );
}
