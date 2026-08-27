import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

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
import { MapCanvas } from '~/components/map/map-canvas';
import { ServiceDownStrip, type ServiceIncident } from '~/components/states/service-strip';
import { LAYER_REGISTRY } from '~/layers/registry';
import { isInRd } from '~/layers/sources';
import {
  applyVista,
  getVista,
  initialVisibility,
  VISTAS,
  type LayerVisibility,
} from '~/layers/vistas';
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

/** El motor todavía no reporta estado por capa: hasta entonces, todo `ok`. */
const EMPTY_RUNTIME: Record<string, LayerRuntime> = {};

function MapWorkspace() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const breakpoint = useBreakpoint();

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

  const vista = getVista(search.theme);
  const availableVistas = VISTAS.filter((item) => (item.requiresRd === true ? inRd : true));
  const hasAoi = search.aoi !== undefined;
  const inspectorOpen = selection !== null;

  const capas = (
    <LayerPanel
      theme={search.theme}
      visible={visibility.visible}
      opacity={visibility.opacity}
      runtime={EMPTY_RUNTIME}
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
            candidates={[]}
            feature={null}
            defaultTab={vista.inspectorDefaultTab}
            onPickCandidate={() => undefined}
            onBack={() => undefined}
            onZoom={() => undefined}
            onDownload={() => {
              setExportOpen(true);
            }}
            onOpenTable={() => undefined}
          />
        }
        map={
          <>
            <MapCanvas
              basemap={vista.basemap}
              visibleLayers={visibility.visible}
              opacity={visibility.opacity}
              aoiId={search.aoi}
              bbox={bbox}
              selection={selection}
              drawing={activeTool === 'dibujar'}
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
              onAoiDrawn={() => {
                setActiveTool(null);
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
