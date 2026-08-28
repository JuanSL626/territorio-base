import { Link, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { ArtifactPicker } from './artifact-picker';
import { AttributionNotice } from './attribution-notice';

import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import { Dialog } from '~/components/ui/dialog';
import { AlertIcon, DownloadIcon, ExternalIcon } from '~/components/ui/icons';
import { Select } from '~/components/ui/select';
import { Tabs, TabPanel } from '~/components/ui/tabs';
import { useToast } from '~/components/ui/toast';
import {
  defaultSelection,
  REPORT_SECTION_IDS,
  REPORT_SECTION_LABELS,
  totalEstimatedBytes,
  type ExportCrsOption,
  type ExportPlan,
  type ReportSectionId,
} from '~/lib/export-contract';
import {
  planFromResult,
  useExportPlan,
  useReportMarkdown,
  useStartExport,
} from '~/lib/export-queries';
import { formatBytes, formatHectares } from '~/lib/format';

/*
  Modal de exportación — design brief §7.2. Dos pestañas de ~520px: "Datos"
  (los artefactos que ESTE análisis produjo, agrupados como el panel de
  capas, con CRS, recorte y tamaño estimado) e "Impresión" (secciones del
  reporte, vista de impresión que produce el PDF, y el Markdown suelto).
  Debajo de ambas, siempre visible, el bloque de atribución y licencias.

  No hay pestaña "Rápido" (imagen del mapa): existió como UI y nunca como
  función — la captura de un canvas WebGL sólo puede hacerla quien tiene la
  instancia de MapLibre (creada con `preserveDrawingBuffer`), componiendo
  encima leyenda, escala y recorte al AOI, y nada de eso estaba implementado.
  Se sacó entera: un control visible que no funciona es peor que uno ausente.
  Si vuelve, vuelve con `onCaptureMap` cableado desde `routes/_app/index.tsx`
  y el canvas de verdad detrás.

  "Exportar" no dispara una descarga: crea un JOB y navega a
  `/descargas/$jobId`, donde vive el progreso y el botón de descarga real —
  un ZIP de varias capas tarda minutos y ese tiempo tiene que ser navegable,
  recargable y compartible (§7.1).
*/

type TabId = 'datos' | 'impresion';

const TABS = [
  { id: 'datos', label: 'Datos' },
  { id: 'impresion', label: 'Impresión' },
] as const satisfies readonly { id: TabId; label: string }[];

export type DownloadModalProps = {
  open: boolean;
  onClose: () => void;
  /**
   * El análisis del que salen los artefactos. Sin él no hay nada que exportar
   * y el modal lo dice: la lista NO se inventa desde el registro de capas.
   */
  analysisId?: string;
  aoiName?: string;
  /*
    Props del shell anterior. `availableLayerIds` y `onSubmit` se aceptan y
    NO se usan: la lista de artefactos sale del análisis (§7.2, nunca una
    lista estática), así que ids de capas visibles no pueden alimentarla.

    `aoiSlug` sí sirve: la ruta del mapa pasa `search.aoi`, que en esta app ES
    el id del análisis (`routes/_app/index.tsx` hace
    `useMapAnalysis(search.aoi)`, resuelto con `analysisQueryOptions`). Se usa
    como respaldo de `analysisId` para que Exportar funcione desde el mapa sin
    tocar otra ruta. Si el id no fuera un análisis, el plan vuelve
    `no-encontrado`: el peor caso es un mensaje, no un ZIP equivocado.
  */
  availableLayerIds?: readonly string[];
  aoiSlug?: string;
  onSubmit?: (selection: { layerIds: string[]; crs: string; resolution: string }) => void;
};

function useSelectionState(plan: ExportPlan | null) {
  const [manual, setManual] = useState<Set<string> | null>(null);

  const selected = useMemo(() => {
    if (manual !== null) return manual;
    return new Set(plan === null ? [] : defaultSelection(plan));
  }, [manual, plan]);

  const toggle = (artifactId: string, next: boolean) => {
    const draft = new Set(selected);
    if (next) draft.add(artifactId);
    else draft.delete(artifactId);
    setManual(draft);
  };

  const toggleMany = (artifactIds: string[], next: boolean) => {
    const draft = new Set(selected);
    for (const id of artifactIds) {
      if (next) draft.add(id);
      else draft.delete(id);
    }
    setManual(draft);
  };

  return { selected, toggle, toggleMany };
}

export function DownloadModal({
  open,
  onClose,
  analysisId,
  aoiName,
  aoiSlug,
}: DownloadModalProps) {
  const navigate = useNavigate();
  const toast = useToast();

  const [tab, setTab] = useState<TabId>('datos');
  const [crs, setCrs] = useState<ExportCrsOption>('wgs84');
  const [clipToAoi, setClipToAoi] = useState(true);
  const [sections, setSections] = useState<ReportSectionId[]>([...REPORT_SECTION_IDS]);
  const [oversize, setOversize] = useState<{ message: string; blocking: boolean } | null>(null);

  const analysis =
    analysisId ?? (aoiSlug === undefined || aoiSlug === 'sin-aoi' ? undefined : aoiSlug);
  /*
    `aoiSlug` NO se usa como nombre: cuando llega desde el mapa es un id, y un
    ZIP llamado `territorio-base_an-3f2a…zip` no le dice nada a nadie. Sin
    nombre, el servidor arma uno legible a partir del análisis.
  */
  const name = aoiName;
  const planQuery = useExportPlan(analysis, name);
  const plan = planFromResult(planQuery.data);
  const { selected, toggle, toggleMany } = useSelectionState(plan);

  const startExport = useStartExport();
  const reportMarkdown = useReportMarkdown();

  const estimated = plan === null ? 0 : totalEstimatedBytes(plan, selected);
  const datasetIds = useMemo(() => {
    const ids = new Set<string>();
    if (plan === null) return ids;
    for (const artifact of plan.artifacts) {
      if (artifact.datasetId !== null && (selected.has(artifact.id) || artifact.mandatory)) {
        ids.add(artifact.datasetId);
      }
    }
    return ids;
  }, [plan, selected]);

  const dataCount =
    plan === null
      ? 0
      : plan.artifacts.filter(
          (artifact) =>
            artifact.kind !== 'documento' && artifact.selectable && selected.has(artifact.id),
        ).length;

  const submit = (confirmLarge: boolean) => {
    if (analysis === undefined || plan === null) return;
    setOversize(null);

    startExport.mutate(
      {
        analysisId: analysis,
        aoiName: name,
        selection: { artifactIds: [...selected], crs, clipToAoi, reportSections: sections },
        confirmLarge,
      },
      {
        onSuccess: (result) => {
          if (result.ok) {
            onClose();
            void navigate({ to: '/descargas/$jobId', params: { jobId: result.jobId } });
            return;
          }
          if (result.reason === 'demasiado-grande') {
            setOversize({ message: result.message, blocking: result.verdict === 'block' });
            return;
          }
          toast.push({ tone: 'error', title: 'No se pudo exportar', description: result.message });
        },
        onError: (error) => {
          toast.push({
            tone: 'error',
            title: 'No se pudo exportar',
            description: error.message,
          });
        },
      },
    );
  };

  const downloadReport = () => {
    if (analysis === undefined) return;
    reportMarkdown.mutate(
      { analysisId: analysis, aoiName: name, sections },
      {
        onSuccess: (result) => {
          if (!result.ok) {
            toast.push({
              tone: 'error',
              title: 'No se pudo generar el reporte',
              description: result.message,
            });
            return;
          }
          const url = URL.createObjectURL(
            new Blob([result.markdown], { type: 'text/markdown;charset=utf-8' }),
          );
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = result.filename;
          anchor.click();
          URL.revokeObjectURL(url);
        },
      },
    );
  };

  const footer =
    tab === 'datos' ? (
      <>
        <span className="text-11 text-fg-muted min-w-0 flex-1">
          {plan === null
            ? 'Sin análisis, no hay nada que exportar.'
            : `${String(dataCount)} capa(s) · ~${formatBytes(estimated)} estimados`}
        </span>
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          variant="primary"
          leadingIcon={<DownloadIcon size={14} />}
          disabled={plan === null || dataCount === 0}
          loading={startExport.isPending}
          onClick={() => {
            submit(false);
          }}
        >
          Exportar
        </Button>
      </>
    ) : (
      <Button variant="secondary" onClick={onClose} className="ml-auto">
        Cerrar
      </Button>
    );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Exportar"
      description={
        plan === null
          ? undefined
          : `${plan.aoiName} · ${formatHectares(plan.areaHa, 0)} · EPSG:${String(plan.utmEpsg)}`
      }
      width={520}
      footer={footer}
    >
      <Tabs items={TABS} value={tab} onChange={setTab} ariaLabel="Formato de exportación" />

      <div className="pt-3">
        {analysis === undefined ? (
          <NoAnalysisState />
        ) : planQuery.isPending ? (
          <p className="text-12 text-fg-muted">Leyendo lo que produjo el análisis…</p>
        ) : plan === null ? (
          <PlanRefusal
            message={planQuery.data?.ok === false ? planQuery.data.message : undefined}
          />
        ) : (
          <>
            {tab === 'datos' ? (
              <TabPanel className="flex flex-col gap-3">
                <ArtifactPicker
                  plan={plan}
                  selected={selected}
                  onToggle={toggle}
                  onToggleGroup={toggleMany}
                />

                <section className="rounded-panel border-border-base bg-surface flex flex-col gap-2 border p-3">
                  <label className="flex items-center gap-2">
                    <span className="text-12 text-fg w-28 shrink-0">CRS de salida</span>
                    <Select
                      value={crs}
                      onChange={(event) => {
                        setCrs(event.currentTarget.value === 'utm' ? 'utm' : 'wgs84');
                      }}
                      className="flex-1"
                    >
                      <option value="wgs84">EPSG:4326 — WGS84 (grados)</option>
                      <option value="utm">EPSG:{plan.utmEpsg} — UTM local del AOI (metros)</option>
                    </Select>
                  </label>
                  <p className="text-11 text-fg-muted">
                    Aplica a los shapefiles. Los <code className="tabular">.geojson</code> van
                    siempre en EPSG:4326 —el RFC 7946 no admite otro— y los GeoTIFF salen en la UTM
                    local (EPSG:{plan.utmEpsg}), que es como los escribe el motor. Está todo anotado
                    archivo por archivo en el <code className="tabular">LEEME.txt</code>.
                  </p>

                  <Checkbox
                    label="Recortar los vectores al AOI"
                    description="Los polígonos se intersecan con el AOI. Las líneas y los puntos nunca se parten: se incluyen enteros si lo tocan."
                    checked={clipToAoi}
                    onChange={(event) => {
                      setClipToAoi(event.currentTarget.checked);
                    }}
                  />

                  <p className="text-11 text-fg-muted">
                    <span className="text-fg font-medium">Resolución:</span> la nativa de esta
                    corrida — NDVI a {plan.ndviResolutionM} m, DEM 30 m, WorldCover 10 m. El
                    servicio entrega los GeoTIFF ya recortados a esa grilla; remuestrearlos acá
                    degradaría el dato sin ahorrar tiempo, así que no se ofrece.
                  </p>
                </section>

                {oversize !== null ? (
                  <div className="rounded-panel border-warning bg-warning-soft text-warning border p-3">
                    <div className="flex items-center gap-2">
                      <AlertIcon size={15} />
                      <p className="text-12 font-semibold">
                        {oversize.blocking ? 'Selección demasiado grande' : 'Esto va a tardar'}
                      </p>
                    </div>
                    <p className="text-11 mt-1">{oversize.message}</p>
                    {!oversize.blocking ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="mt-2"
                        loading={startExport.isPending}
                        onClick={() => {
                          submit(true);
                        }}
                      >
                        Exportar igual
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </TabPanel>
            ) : null}

            {tab === 'impresion' ? (
              <TabPanel className="flex flex-col gap-3">
                <section className="rounded-panel border-border-base bg-surface border p-3">
                  <h3 className="text-12 text-fg font-semibold">Secciones del reporte</h3>
                  <p className="text-11 text-fg-muted mt-0.5">
                    Se aplican al <code className="tabular">reporte.md</code> del ZIP y al Markdown
                    suelto de acá abajo.
                  </p>
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {REPORT_SECTION_IDS.map((section) => (
                      <li key={section}>
                        <Checkbox
                          label={REPORT_SECTION_LABELS[section]}
                          checked={sections.includes(section)}
                          onChange={(event) => {
                            /*
                              El valor se lee ACÁ, no adentro del updater: el
                              updater de `setSections` corre en la fase de
                              render, ya terminado el despacho del evento, y
                              para entonces `event.currentTarget` es `null`.
                              Leerlo ahí tiraba la pantalla entera con
                              «Cannot read properties of null (reading 'checked')».
                            */
                            const next = event.currentTarget.checked;
                            setSections((current) =>
                              next ? [...current, section] : current.filter((id) => id !== section),
                            );
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="rounded-panel border-border-base bg-surface flex flex-col gap-2 border p-3">
                  <h3 className="text-12 text-fg font-semibold">PDF</h3>
                  <p className="text-11 text-fg-muted">
                    El PDF sale de la vista de impresión: mapas estáticos, saltos de página cuidados
                    y las fuentes en su propia hoja. Tamaño, orientación y márgenes se eligen en el
                    diálogo «Guardar como PDF» del navegador, que es quien lo genera — acá no hay un
                    segundo juego de controles que prometa algo distinto.
                  </p>
                  <Link
                    to="/reporte/$analysisId/imprimir"
                    params={{ analysisId: analysis }}
                    target="_blank"
                    rel="noreferrer"
                    className="text-12 text-accent inline-flex items-center gap-1 font-medium underline underline-offset-2"
                  >
                    <ExternalIcon size={13} />
                    Abrir vista de impresión
                  </Link>
                </section>

                <Button
                  variant="secondary"
                  leadingIcon={<DownloadIcon size={14} />}
                  loading={reportMarkdown.isPending}
                  onClick={downloadReport}
                >
                  Descargar reporte (Markdown)
                </Button>
              </TabPanel>
            ) : null}

            <div className="mt-3">
              <AttributionNotice datasetIds={datasetIds} />
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

function NoAnalysisState() {
  return (
    <div className="rounded-panel border-border-strong border border-dashed p-4">
      <p className="text-13 text-fg font-semibold">Todavía no hay nada que exportar</p>
      <p className="text-12 text-fg-muted mt-1">
        La lista de descargas se arma con lo que el análisis produjo de verdad, no con el catálogo
        de capas. Dibujá o subí un AOI y esperá a que termine el análisis.
      </p>
    </div>
  );
}

function PlanRefusal({ message }: { message?: string }) {
  return (
    <div className="rounded-panel border-danger bg-danger-soft text-danger border p-4">
      <div className="flex items-center gap-2">
        <AlertIcon size={15} />
        <p className="text-13 font-semibold">No se pudo leer el análisis</p>
      </div>
      <p className="text-12 mt-1">{message ?? 'No existe ese análisis, o no es tuyo.'}</p>
      <Badge tone="danger" className="mt-2">
        sin plan de exportación
      </Badge>
    </div>
  );
}
