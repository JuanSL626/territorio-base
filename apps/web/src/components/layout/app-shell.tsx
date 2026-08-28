import { useState, type ReactNode } from 'react';

import { LeftPanel, type LeftPanelTab } from './left-panel';
import { MobileTabBar, type MobileTab } from './mobile-tab-bar';

import { BottomSheet, SideDrawer } from '~/components/ui/sheet';
import { useBreakpoint } from '~/lib/use-media-query';

export type AppShellProps = {
  topbar: ReactNode;
  /** Franja ámbar de servicio caído; se renderiza bajo el topbar (§8). */
  serviceStrip?: ReactNode;
  panelTab: LeftPanelTab;
  onPanelTabChange: (tab: LeftPanelTab) => void;
  capas: ReactNode;
  analisis: ReactNode;
  map: ReactNode;
  inspector: ReactNode;
  inspectorOpen: boolean;
  onInspectorClose: () => void;
  /**
   * Hay reporte que abrir: AOI dibujado **y** análisis terminado. Gobierna el
   * `disabled` de la pestaña móvil `Reporte`.
   */
  hasAoi: boolean;
  /**
   * Navega a `/reporte/{analysisId}`. La pestaña móvil `Reporte` sólo cambiaba
   * `mobileTab` y no llevaba a ninguna parte: quedaba marcada como activa
   * sobre el mapa, sin reporte.
   */
  onReport?: () => void;
};

/**
 * Shell del §2 con las reglas responsive del §9.
 *
 * Principio 1 del brief: el mapa ES la página. Los paneles se acoplan a los
 * costados o encima, nunca por encima del mapa en el flujo de scroll.
 */
export function AppShell({
  topbar,
  serviceStrip,
  panelTab,
  onPanelTabChange,
  capas,
  analisis,
  map,
  inspector,
  inspectorOpen,
  onInspectorClose,
  hasAoi,
  onReport,
}: AppShellProps) {
  const breakpoint = useBreakpoint();

  const [collapsed, setCollapsed] = useState(false);
  const [overlayPanelOpen, setOverlayPanelOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('mapa');

  /*
    §9, 1280-1439: abrir el inspector colapsa el panel izquierdo a riel y al
    cerrarlo se restaura.

    Es DERIVADO, no un efecto con setState: el estado guardado sigue siendo
    "¿lo colapsó el usuario a mano?", y el colapso automático se calcula en el
    render. Así no hay render en cascada y, sobre todo, no hay dos fuentes de
    verdad que puedan desincronizarse.
  */
  const autoCollapsed = breakpoint === 'standard' && inspectorOpen && !collapsed;
  const effectiveCollapsed = collapsed || autoCollapsed;

  /* 1024-1279 y tablet: un panel por vez — abrir el inspector tapa el drawer. */
  const panelDrawerOpen = overlayPanelOpen && !inspectorOpen;

  const panelNode = (
    <LeftPanel
      tab={panelTab}
      onTabChange={onPanelTabChange}
      collapsed={false}
      onCollapsedChange={() => {
        setOverlayPanelOpen(false);
      }}
      autoCollapsed={false}
      capas={capas}
      analisis={analisis}
    />
  );

  if (breakpoint === 'mobile') {
    const sheetTab = mobileTab === 'capas' || mobileTab === 'analisis' ? mobileTab : null;

    return (
      <div className="flex h-dvh flex-col">
        {topbar}
        {serviceStrip}
        <main className="relative min-h-0 flex-1">{map}</main>

        {/* §9 y §12.17: hoja NO modal, con manija Y ✕, y NUNCA apilada — una
            hoja reemplaza a la anterior en vez de abrir una segunda. */}
        <BottomSheet
          open={sheetTab !== null && !inspectorOpen}
          title={sheetTab === 'analisis' ? 'Análisis' : 'Capas'}
          onClose={() => {
            setMobileTab('mapa');
          }}
        >
          {sheetTab === 'analisis' ? analisis : capas}
        </BottomSheet>

        <BottomSheet open={inspectorOpen} title="Detalle" onClose={onInspectorClose}>
          {inspector}
        </BottomSheet>

        <MobileTabBar
          value={mobileTab}
          reportDisabled={!hasAoi}
          onChange={(tab) => {
            // `Reporte` es una RUTA, no un panel: navega y deja la pestaña
            // activa donde estaba, para que volver atrás no aterrice en un
            // estado marcado que nunca se pintó.
            if (tab === 'reporte') {
              onReport?.();
              return;
            }
            setMobileTab(tab);
            if (tab === 'capas') onPanelTabChange('capas');
            if (tab === 'analisis') onPanelTabChange('analisis');
            if (tab !== 'mapa') onInspectorClose();
          }}
        />
      </div>
    );
  }

  if (breakpoint === 'compact' || breakpoint === 'tablet') {
    return (
      <div className="flex h-dvh flex-col">
        {topbar}
        {serviceStrip}
        <div className="relative min-h-0 flex-1">
          {map}

          <SideDrawer
            open={panelDrawerOpen}
            onClose={() => {
              setOverlayPanelOpen(false);
            }}
            title="Capas y análisis"
            side="left"
            width={breakpoint === 'tablet' ? 340 : 360}
            scrim={breakpoint === 'tablet' ? 'full' : 'partial'}
          >
            {panelNode}
          </SideDrawer>

          <SideDrawer
            open={inspectorOpen}
            onClose={onInspectorClose}
            title="Detalle del elemento"
            side="right"
            width={340}
            scrim={breakpoint === 'tablet' ? 'full' : 'none'}
          >
            {inspector}
          </SideDrawer>

          {!panelDrawerOpen ? (
            <button
              type="button"
              onClick={() => {
                setOverlayPanelOpen(true);
                onInspectorClose();
              }}
              className="rounded-btn border-border-base bg-surface text-12 text-fg shadow-popover absolute top-4 left-4 z-20 flex h-10 items-center border px-3 font-medium"
            >
              Capas y análisis
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col">
      {topbar}
      {serviceStrip}
      <div className="flex min-h-0 flex-1">
        <LeftPanel
          tab={panelTab}
          onTabChange={onPanelTabChange}
          collapsed={effectiveCollapsed}
          onCollapsedChange={setCollapsed}
          autoCollapsed={autoCollapsed}
          capas={capas}
          analisis={analisis}
        />
        <main className="relative min-w-0 flex-1">{map}</main>
        {inspector}
      </div>
    </div>
  );
}
