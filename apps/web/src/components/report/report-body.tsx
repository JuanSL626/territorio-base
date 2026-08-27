import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState, type ReactNode } from 'react';

import { SourcesTable } from './citations';
import { StatusBanner } from './narrative-blocks';
import { ReportMapPanel } from './report-map';
import { buildSections, datasetUsage, expandBbox, type ReportMapState, type ReportSection  } from './report-model';
import {
  AreasProtegidasSection,
  ContextoRdSection,
  HidrologiaSection,
  PortadaSection,
  RiesgoCosteroSection,
  SectionShell,
  TopografiaSection,
  VegetacionSection,
} from './sections';
import { type StaticMapGeometries, geometriesOf, geometryBbox, unionBbox  } from './static-map';
import { useScrollSteps } from './use-scroll-steps';

import type { Bbox } from '~/lib/search-params';


import { NoDataCard } from '~/components/states/no-data';
import { Button } from '~/components/ui/button';
import { CompareIcon } from '~/components/ui/icons';
import { Skeleton, SkeletonLines } from '~/components/ui/skeleton';
import { type TerritorioAnalysisSummary, downSources  } from '~/lib/analysis-contract';
import { analysisQueryOptions, useAnalysisSummary } from '~/lib/analysis-queries';
import { cn } from '~/lib/cn';
import { useMediaQuery } from '~/lib/use-media-query';

/**
 * EL CUERPO DEL STORY MAP (§6).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FORMA: SIDECAR
 * ─────────────────────────────────────────────────────────────────────────────
 * Narrativa que scrollea de un lado, mapa pegajoso del otro. Cada sección es un
 * `.step`; al entrar en el viewport activa SU estado de mapa (capas, opacidad,
 * encuadre, resaltado) y el mapa hace un diff contra el actual. Al salir hacia
 * arriba se restaura solo, porque el estado anterior es simplemente el de la
 * sección anterior: no hay una pila de órdenes imperativas que desincronizar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DE DÓNDE SALEN LOS DATOS, Y POR QUÉ EN DOS PEDIDOS
 * ─────────────────────────────────────────────────────────────────────────────
 * El *loader* de la ruta precarga el RESUMEN (sin geometrías): con eso ya se
 * renderiza en el servidor el reporte entero — portada, métricas, conclusiones,
 * fuentes —, así que la primera pintada tiene todo el contenido, es compartible
 * y se imprime aunque el JavaScript no llegue nunca.
 *
 * Las GEOMETRÍAS del análisis completo se piden después, desde el cliente, y
 * sólo alimentan el mapa. Son varios MB de polígonos MEPyD que la narrativa no
 * usa: meterlos en el payload de SSR retrasaría el texto para adelantar un
 * dibujo. Mientras llegan, el panel del mapa muestra su esqueleto y la
 * narrativa ya se lee entera.
 *
 * En `/imprimir` el loader precarga el análisis COMPLETO: la vista de impresión
 * no puede depender de un fetch de cliente que quizá no termine antes de que el
 * navegador abra el diálogo de impresión.
 */

export type ReportSectionId = ReportSection['id'];

export type ReportBodyProps = {
  analysisId: string;
  /** La variante de impresión reemplaza el mapa pegajoso por figuras estáticas (§6.6). */
  print?: boolean;
};

/* -------------------------------------------------------------------------- */
/* Acciones de mapa embebidas en la prosa (§6.3)                               */
/* -------------------------------------------------------------------------- */

type MapOverrideKind = 'hidrologia-cercana' | 'ap-solape';

/**
 * Una acción de prosa no "prende una capa": produce un ESTADO DE MAPA con
 * nombre, derivado del estado del paso actual. Segundo click, se revierte.
 */
function applyOverride(
  state: ReportMapState,
  override: MapOverrideKind | null,
  geometries: StaticMapGeometries | null,
): ReportMapState {
  if (override === null || geometries === null) return state;

  if (override === 'hidrologia-cercana') {
    const nearest = geometries.hydrology.at(0);
    if (nearest === undefined) return state;
    const bbox = geometryBbox(nearest.geometry);
    if (bbox === null) return state;
    return {
      ...state,
      layers: state.layers.includes('osm-hydro') ? state.layers : [...state.layers, 'osm-hydro'],
      bounds: expandBbox(unionBbox(state.bounds, bbox), 80),
      highlight: [`osm-hydro:${String(nearest.osm_id)}`],
      caption: `Encuadre en el elemento de agua más cercano (${
        nearest.name ?? 'sin nombre en OSM'
      }).`,
    };
  }

  const overlapping = geometries.protectedAreas.filter((area) => area.overlap_ha > 0);
  if (overlapping.length === 0) return state;
  let bounds: Bbox = state.bounds;
  for (const area of overlapping) {
    const bbox = geometryBbox(area.geometry);
    if (bbox !== null) bounds = unionBbox(bounds, bbox);
  }
  return {
    ...state,
    layers: state.layers.includes('wdpa') ? state.layers : [...state.layers, 'wdpa'],
    bounds: expandBbox(bounds, 120),
    highlight: ['wdpa:*'],
    caption: 'Áreas protegidas que se solapan con el polígono, resaltadas.',
  };
}

/* -------------------------------------------------------------------------- */
/* Cuerpo                                                                      */
/* -------------------------------------------------------------------------- */

export function ReportBody({ analysisId, print = false }: ReportBodyProps) {
  const summaryQuery = useAnalysisSummary(analysisId);
  /*
    El análisis completo (con geometrías) sólo alimenta el mapa. En `/imprimir`
    el loader ya lo dejó en la caché, así que acá sale caliente y no hay fetch.
  */
  const fullQuery = useQuery(analysisQueryOptions(analysisId));

  const full = fullQuery.data?.ok === true ? fullQuery.data.analysis : null;
  const summary: TerritorioAnalysisSummary | null =
    full ?? (summaryQuery.data?.ok === true ? summaryQuery.data.analysis : null);

  const geometries = useMemo(() => (full === null ? null : geometriesOf(full)), [full]);

  /*
    `prefers-reduced-motion` no cambia QUÉ se muestra, sólo CÓMO se llega: sin
    vuelo, el paso cambia de golpe. La coreografía (capas y encuadre por
    sección) es contenido y no se toca.
  */
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const fly = !reducedMotion && !print;

  const sections = useMemo(
    () => (summary === null ? [] : buildSections(summary, { fly })),
    [summary, fly],
  );
  const sectionIds = useMemo(() => sections.map((section) => section.id), [sections]);

  const narrativeRef = useRef<HTMLDivElement | null>(null);
  const activeId = useScrollSteps(sectionIds, narrativeRef);

  /*
    Lo que fija el ⤢ y lo que fija una acción de prosa duran hasta el PASO
    SIGUIENTE. Se guarda junto al paso en el que se fijó y se compara al leer,
    en vez de limpiarlo desde un efecto: un `setState` dentro de un efecto que
    depende del paso activo produce un render de más en cada scroll.
  */
  const [pinned, setPinned] = useState<{ sectionId: string; at: string } | null>(null);
  const [override, setOverride] = useState<{ kind: MapOverrideKind; at: string } | null>(null);
  const [narrativeLeft, setNarrativeLeft] = useState(true);

  const pinnedId = pinned !== null && pinned.at === activeId ? pinned.sectionId : null;
  const activeOverride = override !== null && override.at === activeId ? override.kind : null;

  const currentSection =
    sections.find((section) => section.id === (pinnedId ?? activeId)) ?? sections[0];
  const mapState =
    currentSection === undefined
      ? null
      : applyOverride(currentSection.map, activeOverride, geometries);

  /* ---------------------------------------------------------------------- */
  /* Estados de carga / rechazo                                              */
  /* ---------------------------------------------------------------------- */

  if (summary === null) {
    const refusal =
      summaryQuery.data?.ok === false
        ? summaryQuery.data
        : fullQuery.data?.ok === false
          ? fullQuery.data
          : null;

    if (refusal !== null) {
      return (
        <NoDataCard
          title={
            refusal.reason === 'no-listo' ? 'El análisis todavía no terminó' : 'Reporte no disponible'
          }
          reason={refusal.message}
          service={refusal.reason === 'no-encontrado' ? undefined : 'Territorio Base'}
          onRetry={() => {
            void summaryQuery.refetch();
          }}
          retryLabel="Volver a intentar"
        />
      );
    }

    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-6 w-2/3" />
        <SkeletonLines lines={4} />
        <Skeleton className="h-40 w-full" />
        <SkeletonLines lines={5} />
      </div>
    );
  }

  const down = downSources(summary);
  const usage = datasetUsage(summary);
  const geometriesLoading = fullQuery.isPending || (full === null && fullQuery.isFetching);

  const renderSection = (section: ReportSection): ReactNode => {
    const common = {
      analysis: summary,
      section,
      print,
      onShowOnMap: (id: string) => {
        setPinned({ sectionId: id, at: activeId });
      },
      inlineMap: (
        <ReportMapPanel
          state={section.map}
          geometries={geometries}
          loading={geometriesLoading}
          sticky={false}
          className="h-64 print:h-80"
        />
      ),
    };

    switch (section.id) {
      case 'portada':
        return <PortadaSection key={section.id} {...common} />;
      case 'topografia':
        return <TopografiaSection key={section.id} {...common} />;
      case 'vegetacion':
        return <VegetacionSection key={section.id} {...common} />;
      case 'hidrologia':
        return (
          <HidrologiaSection
            key={section.id}
            {...common}
            nearestAction={{
              active: activeOverride === 'hidrologia-cercana',
              onToggle: () => {
                setOverride(
                  activeOverride === 'hidrologia-cercana'
                    ? null
                    : { kind: 'hidrologia-cercana', at: activeId },
                );
              },
            }}
          />
        );
      case 'areas-protegidas':
        return (
          <AreasProtegidasSection
            key={section.id}
            {...common}
            overlapAction={{
              active: activeOverride === 'ap-solape',
              onToggle: () => {
                setOverride(
                  activeOverride === 'ap-solape' ? null : { kind: 'ap-solape', at: activeId },
                );
              },
            }}
          />
        );
      case 'riesgo-costero':
        return <RiesgoCosteroSection key={section.id} {...common} />;
      case 'contexto-rd':
        return <ContextoRdSection key={section.id} {...common} />;
      case 'fuentes':
        return (
          <SectionShell
            key={section.id}
            section={section}
            inlineMap={common.inlineMap}
            className="print-page-break"
          >
            <SourcesTable usage={usage} />
          </SectionShell>
        );
    }
  };

  const narrative = (
    <div ref={narrativeRef} className="flex min-w-0 flex-col">
      {down.length > 0 ? (
        /*
          Aviso de resultado PARCIAL, no de incidente en curso. La franja ámbar
          del §8 dice "reintentando (2/5)" porque describe una caída viva; acá
          el análisis ya terminó y lo que hay que comunicar es otra cosa: qué
          fuentes faltan en ESTE reporte y por qué lo que no aparece no es una
          ausencia comprobada.
        */
        <div className="px-6 pt-6 md:px-8">
          <StatusBanner
            banner={{
              state: 'no-consultado',
              tone: 'danger',
              headline: `Reporte parcial: ${String(down.length)} fuente(s) no respondieron.`,
            }}
          >
            <ul className="flex flex-col gap-1">
              {down.map((source) => (
                <li key={source.id} className="text-12 text-fg">
                  <span className="font-medium">{source.service}</span>{' '}
                  <span className="text-fg-muted">
                    — {source.error ?? 'El servicio no respondió.'}
                  </span>
                </li>
              ))}
            </ul>
          </StatusBanner>
        </div>
      ) : null}

      <div className="divide-border-base flex flex-col divide-y px-6 md:px-8">
        {sections.map(async (section) => await renderSection(section))}
      </div>
    </div>
  );

  if (print) {
    return <div className="flex flex-col">{narrative}</div>;
  }

  return (
    <div className="relative">
      <nav
        aria-label="Secciones del reporte"
        className="no-print border-border-base bg-surface/95 sticky top-0 z-10 flex gap-1 overflow-x-auto border-b px-4 py-2 backdrop-blur"
      >
        {sections.map((section) => (
          <a
            key={section.id}
            href={`#seccion-${section.id}`}
            aria-current={section.id === activeId ? 'true' : undefined}
            className={cn(
              'rounded-chip text-11 shrink-0 px-2 py-1 font-medium whitespace-nowrap transition-colors',
              section.id === activeId
                ? 'bg-accent-soft text-accent'
                : 'text-fg-muted hover:bg-surface-3',
            )}
          >
            {section.eyebrow}
          </a>
        ))}
        <span className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          leadingIcon={<CompareIcon size={13} />}
          onClick={() => {
            setNarrativeLeft((value) => !value);
          }}
        >
          Cambiar de lado
        </Button>
      </nav>

      <div
        className={cn(
          'flex flex-col md:flex-row md:items-start',
          narrativeLeft ? null : 'md:flex-row-reverse',
        )}
      >
        <div className="w-full min-w-0 md:w-[42%] md:max-w-[620px] md:min-w-[420px]">
          {narrative}
        </div>

        {/*
          El mapa pegajoso sólo existe de `md` para arriba. Debajo de eso el §9
          manda mapa EN LÍNEA arriba de cada sección, que es lo que ya renderiza
          `inlineMap`: dos mapas simultáneos en un teléfono es exactamente el
          antipatrón que el brief pide evitar.
        */}
        {mapState === null ? null : (
          <ReportMapPanel
            state={mapState}
            geometries={geometries}
            loading={geometriesLoading}
            sticky
            className="hidden md:flex md:flex-1"
          />
        )}
      </div>
    </div>
  );
}
