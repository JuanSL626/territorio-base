/**
 * El cliente del servicio raster, configurado desde el entorno.
 *
 * **SOLO SERVIDOR.** Lee `process.env` y puede llevar `API_TOKEN`. Importalo
 * desde `createServerFn`, desde un `beforeLoad` o desde un handler de ruta —
 * nunca desde un componente, o el token termina en el bundle del browser.
 *
 * El browser no habla con el servicio raster directo. Habla con las server
 * functions de `analysis-server.ts` para todo lo estructurado, y con el proxy
 * de `apps/web/src/routes/api/raster.*` (server-side, usa este módulo) para
 * los PNG de overlay y los GeoTIFF — ver ese directorio para el porqué: con
 * `API_TOKEN` configurado una URL directa al servicio daría 401, y sin token
 * el puerto del servicio (si estuviera publicado) serviría el overlay de
 * CUALQUIER análisis a quien adivinara el id, sin importar de quién es. El
 * proxy exige sesión y compara dueño antes de pedirle nada a este cliente.
 */
import { createRasterApiClient, type RasterApiClient } from '@territorio/api-client';

/**
 * `API_URL` es la variable que ya declara `.env.example` y valida
 * `@territorio/db`. El default acá es `http://localhost:8787`, el puerto de
 * `services/api`'s `pnpm dev` — igual que `packages/db/src/env.ts`,
 * `.env.example`, `compose.yaml` y el Dockerfile del servicio (no 8000).
 */
const DEFAULT_API_URL = 'http://localhost:8787';

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

export function rasterBaseUrl(): string {
  return (readEnv('API_URL') ?? DEFAULT_API_URL).replace(/\/+$/, '');
}

function rasterToken(): string | undefined {
  return readEnv('API_TOKEN') ?? readEnv('TERRITORIO_API_TOKEN');
}

/**
 * Cabecera `Authorization` para pedirle algo al servicio raster a mano (no vía
 * `getRasterApi()`), como hace el proxy de overlays cuando necesita el
 * `Response` crudo para transmitirlo en vez de un `ApiResult` ya parseado.
 * Objeto vacío cuando no hay token — repartible directo en `fetch(..., {
 * headers: { ...rasterAuthHeaders() } })` sin un `if` en el llamador.
 */
export function rasterAuthHeaders(): Record<string, string> {
  const token = rasterToken();
  return token === undefined ? {} : { authorization: `Bearer ${token}` };
}

let cached: RasterApiClient | undefined;

/**
 * El cliente, memoizado por proceso. No hay estado por request adentro
 * (`baseUrl` y token vienen del entorno), así que compartirlo es seguro.
 */
export function getRasterApi(): RasterApiClient {
  cached ??= createRasterApiClient({
    baseUrl: rasterBaseUrl(),
    token: rasterToken(),
  });
  return cached;
}

/** Semilla de test: fuerza a releer el entorno en la próxima llamada. */
export function resetRasterApiCache(): void {
  cached = undefined;
}
