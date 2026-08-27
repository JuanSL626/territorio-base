import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useRef, useState } from 'react';

import type { LayerRuntime } from '~/components/layers/layer-row';
import type { ThemeId } from '~/layers/types';

import { AnalysisPanel } from '~/components/analysis/analysis-panel';
import { DownloadModal } from '~/components/download/download-modal';
import { LayerPanel } from '~/components/layers/layer-panel';
import { AppShell } from '~/components/layout/app-shell';
import { BottomCluster } from '~/components/layout/bottom-cluster';
import { Inspector } from '~/components/layout/inspector';
import { MapToolbar, type MapTool } from '~/components/layout/map-toolbar';
import { Topbar } from '~/components/layout/topbar';
import { type MapController, type MapInspectorState, MapCanvas } from '~/components/map/map-canvas';
import { publicRasterBaseUrl } from '~/components/map/raster-base';
import { useMapAnalysis } from '~/components/map/use-map-analysis';
import { ServiceDownStrip, type ServiceIncident } from '~/components/states/service-strip';
import { useToast } from '~/components/ui/toast';
import { LAYER_REGISTRY } from '~/layers/registry';
import { isInRd } from '~/layers/sources';
import {
  type BasemapId,
  applyVista,
  getVista,
  initialVisibility,
  VISTAS,
  type LayerVisibility,
} from '~/layers/vistas';
import { useStartAnalysis } from '~/lib/analysis-queries';
import {
  mapSearchSchema,
  parseBbox,
  parseSelection,
  serializeSelection,
  visibilityFromSearch,
  visibilityToSearch,
} from '~/lib/search-params';
import { useBreakpoint } from '~/lib/use-media-query';

export const Route = createFileRoute('/_app/')({
  validateSearch: mapSearchSchema,
  component: MapWorkspace,
});

function MapWorkspace() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
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

  const analysis = useMapAnalysis(search.aoi);
  const startAnalysis = useStartAnalysis();
  const toast = useToast();

  const [thresholds, setThresholds] = useState<Record<string, number[]>>({});
  const [showS2Footprints, setShowS2Footprints] = useState(false);
  const [activeTool, setActiveTool] = useState<MapTool | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [incidents, setIncidents] = useState<ServiceIncident[]>([]);

  const bbox = useMemo(() => parseBbox(search.bbox), [search.bbox]);
  const selection = useMemo(() => parseSelection(search.sel), [search.sel]);
  const inRd = bbox === null ? true : isInRd(bbox);

  /*
    Sin `layers=` en la URL todavía no hay estado del usuario: se usa el preset
    de la vista en memoria en vez de reescribir la URL en el primer render
    (eso rompería el botón Atrás del navegador).
  */
  const visibility: LayerVisibility = useMemo(
    () =>
      search.layers === undefined ? initialVisibility(search.theme) : visibilityFromSearch(search),
    [search],
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
    Un AOI nuevo (dibujado o subido) lanza el análisis y su id va a la URL: es
    el "sin botón de submit" del §8, y deja el AOI como objeto de primera clase
    del §0.3 — quien pega el link ve el mismo mapa.
  */
  const acceptAoi = (geometry: unknown) => {
    setActiveTool(null);
    startAnalysis.mutate(
      { aoi: geometry },
      {
        onSuccess: (result) => {
          if (result.ok) {
            void navigate({ search: (previous) => ({ ...previous, aoi: result.analysisId }) });
            return;
          }
          // Un rechazo (AOI inválido, AOI demasiado grande) NO es un servicio
          // caído: la franja ámbar del §8 nombra servicios, esto es un aviso.
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
  };

  const vista = getVista(search.theme);
  const availableVistas = VISTAS.filter((item) => (item.requiresRd === true ? inRd : true));
  const hasAoi = search.aoi !== undefined;
  const inspectorOpen =
    selection !== null || inspectorState.feature !== null || inspectorState.candidates.length > 1;

  const capas = (
    <LayerPanel
      theme={search.theme}
      visible={visibility.visible}
      opacity={visibility.opacity}
      runtime={layerRuntime}
      thresholds={thresholds}
      hasAoi={hasAoi}
      inRd={inRd}
      touch={breakpoint === 'mobile' || breakpoint === 'tablet'}
      showS2Footprints={showS2Footprints}
      onToggle={handleToggle}
      onOpacityChange={handleOpacity}
      onRemove={(layerId) => {
        handleToggle(layerId, false);
      }}
      onDownloadLayer={() => {
        setExportOpen(true);
      }}
      onRetryLayer={() => {
        setIncidents([]);
      }}
      onThresholdChange={(layerId, _thresholdId, values) => {
        setThresholds((current) => ({ ...current, [layerId]: values }));
      }}
      onToggleS2Footprints={setShowS2Footprints}
    />
  );

  const analisis = (
    <AnalysisPanel
      phase={hasAoi ? 'listo' : 'sin-aoi'}
      theme={search.theme}
      areaHa={null}
      inRd={inRd}
      cards={[]}
      progress={[]}
      elapsedMs={0}
      onDraw={() => {
        setActiveTool('dibujar');
      }}
      onFiles={() => {
        setActiveTool('subir');
      }}
      onCancel={() => {
        setActiveTool(null);
      }}
      onProceedLargeAoi={() => undefined}
      onDowngradeResolution={() => undefined}
      onSplitAoi={() => undefined}
    />
  );

  return (
    <>
      <AppShell
        hasAoi={hasAoi}
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
            areaHa={null}
            exportJob={null}
            onAoiAction={() => undefined}
            onReport={() => undefined}
            onExport={() => {
              setExportOpen(true);
            }}
          />
        }
        serviceStrip={
          <ServiceDownStrip
            incidents={incidents}
            onDismiss={() => {
              setIncidents([]);
            }}
          />
        }
        capas={capas}
        analisis={analisis}
        inspectorOpen={inspectorOpen}
        onInspectorClose={() => {
          setSelection(undefined);
        }}
        inspector={
          <Inspector
            open={inspectorOpen}
            onClose={() => {
              setSelection(undefined);
            }}
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
            onOpenTable={() => undefined}
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
              onBboxChange={() => undefined}
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
            <BottomCluster visibleLayers={visibility.visible} scaleLabel="— m" />
          </>
        }
      />

      <DownloadModal
        open={exportOpen}
        onClose={() => {
          setExportOpen(false);
        }}
        availableLayerIds={LAYER_REGISTRY.filter((layer) =>
          visibility.visible.includes(layer.id),
        ).map((layer) => layer.id)}
        aoiSlug={search.aoi ?? 'sin-aoi'}
        onSubmit={() => undefined}
      />
    </>
  );
}
