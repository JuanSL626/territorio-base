/**
 * El lado vectorial del análisis: Overpass, WDPA y MEPyD, en proceso, con
 * aislamiento de fallos por fuente.
 *
 * **SOLO SERVIDOR.** Hace red hacia servicios de terceros y lo llama
 * `analysis-server.ts` desde una server function.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REGRESIÓN #3 — por qué cada fuente tiene su propio `try`
 * ─────────────────────────────────────────────────────────────────────────────
 * Las tres corren en paralelo y **ninguna puede tumbar a las otras**. No se usa
 * `Promise.all` (que rechaza en cuanto una falla y deja las demás huérfanas)
 * sino un envoltorio por fuente que convierte la excepción en
 * `{ available: false, error }`. Esa unión es la que después distingue
 * "el servicio no respondió" de "consulté y no hay nada" en el resultado
 * fusionado.
 *
 * Los reintentos y los timeouts NO se implementan acá: `@territorio/geo` ya los
 * tiene donde corresponde (5 mirrors en cascada para Overpass, `connect 5 s /
 * read 30 s` en `http.ts`, paginación por `resultOffset` en MEPyD). Duplicarlos
 * en esta capa multiplicaría las esperas contra un servicio caído.
 */
import {
  fetchAllMepyd,
  fetchHydrology,
  fetchProtectedAreas,
  type Aoi,
  type HydrologyFeature,
  type MepydResult,
  type ProtectedAreaFeature,
  type SourceOutcome,
} from '@territorio/geo';

import type { VectorOutcomes } from './analysis-merge';

export type RunVectorSourcesOptions = {
  signal?: AbortSignal | undefined;
  /** Semillas de test: reemplazan la fuente entera. */
  overrides?: Partial<{
    hydrology: () => Promise<readonly HydrologyFeature[]>;
    protectedAreas: () => Promise<readonly ProtectedAreaFeature[]>;
    mepyd: () => Promise<MepydResult>;
  }>;
};

/** Ejecuta una fuente y convierte cualquier excepción en `available: false`. */
async function isolate<T>(run: () => Promise<T>): Promise<SourceOutcome<T>> {
  try {
    return { available: true, data: await run() };
  } catch (error) {
    return { available: false, error };
  }
}

/**
 * Las tres fuentes vectoriales, en paralelo y aisladas.
 *
 * `fetchAllMepyd` ya aísla **capa por capa** adentro (una capa caída se omite y
 * queda en `failures`), así que el `isolate` de acá sólo cubre que reviente la
 * llamada entera — por ejemplo si el buffer del AOI no se puede calcular.
 */
export async function runVectorSources(
  aoi: Aoi,
  options: RunVectorSourcesOptions = {},
): Promise<VectorOutcomes> {
  const signal = options.signal;
  const overrides = options.overrides ?? {};

  const [hydrology, protectedAreas, mepyd] = await Promise.all([
    isolate(async () =>
      overrides.hydrology === undefined
        ? await fetchHydrology(aoi, { signal })
        : await overrides.hydrology(),
    ),
    isolate(async () =>
      overrides.protectedAreas === undefined
        ? await fetchProtectedAreas(aoi, { signal })
        : await overrides.protectedAreas(),
    ),
    isolate(async () =>
      overrides.mepyd === undefined
        ? await fetchAllMepyd(aoi, { signal })
        : await overrides.mepyd(),
    ),
  ]);

  return { hydrology, protectedAreas, mepyd };
}
