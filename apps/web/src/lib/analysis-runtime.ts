/**
 * El orquestador: un análisis en curso, vivo, en el proceso del servidor.
 * SOLO SERVIDOR.
 *
 * Un análisis tiene dos mitades que tardan lo mismo y no dependen una de otra:
 * el raster (job asíncrono en el servicio Python) y el vector (Overpass + WDPA
 * + MEPyD, en este proceso). Arrancan **juntas** y se esperan al final. Nada de
 * "primero el raster y después el vector": duplicaría el tiempo de espera sin
 * ninguna razón.
 *
 * El progreso del raster se consume por SSE (`@territorio/api-client`), no por
 * polling: los mensajes en español del pipeline son los del legacy y llegan en
 * el momento en que ocurren. Ese stream lo lee el SERVIDOR, no el browser —
 * así el token del servicio nunca sale de acá y el cliente sigue el progreso
 * con una server function barata (`getRunSnapshot`).
 *
 * Las corridas viven en un `Map` de módulo. Es deliberado y tiene un límite
 * conocido: **es estado por proceso**. Con varias instancias detrás de un
 * balanceador, el progreso vivo sólo lo ve la instancia que lanzó la corrida.
 * El RESULTADO no depende de eso: se persiste en SQLite apenas termina, y
 * `/reporte/$id` lo lee de la base. Lo único que se pierde en un despliegue
 * multi-instancia es la barra de progreso, que degrada a "corriendo" hasta que
 * la fila cambia de estado. Mover esto a una tabla o a Redis es un cambio
 * localizado a este archivo.
 */
import {
  isTerminalStreamEvent,
  type AnalysisJob,
  type AnalysisStatus,
  type ProgressEvent,
} from '@territorio/api-client';
import { createAnalysis, getDb, updateAnalysisForUser, type AoiGeometry } from '@territorio/db';

import { mergeAnalysis, type RasterOutcome, type VectorOutcomes } from './analysis-merge';
import { runVectorSources } from './analysis-vector';
import { getRasterApi } from './api';

import type {
  AnalysisParams,
  CoastalRun,
  SourceStatus,
  TerritorioAnalysis,
} from './analysis-contract';
import type { Aoi } from '@territorio/geo';

/** Estado de una fuente MIENTRAS corre. `pending` sólo existe acá (§0.5). */
export type LiveSourceState = 'pending' | SourceStatus['state'];

export type LiveRunSnapshot = {
  analysisId: string;
  status: AnalysisStatus;
  /** Pasos del pipeline raster, en orden y sin repetidos. */
  progress: ProgressEvent[];
  /** Milisegundos desde que arrancó. Alimenta el cronómetro del §8. */
  elapsedMs: number;
  /** `pending` hasta que la fuente termina. El panel pinta una tarjeta por una. */
  sources: Record<string, LiveSourceState>;
  error: string | null;
  /** `true` cuando el resultado ya está persistido y se puede leer de la base. */
  finished: boolean;
};

type LiveRun = {
  analysisId: string;
  userId: string;
  startedAt: number;
  status: AnalysisStatus;
  rasterJobId: string | null;
  progress: ProgressEvent[];
  sources: Record<string, LiveSourceState>;
  error: string | null;
  finished: boolean;
  abort: AbortController;
  completion: Promise<void>;
};

const runs = new Map<string, LiveRun>();

/**
 * Cuánto sobrevive una corrida terminada en memoria. Existe sólo para que la
 * UI alcance a ver el último `progress` antes de pasar a leer de la base.
 */
const RETAIN_FINISHED_MS = 5 * 60_000;

function forget(analysisId: string): void {
  // `unref` para no mantener vivo el proceso sólo por este temporizador.
  setTimeout(() => runs.delete(analysisId), RETAIN_FINISHED_MS).unref();
}

export function getRunSnapshot(analysisId: string, userId: string): LiveRunSnapshot | null {
  const run = runs.get(analysisId);
  if (run === undefined) return null;
  // Scopeado al dueño, igual que toda lectura de un análisis.
  if (run.userId !== userId) return null;

  return {
    analysisId: run.analysisId,
    status: run.status,
    progress: [...run.progress],
    elapsedMs: Date.now() - run.startedAt,
    sources: { ...run.sources },
    error: run.error,
    finished: run.finished,
  };
}

/** Cancela una corrida en curso. `false` si no existe o no es de este usuario. */
export function cancelRun(analysisId: string, userId: string): boolean {
  const run = runs.get(analysisId);
  if (run === undefined) return false;
  if (run.userId !== userId || run.finished) return false;
  run.abort.abort(new Error('Cancelado por el usuario.'));
  return true;
}

/** Semilla de test: espera a que la corrida termine y se persista. */
export async function awaitRun(analysisId: string): Promise<void> {
  await runs.get(analysisId)?.completion;
}

/**
 * Tope de tamaño del `result_json`. Postgres no tiene el techo de ~6 MB que
 * SQLite tenía en la práctica (`jsonb` aguanta hasta ~1 GB por valor), pero una
 * fila de decenas de MB sigue pagando compresión/descompresión TOAST en cada
 * lectura — este tope es una constante de la app, no algo que el motor haga
 * innecesario (ver `packages/db/README.md`). Las geometrías MEPyD son lo único
 * que puede llegar ahí (39 capas, miles de features cada una), así que son lo
 * primero que se descarta — el `summary`, que ES el contrato del §3, sobrevive
 * siempre, y `geometries_omitted` deja
 * dicho que el mapa tiene que volver a pedirlas en vez de dibujar de menos.
 */
const MAX_RESULT_BYTES = 6 * 1024 * 1024;

export function fitForStorage(analysis: TerritorioAnalysis): TerritorioAnalysis {
  if (JSON.stringify(analysis).length <= MAX_RESULT_BYTES) return analysis;
  return {
    ...analysis,
    mepyd_rd: { ...analysis.mepyd_rd, layers: [], geometries_omitted: true },
  };
}

/** Un solo renglón con los servicios que fallaron. Va a `error_message`. */
function errorSummary(analysis: TerritorioAnalysis): string {
  const failed = analysis.sources.filter((source) => source.state === 'error');
  if (failed.length === 0) return 'Falló el análisis.';
  return `No respondió ninguna fuente: ${failed.map((source) => source.service).join(', ')}.`;
}

/**
 * Lo único que la mitad raster necesita del estado vivo. Se pasa como callbacks
 * y no como el objeto de la corrida para que toda la mutación de ese objeto
 * viva en un solo lugar (`startRun`), y para poder probar esta función sin
 * tocar el `Map` del módulo.
 */
type RasterHooks = {
  signal: AbortSignal;
  onJobCreated: (jobId: string) => void;
  onProgress: (event: ProgressEvent) => void;
  onSourceState: (state: LiveSourceState) => void;
};

async function runRaster(
  aoi: Aoi,
  params: AnalysisParams,
  hooks: RasterHooks,
): Promise<RasterOutcome> {
  const api = getRasterApi();

  const created = await api.createAnalysis(
    {
      aoi: aoi.geometry,
      ndvi_resolution_m: params.ndvi_resolution_m,
      lookback_days: params.lookback_days,
      max_cloud_cover: params.max_cloud_cover,
    },
    hooks.signal,
  );

  if (!created.ok) {
    hooks.onSourceState('error');
    return { available: false, error: created.message };
  }

  const jobId = created.data.id;
  hooks.onJobCreated(jobId);

  /*
    Seguimiento por SSE. Si el stream se cae del todo (`stream-error`) NO se da
    por perdido el análisis: el job sigue corriendo del otro lado, así que se
    cae a una lectura final de `GET /analysis/{id}`. Perder el progreso no es
    perder el resultado.
  */
  let streamedTerminal = false;
  for await (const event of api.streamAnalysisEvents(jobId, { signal: hooks.signal })) {
    if (event.type === 'progress') {
      hooks.onProgress({
        step: event.step,
        total: event.total,
        message: event.message,
        at: event.at,
      });
    }
    if (event.type === 'done' || event.type === 'failed') streamedTerminal = true;
    if (isTerminalStreamEvent(event)) break;
  }

  if (hooks.signal.aborted) {
    hooks.onSourceState('error');
    return { available: false, error: 'El análisis se canceló antes de terminar.' };
  }

  const final = await api.getAnalysis(jobId);
  if (!final.ok) {
    hooks.onSourceState('error');
    return {
      available: false,
      error: streamedTerminal
        ? `El análisis raster terminó pero no se pudo leer el resultado: ${final.message}`
        : final.message,
    };
  }

  const job: AnalysisJob = final.data;
  hooks.onSourceState(job.result == null ? 'error' : 'ok');
  return { available: true, job };
}

export type StartRunInput = {
  userId: string;
  aoi: Aoi;
  params: AnalysisParams;
  name?: string | null;
};

/**
 * Crea la fila, lanza las dos mitades **en paralelo** y devuelve el id sin
 * esperar a que terminen. El trabajo de fondo persiste el resultado al final.
 */
export async function startRun(input: StartRunInput): Promise<{ analysisId: string }> {
  const db = getDb();
  const aoiGeojson: AoiGeometry = input.aoi.geometry;

  const row = await createAnalysis(db, {
    userId: input.userId,
    aoiGeojson,
    name: input.name ?? null,
    areaHa: input.aoi.areaHa,
    status: 'running',
  });

  const run: LiveRun = {
    analysisId: row.id,
    userId: input.userId,
    startedAt: Date.now(),
    status: 'running',
    rasterJobId: null,
    progress: [],
    sources: {
      raster: 'pending',
      hidrologia: 'pending',
      'areas-protegidas': 'pending',
      mepyd: 'pending',
    },
    error: null,
    finished: false,
    abort: new AbortController(),
    completion: Promise.resolve(),
  };

  const createdAt = row.createdAt.toISOString();

  const execute = async (): Promise<void> => {
    try {
      /*
        LAS DOS MITADES ARRANCAN JUNTAS, y ninguna de las dos promesas puede
        rechazar: `runRaster` devuelve `RasterOutcome` y `runVectorSources`
        aísla cada fuente en un `try` propio. El `catch` de abajo existe para
        lo imprevisto (un bug acá, quedarse sin memoria): un análisis nunca
        puede quedar colgado en `running`.
      */
      const [raster, vector] = await Promise.all([
        runRaster(input.aoi, input.params, {
          signal: run.abort.signal,
          onJobCreated: (jobId) => {
            run.rasterJobId = jobId;
          },
          onProgress: (event) => run.progress.push(event),
          onSourceState: (state) => {
            run.sources.raster = state;
          },
        }),
        runVectorSources(input.aoi, { signal: run.abort.signal }).then(
          (outcomes: VectorOutcomes) => {
            run.sources.hidrologia = outcomes.hydrology.available ? 'ok' : 'error';
            run.sources['areas-protegidas'] = outcomes.protectedAreas.available ? 'ok' : 'error';
            run.sources.mepyd = outcomes.mepyd.available ? 'ok' : 'error';
            return outcomes;
          },
        ),
      ]);

      const merged = mergeAnalysis({
        id: run.analysisId,
        createdAt,
        finishedAt: new Date().toISOString(),
        params: input.params,
        aoi: input.aoi,
        raster,
        vector,
      });

      for (const source of merged.sources) run.sources[source.id] = source.state;

      const stored = fitForStorage(merged);
      await updateAnalysisForUser(db, {
        id: run.analysisId,
        userId: run.userId,
        status: stored.status,
        resultJson: stored,
        errorMessage: stored.status === 'error' ? errorSummary(stored) : null,
        areaHa: stored.aoi.area_ha,
      });

      run.status = stored.status;
      run.error = stored.status === 'error' ? errorSummary(stored) : null;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falló el análisis.';
      run.status = 'error';
      run.error = message;
      await updateAnalysisForUser(db, {
        id: run.analysisId,
        userId: run.userId,
        status: 'error',
        errorMessage: message,
      });
    } finally {
      run.finished = true;
      forget(run.analysisId);
    }
  };

  run.completion = execute();
  runs.set(row.id, run);

  return { analysisId: row.id };
}

/**
 * El legacy guardaba la inundación costera sólo en `session_state`, así que
 * nunca llegaba al reporte aunque el usuario la hubiera visto en el mapa
 * (inventario §9, "rarezas adicionales"). Acá se adjunta al análisis y se
 * persiste, que es lo que la vuelve parte del artefacto.
 */
export async function attachCoastal(params: {
  analysisId: string;
  userId: string;
  analysis: TerritorioAnalysis;
  coastal: CoastalRun;
}): Promise<TerritorioAnalysis> {
  const updated: TerritorioAnalysis = { ...params.analysis, coastal: params.coastal };
  await updateAnalysisForUser(getDb(), {
    id: params.analysisId,
    userId: params.userId,
    resultJson: fitForStorage(updated),
  });
  return updated;
}
