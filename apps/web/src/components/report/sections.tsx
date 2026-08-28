
import { DistributionChart, rowsFromClasses, StatList } from './charts';
import { SectionCitations } from './citations';
import { MetricCard, type CardDownload  } from './metric-card';
import {
  chartTextEquivalent,
  coastalConclusions,
  executiveSummary,
  hydrologyBanner,
  hydrologyConclusions,
  mepydConclusions,
  protectedBanner,
  protectedConclusions,
  tallyMepyd,
  topographyConclusions,
  vegetationConclusions,
} from './narrative';
import { Conclusions, MapAction, StatusBanner } from './narrative-blocks';
import { locationLabel, type ReportSection  } from './report-model';

import type { CoastalPreset } from '@territorio/api-client';
import type { ReactNode } from 'react';
import type { TerritorioAnalysisSummary } from '~/lib/analysis-contract';

import { publicRasterBaseUrl } from '~/components/map/raster-base';
import { NoDataCard } from '~/components/states/no-data';
import {
  IUCN_LABELS,
  NDVI_DENSITY_CLASSES,
  OSM_HYDRO_KIND_LABELS,
  SLOPE_CLASSES,
  WORLDCOVER_CLASSES,
} from '~/layers/palettes';
import { cn } from '~/lib/cn';
import {
  formatElevation,
  formatHectares,
  formatLonLat,
  formatNumber,
  formatPercent,
} from '~/lib/format';

/**
 * Las secciones del §6.2, una por tema analizado.
 *
 * Cada una carga lo mismo: la vista de mapa del tema (que la maneja el sidecar
 * a través del estado declarativo de `report-model.ts`), las tarjetas de
 * métrica con la anatomía única del §6.4, **las conclusiones en castellano
 * llano derivadas de los números reales**, y la cita de sus fuentes.
 *
 * Ninguna sección se renderiza vacía: cuando la fuente no respondió sale un
 * bloque `no-data` con el motivo y el servicio, reusando el componente de
 * estados que ya existe (§8). Un gráfico en blanco no es una opción.
 */

export type SectionShellProps = {
  section: ReportSection;
  /** Mapa en línea: en móvil va ARRIBA de cada sección, en vez del pegajoso. */
  inlineMap?: ReactNode;
  children: ReactNode;
  className?: string;
};

/**
 * `data-step-id` es lo que observa `useScrollSteps`. Va acá y no en cada
 * sección concreta para que agregar una sección nueva no pueda olvidarlo.
 */
export function SectionShell({ section, inlineMap, children, className }: SectionShellProps) {
  return (
    <section
      id={`seccion-${section.id}`}
      data-step-id={section.id}
      aria-labelledby={`titulo-${section.id}`}
      className={cn('flex scroll-mt-16 flex-col gap-4 py-10 first:pt-6', className)}
    >
      {inlineMap == null ? null : <div className="md:hidden">{inlineMap}</div>}

      <header>
        <p className="text-11 text-fg-subtle font-semibold tracking-wide uppercase">
          {section.eyebrow}
        </p>
        <h2 id={`titulo-${section.id}`} className="text-18 text-fg mt-1 font-semibold">
          {section.title}
        </h2>
      </header>

      {children}

      <SectionCitations layerIds={section.citedLayerIds} />
    </section>
  );
}

/**
 * Id del registro → capa raster del servicio.
 *
 * `slope-classes` mapea a `slope`: las clases son una reclasificación del mismo
 * GeoTIFF continuo, y es ese archivo el que se descarga. Ningún otro id se
 * inventa: el que no está acá es vectorial y se baja desde Exportar.
 */
const RASTER_ARTIFACT: Record<string, string> = {
  dem: 'dem',
  slope: 'slope',
  'slope-classes': 'slope',
  aspect: 'aspect',
  ndvi: 'ndvi',
  'ndvi-density': 'ndvi_density',
  worldcover: 'worldcover',
  aqueduct: 'coastal',
};

export function downloadForLayer(
  analysis: TerritorioAnalysisSummary,
  layerId: string,
): CardDownload {
  const artifact = RASTER_ARTIFACT[layerId];
  if (artifact === undefined) {
    return {
      kind: 'unavailable',
      reason: 'Capa vectorial: se descarga como Shapefile o GeoJSON desde Exportar.',
    };
  }

  const entry = analysis.layers.find((layer) => layer.layer === artifact);
  if (!entry?.available) {
    return { kind: 'unavailable', reason: 'Esta corrida no produjo el archivo de esta capa.' };
  }
  const url = entry.raster_url;
  if (url == null || url === '') {
    return { kind: 'unavailable', reason: 'El servicio no publicó una URL de descarga para esta capa.' };
  }
  /*
    `raster_url` viene RELATIVA al servicio raster (`/analysis/{id}/raster/dem.tif`),
    no a la app web. Sin anteponer la base del proxy, el `<a download>` apunta
    al origen del SSR, que responde el HTML de 404 — y el navegador lo guarda
    con extensión `.tif`. `publicRasterBaseUrl()` (`raster-base.ts`) siempre
    devuelve algo: es el proxy del mismo origen, no la URL desnuda del
    servicio, así que ya no hay un caso "sin base pública" que degradar acá.
  */
  if (/^https?:\/\//i.test(url)) {
    return { kind: 'ready', href: url, filename: entry.download_filename };
  }
  const base = publicRasterBaseUrl();
  return {
    kind: 'ready',
    href: `${base}${url.startsWith('/') ? '' : '/'}${url}`,
    filename: entry.download_filename,
  };
}

export type SectionProps = {
  analysis: TerritorioAnalysisSummary;
  section: ReportSection;
  print: boolean;
  onShowOnMap: (sectionId: string) => void;
  inlineMap?: ReactNode;
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  // `es-DO` no está garantizado en Node: se arma a mano para que el SSR y el
  // cliente produzcan EXACTAMENTE el mismo string (mismo criterio que format.ts).
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = String(date.getUTCFullYear());
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hour}:${minute} UTC`;
}

export function PortadaSection({ analysis, section, inlineMap }: SectionProps) {
  const lines = executiveSummary(analysis);
  const [minLon, minLat, maxLon, maxLat] = analysis.aoi.bbox;
  const center = formatLonLat((minLon + maxLon) / 2, (minLat + maxLat) / 2);
  const location = locationLabel(analysis);
  /*
    `locationLabel` vuelve `null` en dos casos MUY distintos: el AOI está
    realmente fuera de RD (`!in_rd`), o está dentro pero la capa de división
    político-administrativa no devolvió un municipio (falló o no matcheó).
    Antes de este fix el segundo caso también mostraba "Fuera de República
    Dominicana" — un dato inventado, no una ausencia — que es justo la
    confusión "no se pudo consultar" vs "no hay" que el resto de este reporte
    se cuida de no cometer (ver el resumen ejecutivo, arriba). El fallback acá
    replica esa distinción para "Ubicación".
  */
  const locationText = !analysis.mepyd_rd.in_rd
    ? 'Fuera de República Dominicana'
    : (location ?? 'Dentro de RD — municipio no determinado');

  return (
    <SectionShell section={section} inlineMap={inlineMap}>
      <dl className="rounded-panel border-border-base bg-surface print-card grid grid-cols-2 gap-x-4 gap-y-2 border p-4">
        <div>
          <dt className="text-11 text-fg-subtle">Superficie</dt>
          <dd className="tabular text-15 text-fg font-semibold">
            {formatHectares(analysis.aoi.area_ha)}
          </dd>
        </div>
        <div>
          <dt className="text-11 text-fg-subtle">Centro del área</dt>
          <dd className="tabular text-13 text-fg font-medium">{center}</dd>
        </div>
        <div>
          <dt className="text-11 text-fg-subtle">Ubicación</dt>
          <dd className="text-13 text-fg font-medium">{locationText}</dd>
        </div>
        <div>
          <dt className="text-11 text-fg-subtle">Zona UTM del cálculo</dt>
          {/* El código EPSG es un IDENTIFICADOR, no una cantidad: nunca lleva
              separador de miles («EPSG:32 619» no existe). */}
          <dd className="tabular text-13 text-fg font-medium">
            EPSG:{String(analysis.aoi.utm_epsg)}
          </dd>
        </div>
        <div>
          <dt className="text-11 text-fg-subtle">Análisis</dt>
          <dd className="tabular text-13 text-fg font-medium">
            {formatDate(analysis.finished_at ?? analysis.created_at)}
          </dd>
        </div>
        <div>
          <dt className="text-11 text-fg-subtle">Vértices del polígono</dt>
          <dd className="tabular text-13 text-fg font-medium">
            {formatNumber(analysis.aoi.vertex_count, 0)}
          </dd>
        </div>
      </dl>

      <div>
        <h3 className="text-15 text-fg font-semibold">Resumen ejecutivo</h3>
        <p className="text-12 text-fg-muted mt-1">
          Un número por tema. Donde dice «No se pudo consultar», el servicio no respondió: no es un
          cero, es un dato que falta.
        </p>
        <ul className="mt-3 flex flex-col">
          {lines.map((line) => (
            <li
              key={line.id}
              className="border-border-base/60 print-card flex items-baseline justify-between gap-4 border-b py-2 last:border-b-0"
            >
              <span className="text-13 text-fg-muted min-w-0">
                {line.label}
                {line.note == null ? null : (
                  <span className="text-11 text-fg-subtle block">{line.note}</span>
                )}
              </span>
              <span className="tabular text-13 text-fg shrink-0 text-right font-semibold">
                {line.value}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </SectionShell>
  );
}

export function TopografiaSection({
  analysis,
  section,
  print,
  onShowOnMap,
  inlineMap,
}: SectionProps) {
  const topography = analysis.topography;
  const summary = topography.summary;

  if (!topography.available || summary == null) {
    return (
      <SectionShell section={section} inlineMap={inlineMap}>
        <NoDataCard
          title="Topografía sin datos"
          reason={
            topography.error ??
            'El servicio de elevación no respondió en esta corrida. El resto del análisis sí se completó.'
          }
          service="Copernicus DEM GLO-30 (Planetary Computer)"
        />
        <Conclusions items={topographyConclusions(topography)} />
      </SectionShell>
    );
  }

  const rows = rowsFromClasses(summary.slope_class_pct, SLOPE_CLASSES, { sparse: false });
  const equivalent = chartTextEquivalent('Clases de pendiente', rows);

  return (
    <SectionShell section={section} inlineMap={inlineMap}>
      <Conclusions items={topographyConclusions(topography)} />

      <MetricCard
        title="Elevación"
        layerId="dem"
        print={print}
        onShowOnMap={() => {
          onShowOnMap(section.id);
        }}
        download={downloadForLayer(analysis, 'dem')}
        footnote="Copernicus DEM GLO-30 (30 m) recortado al polígono y reproyectado a la zona UTM local."
      >
        <StatList
          stats={[
            { label: 'Mínima', value: formatElevation(summary.elevation_min_m) },
            { label: 'Máxima', value: formatElevation(summary.elevation_max_m) },
            { label: 'Promedio', value: formatElevation(summary.elevation_mean_m) },
            { label: 'Desnivel', value: formatElevation(summary.elevation_range_m) },
          ]}
        />
      </MetricCard>

      <MetricCard
        title="Clases de pendiente"
        layerId="slope-classes"
        print={print}
        onShowOnMap={() => {
          onShowOnMap(section.id);
        }}
        download={downloadForLayer(analysis, 'slope-classes')}
        footnote={`${equivalent} Pendiente media ${formatPercent(
          summary.slope_mean_pct,
        )} · máx. ${formatPercent(summary.slope_max_pct)}.`}
      >
        <DistributionChart
          rows={rows}
          textEquivalent={equivalent}
          emptyText="El servicio no devolvió la distribución de clases de pendiente."
        />
      </MetricCard>
    </SectionShell>
  );
}

export function VegetacionSection({
  analysis,
  section,
  print,
  onShowOnMap,
  inlineMap,
}: SectionProps) {
  const vegetation = analysis.vegetation;
  const summary = vegetation.summary;

  const densityRows = rowsFromClasses(
    summary?.ndvi_density_class_pct,
    NDVI_DENSITY_CLASSES,
    { sparse: false },
  );
  const coverRows = rowsFromClasses(summary?.worldcover_landcover_pct, WORLDCOVER_CLASSES, {
    sparse: true,
  });

  const densityEquivalent = chartTextEquivalent('Densidad de vegetación', densityRows);
  const coverEquivalent = chartTextEquivalent('Cobertura de suelo (ESA WorldCover 2021)', coverRows);

  return (
    <SectionShell section={section} inlineMap={inlineMap}>
      <Conclusions items={vegetationConclusions(vegetation)} />

      {vegetation.ndvi_available ? (
        <MetricCard
          title="Densidad de vegetación (NDVI)"
          layerId="ndvi-density"
          print={print}
          onShowOnMap={() => {
            onShowOnMap(section.id);
          }}
          download={downloadForLayer(analysis, 'ndvi-density')}
          footnote={densityEquivalent}
        >
          <DistributionChart
            rows={densityRows}
            textEquivalent={densityEquivalent}
            emptyText="No hay distribución de clases de densidad en esta corrida."
          />
          {summary == null ? null : (
            <div className="border-border-base/60 mt-3 border-t pt-3">
              <StatList
                stats={[
                  {
                    label: 'NDVI promedio',
                    value: summary.ndvi_mean == null ? '—' : formatNumber(summary.ndvi_mean, 2),
                  },
                  {
                    label: 'NDVI mediano',
                    value: summary.ndvi_median == null ? '—' : formatNumber(summary.ndvi_median, 2),
                  },
                  {
                    label: 'NDVI percentil 90',
                    value: summary.ndvi_p90 == null ? '—' : formatNumber(summary.ndvi_p90, 2),
                  },
                ]}
              />
              <p className="text-11 text-fg-subtle mt-2">
                El percentil 90 es el valor que supera sólo el 10 % más verde del polígono: sirve
                para saber cuán densa llega a ser la vegetación en sus mejores sectores.
              </p>
            </div>
          )}
        </MetricCard>
      ) : (
        <NoDataCard
          title="NDVI sin datos"
          reason={
            vegetation.ndvi_error ??
            'No hubo escenas Sentinel-2 con menos de 30 % de nubes en los últimos 180 días. No significa que no haya vegetación: significa que no se pudo medir.'
          }
          service="Sentinel-2 L2A (Planetary Computer)"
        />
      )}

      {vegetation.worldcover_available ? (
        <MetricCard
          title="Cobertura de suelo (WorldCover)"
          layerId="worldcover"
          print={print}
          onShowOnMap={() => {
            onShowOnMap(section.id);
          }}
          download={downloadForLayer(analysis, 'worldcover')}
          footnote={`${coverEquivalent} Sólo se listan las clases presentes en el polígono.${
            summary?.worldcover_tree_cover_pct == null
              ? ''
              : ` Cobertura arbórea ${formatPercent(summary.worldcover_tree_cover_pct)}.`
          }`}
        >
          <DistributionChart
            rows={coverRows}
            textEquivalent={coverEquivalent}
            emptyText="ESA WorldCover no devolvió clases dentro del polígono."
          />
        </MetricCard>
      ) : (
        <NoDataCard
          title="Cobertura de suelo sin datos"
          reason={
            vegetation.worldcover_error ??
            'ESA WorldCover no respondió en esta corrida. El resto del análisis sí se completó.'
          }
          service="ESA WorldCover 2021 (Planetary Computer)"
        />
      )}
    </SectionShell>
  );
}

export type HydrologySectionProps = SectionProps & {
  nearestAction?: { active: boolean; onToggle: () => void };
};

export function HidrologiaSection({
  analysis,
  section,
  print,
  onShowOnMap,
  inlineMap,
  nearestAction,
}: HydrologySectionProps) {
  const summary = analysis.hydrology.summary;
  const banner = hydrologyBanner(summary);
  const features = summary.features;
  const nearest = features.at(0);

  return (
    <SectionShell section={section} inlineMap={inlineMap}>
      <StatusBanner banner={banner} />
      <Conclusions items={hydrologyConclusions(summary)} />

      {nearestAction === undefined || nearest === undefined || print ? null : (
        <p className="text-13 text-fg-muted">
          En el mapa:{' '}
          <MapAction
            label="ver el cauce más cercano"
            describedView={`Encuadrar el mapa en el elemento de agua más cercano, a ${formatNumber(
              nearest.distance_m,
              0,
            )} metros del polígono`}
            active={nearestAction.active}
            onToggle={nearestAction.onToggle}
          />
          .
        </p>
      )}

      {summary.available ? (
        <MetricCard
          title="Elementos de agua encontrados"
          layerId="osm-hydro"
          print={print}
          onShowOnMap={() => {
            onShowOnMap(section.id);
          }}
          download={downloadForLayer(analysis, 'osm-hydro')}
          footnote="Consulta a Overpass dentro de un buffer de 500 m alrededor del polígono, ordenada por distancia."
        >
          <StatList
            stats={[
              { label: 'Elementos', value: formatNumber(summary.features_found, 0) },
              { label: 'Intersecta el polígono', value: summary.intersects_aoi ? 'Sí' : 'No' },
              {
                label: 'Distancia al más cercano',
                value:
                  summary.nearest_distance_m == null
                    ? '—'
                    : `${formatNumber(summary.nearest_distance_m, 0)} m`,
              },
            ]}
          />

          {features.length === 0 ? (
            <p className="text-12 text-fg-muted mt-3">Sin elementos.</p>
          ) : (
            <div className="mt-3 max-h-80 overflow-auto print:max-h-none print:overflow-visible">
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">
                  Elementos de hidrología de OpenStreetMap ordenados por distancia al polígono.
                </caption>
                <thead>
                  <tr className="border-border-base border-b">
                    {['OSM id', 'Tipo', 'Nombre', 'Distancia'].map((heading) => (
                      <th
                        key={heading}
                        scope="col"
                        className="text-11 text-fg-subtle bg-surface sticky top-0 py-1 font-semibold"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {features.map((feature) => (
                    <tr key={feature.osm_id} className="border-border-base/60 border-b">
                      <td className="tabular text-11 text-fg-muted py-1">{feature.osm_id}</td>
                      <td className="text-11 text-fg py-1">
                        {OSM_HYDRO_KIND_LABELS[feature.kind] ?? feature.kind}
                      </td>
                      <td className="text-11 text-fg py-1">{feature.name ?? 'Sin nombre en OSM'}</td>
                      <td className="tabular text-11 text-fg py-1">
                        {feature.distance_m <= 0
                          ? '0 m (intersecta)'
                          : `${formatNumber(feature.distance_m, 0)} m`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </MetricCard>
      ) : null}
    </SectionShell>
  );
}

export type ProtectedSectionProps = SectionProps & {
  overlapAction?: { active: boolean; onToggle: () => void };
};

export function AreasProtegidasSection({
  analysis,
  section,
  print,
  onShowOnMap,
  inlineMap,
  overlapAction,
}: ProtectedSectionProps) {
  const summary = analysis.protected_areas.summary;
  const banner = protectedBanner(summary);
  const areas = summary.areas;
  const overlapping = areas.filter((area) => area.overlap_ha > 0);

  return (
    <SectionShell section={section} inlineMap={inlineMap}>
      <StatusBanner banner={banner}>
        {banner.state === 'intersecta' ? (
          <ul className="flex flex-col gap-1">
            {overlapping.map((area, index) => (
              <li key={`${area.name ?? 'sin-nombre'}-${String(index)}`} className="text-12 text-fg">
                <span className="font-medium">{area.name ?? 'Área sin nombre en la WDPA'}</span>
                {area.desig == null ? null : <span className="text-fg-muted"> · {area.desig}</span>}
                <span className="text-fg-muted">
                  {' '}
                  · solape {formatHectares(area.overlap_ha)}
                  {analysis.aoi.area_ha > 0
                    ? ` (${formatPercent((area.overlap_ha / analysis.aoi.area_ha) * 100)} del polígono)`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </StatusBanner>

      <Conclusions items={protectedConclusions(summary, analysis.aoi.area_ha)} />

      {overlapAction === undefined || !summary.intersects_aoi || print ? null : (
        <p className="text-13 text-fg-muted">
          En el mapa:{' '}
          <MapAction
            label="ver el solape"
            describedView="Resaltar en el mapa las áreas protegidas que se solapan con el polígono"
            active={overlapAction.active}
            onToggle={overlapAction.onToggle}
          />
          .
        </p>
      )}

      {summary.available ? (
        <MetricCard
          title="Áreas protegidas cercanas"
          layerId="wdpa"
          print={print}
          onShowOnMap={() => {
            onShowOnMap(section.id);
          }}
          download={downloadForLayer(analysis, 'wdpa')}
          footnote="WDPA (UNEP-WCMC) dentro de un buffer de 1 km alrededor del polígono; el solape se calcula en la zona UTM local."
        >
          <StatList
            stats={[
              { label: 'Áreas encontradas', value: formatNumber(summary.areas_found, 0) },
              { label: 'Solape', value: formatHectares(summary.overlap_ha) },
              { label: 'Solape (% del AOI)', value: formatPercent(summary.overlap_pct_of_aoi) },
              {
                label: 'Distancia a la más cercana',
                value:
                  summary.nearest_distance_m == null
                    ? '—'
                    : `${formatNumber(summary.nearest_distance_m, 0)} m`,
              },
            ]}
          />

          {areas.length === 0 ? (
            <p className="text-12 text-fg-muted mt-3">Sin áreas encontradas.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">
                  Áreas protegidas de la WDPA cercanas al polígono, ordenadas por distancia.
                </caption>
                <thead>
                  <tr className="border-border-base border-b">
                    {['Nombre', 'Designación', 'Categoría UICN', 'Estado', 'Distancia', 'Solape'].map(
                      (heading) => (
                        <th
                          key={heading}
                          scope="col"
                          className="text-11 text-fg-subtle py-1 font-semibold"
                        >
                          {heading}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {areas.map((area, index) => (
                    <tr
                      key={`${area.name ?? 'sin-nombre'}-${String(index)}`}
                      className="border-border-base/60 border-b"
                    >
                      <td className="text-11 text-fg py-1">{area.name ?? 'Sin nombre'}</td>
                      <td className="text-11 text-fg-muted py-1">{area.desig ?? '—'}</td>
                      <td className="text-11 text-fg-muted py-1">
                        {area.iucn_cat == null
                          ? '—'
                          : (IUCN_LABELS[area.iucn_cat] ?? area.iucn_cat)}
                      </td>
                      <td className="text-11 text-fg-muted py-1">{area.status ?? '—'}</td>
                      <td className="tabular text-11 text-fg py-1">
                        {area.distance_m <= 0
                          ? '0 m (intersecta)'
                          : `${formatNumber(area.distance_m, 0)} m`}
                      </td>
                      <td className="tabular text-11 text-fg py-1">
                        {formatHectares(area.overlap_ha)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </MetricCard>
      ) : null}
    </SectionShell>
  );
}

export function RiesgoCosteroSection({
  analysis,
  section,
  print,
  onShowOnMap,
  inlineMap,
}: SectionProps) {
  const coastal = analysis.coastal;
  if (coastal === null) return null;

  const summary = coastal.summary;
  const preset: CoastalPreset = coastal.preset;

  return (
    <SectionShell section={section} inlineMap={inlineMap}>
      <p className="text-12 text-fg-muted">
        El reporte del sistema anterior omitía esta sección aunque el escenario se hubiera
        consultado: los resultados vivían sólo en la sesión del navegador. Acá quedan como parte del
        análisis, con el escenario y el período de retorno dichos en el título.
      </p>

      <Conclusions items={coastalConclusions(coastal)} />

      {coastal.available && summary?.has_data === true ? (
        <MetricCard
          title={`Inundación proyectada — ${preset}`}
          layerId="aqueduct"
          print={print}
          onShowOnMap={() => {
            onShowOnMap(section.id);
          }}
          download={downloadForLayer(analysis, 'aqueduct')}
          footnote="WRI Aqueduct Floods v2 (Ward et al., 2020), subsidencia wtsub, percentil 95. Herramienta de tamizaje a ~927 m, no un estudio de detalle."
        >
          <StatList
            stats={[
              {
                label: 'Área inundada',
                value: formatPercent(summary.pct_area_flooded ?? 0),
              },
              {
                label: 'Profundidad máxima',
                value:
                  summary.max_depth_m == null ? '—' : `${formatNumber(summary.max_depth_m, 1)} m`,
              },
              {
                label: 'Profundidad media (donde inunda)',
                value:
                  summary.mean_depth_where_flooded_m == null
                    ? '—'
                    : `${formatNumber(summary.mean_depth_where_flooded_m, 1)} m`,
              },
              {
                label: 'Resolución',
                value: `~${formatNumber(summary.resolution_m_approx ?? 927, 0)} m`,
              },
            ]}
          />
        </MetricCard>
      ) : null}
    </SectionShell>
  );
}

/** Columnas dinámicas: el esquema de atributos es distinto por capa (§6). */
function columnsOf(features: readonly Record<string, string | number | boolean | null>[]): string[] {
  const columns: string[] = [];
  for (const feature of features) {
    for (const key of Object.keys(feature)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }
  return columns;
}

const MEPYD_TABLE_ROWS = 10;

export function ContextoRdSection({ analysis, section, print, inlineMap }: SectionProps) {
  const mepyd = analysis.mepyd_rd;
  const groups = tallyMepyd(mepyd.summary);

  return (
    <SectionShell section={section} inlineMap={inlineMap}>
      <p className="text-12 text-fg-muted">
        Capas del Sistema de Información para la Gestión del Riesgo de Desastres y la Adaptación al
        Cambio Climático del MEPyD (Explorador de Riesgo 2.1), consultadas dentro de un buffer de
        500 m alrededor del polígono.
      </p>

      <Conclusions items={mepydConclusions(mepyd)} />

      {groups.length === 0 ? (
        <p className="rounded-panel border-border-strong text-12 text-fg-muted print-card border border-dashed p-4">
          Sin resultados (servicios sin respuesta o sin elementos cerca del AOI).
        </p>
      ) : (
        groups.map((group) => (
          <div key={group.group} className="flex flex-col gap-2">
            <h3 className="text-15 text-fg font-semibold">{group.group}</h3>
            {group.layers.map((layer) => {
              const entry = mepyd.summary[group.group]?.[layer.label];
              const features = entry?.features ?? [];
              const columns = columnsOf(features);
              const shown = features.slice(0, MEPYD_TABLE_ROWS);

              return (
                <details
                  key={layer.label}
                  open={print}
                  className="rounded-panel border-border-base bg-surface print-card border"
                >
                  <summary className="text-13 text-fg cursor-pointer px-3 py-2 font-medium">
                    {layer.label} ({formatNumber(layer.count, 0)})
                  </summary>
                  <div className="border-border-base border-t px-3 py-2">
                    {columns.length === 0 ? (
                      <p className="text-12 text-fg-muted">Sin atributos.</p>
                    ) : (
                      <>
                        <div className="overflow-x-auto">
                          <table className="w-full border-collapse text-left">
                            <caption className="sr-only">
                              Atributos devueltos por la capa {layer.label} del MEPyD.
                            </caption>
                            <thead>
                              <tr className="border-border-base border-b">
                                {columns.map((column) => (
                                  <th
                                    key={column}
                                    scope="col"
                                    className="text-11 text-fg-subtle py-1 pr-3 font-semibold whitespace-nowrap"
                                  >
                                    {column}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {shown.map((feature, index) => (
                                <tr key={index} className="border-border-base/60 border-b">
                                  {columns.map((column) => {
                                    const value = feature[column];
                                    return (
                                      <td
                                        key={column}
                                        className="text-11 text-fg py-1 pr-3 whitespace-nowrap"
                                      >
                                        {value == null
                                          ? '—'
                                          : typeof value === 'number'
                                            ? formatNumber(value, 0)
                                            : String(value)}
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {features.length > shown.length ? (
                          <p className="text-11 text-fg-subtle mt-2">
                            Mostrando {formatNumber(shown.length, 0)} de{' '}
                            {formatNumber(features.length, 0)} elementos. La tabla completa viaja en
                            la exportación.
                          </p>
                        ) : null}
                      </>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        ))
      )}
    </SectionShell>
  );
}
