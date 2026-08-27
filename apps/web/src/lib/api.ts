/**
 * El cliente del servicio raster, configurado desde el entorno.
 *
 * **SOLO SERVIDOR.** Lee `process.env` y puede llevar `API_TOKEN`. Importalo
 * desde `createServerFn`, desde un `beforeLoad` o desde un handler de ruta —
 * nunca desde un componente, o el token termina en el bundle del browser.
 *
 * El browser no habla con el servicio raster: habla con las server functions de
 * `analysis-server.ts`. La única excepción son las URLs de overlay PNG y
 * GeoTIFF, que sí se sirven al cliente como URLs absolutas — y por eso el
 * servicio expone `X-Bounds` en CORS. Si `API_TOKEN` está configurado, esas
 * URLs tampoco funcionan desde el browser y hay que proxearlas; está anotado
 * en `publicRasterBaseUrl()`.
 */
import { createRasterApiClient, type RasterApiClient } from '@territorio/api-client';

/**
 * `API_URL` es la variable que ya declara `.env.example` y valida
 * `@territorio/db`. El default de acá es `http://localhost:8787` porque es el
 * puerto que usa `services/api`'s `pnpm dev` y el que documenta su README.
 *
 * NOTA para quien despliegue: `packages/db/src/env.ts` declara el default de
 * `API_URL` como `http://localhost:8000`. Los dos defaults sólo se usan cuando
 * la variable NO está seteada, así que en cualquier entorno real coinciden;
 * dejar la divergencia anotada es más honesto que "arreglarla" desde acá, que
 * es código de otro workstream.
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
 * Base que se le puede dar al browser para pedir PNG y GeoTIFF directo.
 *
 * `null` cuando hay token: en ese caso el servicio exige `Authorization` y una
 * URL desnuda daría 401. El consumidor tiene que proxear por una ruta del
 * servidor en vez de mostrar una imagen rota.
 */
export function publicRasterBaseUrl(): string | null {
  return rasterToken() === undefined ? rasterBaseUrl() : null;
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
