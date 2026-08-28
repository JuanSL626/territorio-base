/*
  De dónde saca el BROWSER los PNG de overlay. El servicio raster devuelve
  rutas relativas (`/analysis/{id}/overlay/dem.png`) servidas con CORS,
  exponiendo `X-Bounds` a propósito; falta la base absoluta del lado cliente.

  `lib/api.ts` es server-only (lee `process.env`, puede llevar `API_TOKEN`),
  así que la base pública se publica como variable de Vite. Si el servicio
  exige `API_TOKEN`, una URL desnuda daría 401 y hay que proxear por una ruta
  del servidor — en ese caso NO hay base pública, esto devuelve `undefined` y
  las capas raster reportan su estado en la fila del panel en vez de dejar
  una imagen rota (§8, "Layer load error").
*/

/** Puerto del `pnpm dev` de `services/api` y de su README. */
const DEV_FALLBACK = 'http://localhost:8787';

export function publicRasterBaseUrl(): string | undefined {
  const configured = import.meta.env.VITE_API_URL as string | undefined;
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return configured.trim().replace(/\/+$/, '');
  }
  return import.meta.env.DEV ? DEV_FALLBACK : undefined;
}
