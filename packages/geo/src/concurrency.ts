/**
 * Pool de concurrencia acotada.
 *
 * El legacy usa `ThreadPoolExecutor(max_workers=10)` para las ~35 capas MEPyD.
 * `Promise.all` sobre 35 fetch simultáneos contra la misma cuenta de ArcGIS
 * Online es una forma rápida de que el servicio devuelva 429 y la mitad de las
 * capas "falle" por nuestra culpa, no por la suya.
 */

export const DEFAULT_CONCURRENCY = 10;

/** Resultado por ítem: nunca rechaza, para poder aislar fallas por fuente. */
export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Ejecuta `worker` sobre `items` con como máximo `limit` en vuelo, preservando
 * el orden de entrada en la salida y capturando los errores en vez de
 * propagarlos (regresión #3: la caída de un servicio externo no puede tumbar
 * el análisis entero).
 */
export async function mapSettled<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  limit: number = DEFAULT_CONCURRENCY,
): Promise<Settled<R>[]> {
  if (limit < 1) throw new Error(`mapSettled: limit debe ser >= 1, llegó ${limit}.`);
  const results: Settled<R>[] = new Array<Settled<R>>(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) continue;
      try {
        results[index] = { ok: true, value: await worker(item, index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}
