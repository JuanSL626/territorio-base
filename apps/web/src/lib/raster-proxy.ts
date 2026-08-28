/**
 * El proxy de overlays: server-side, dueño-verificado, transmitido.
 *
 * **Por qué existe.** El browser necesita pedir PNG y GeoTIFF del servicio
 * raster (`services/api`) — no hay forma de que MapLibre pinte una imagen sin
 * una URL que el navegador pueda navegar. Antes de esto esa URL era el
 * servicio raster DIRECTO (`VITE_API_URL`, horneada en el bundle): andaba
 * mientras `TERRITORIO_API_TOKEN` estuviera vacío, y con `compose.yaml`
 * publicando el puerto 8787 al host eso significaba CERO autenticación en los
 * endpoints de overlay — cualquiera que llegara al puerto podía leer el
 * overlay de cualquier análisis con sólo adivinar (o enumerar) un id. Acá
 * "análisis" es un recurso de usuario en todo el resto de la app
 * (`getAnalysisForUser` en cada server function); esto cierra el mismo hueco
 * para las dos rutas que quedaban sin pasar por ahí.
 *
 * **La traducción de ids.** La URL que arma el navegador para un overlay por
 * capa usa el id que el SERVICIO RASTER conoce (`raster_job_id`, un UUID
 * separado del id de esta tabla — ver `getAnalysisByRasterJobIdForUser`); la
 * costera usa la clave de caché de `services/api` (`getAnalysisByCoastalCacheKeyForUser`).
 * Ninguna de las dos rutas de este módulo confía en el id que llega en la URL
 * para decidir A QUÉ acceder — sólo lo usa para encontrar la fila del dueño;
 * la URL upstream la arma este módulo con lo que esa fila ya tenía guardado.
 * Eso es lo que evita que alguien, siendo dueño de SU análisis, pise la ruta
 * con el raster_job_id de otro y se cuele igual: el 404 de "no es tuyo" pasa
 * primero, y lo que se reenvía después no viene de la URL entrante.
 *
 * **Streaming.** `fetch()` devuelve un `Response` cuyo `.body` es un
 * `ReadableStream` de la Fetch API; pasarlo tal cual al `Response` que
 * devuelve el handler transmite bytes con contrapresión real, sin bufferear
 * el PNG ni el GeoTIFF enteros en memoria del proceso Node.
 */
import { rasterAuthHeaders, rasterBaseUrl } from './api';

export type ProxyOutcome =
  | { kind: 'ok'; response: Response }
  | { kind: 'error'; status: number; message: string };

/** `dem`, `slope_classes`, etc. — nunca vacío, nunca con `/` ni `..`. */
const LAYER_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;
/** `services/api/jobs.py`: `uuid.uuid4().hex[:16]`. Generoso a propósito. */
const RASTER_JOB_ID_RE = /^[0-9a-f]{8,64}$/i;
/** `services/api/service.py`: `sha256(...).hexdigest()[:32]`. */
const COASTAL_CACHE_KEY_RE = /^[0-9a-f]{32}$/i;

export function isValidLayerName(value: string): boolean {
  return LAYER_NAME_RE.test(value);
}

export function isValidRasterJobId(value: string): boolean {
  return RASTER_JOB_ID_RE.test(value);
}

export function isValidCoastalCacheKey(value: string): boolean {
  return COASTAL_CACHE_KEY_RE.test(value);
}

/** `opacity`/`vmin`/`vmax`: los únicos query params que el servicio entiende acá. */
export function forwardableOverlayQuery(searchParams: URLSearchParams): URLSearchParams {
  const forwarded = new URLSearchParams();
  for (const key of ['opacity', 'vmin', 'vmax']) {
    const value = searchParams.get(key);
    if (value !== null) forwarded.set(key, value);
  }
  return forwarded;
}

/** Cabeceras que el mapa necesita para ubicar y cachear el overlay — nada más. */
const FORWARD_RESPONSE_HEADERS = [
  'content-type',
  'x-bounds',
  'x-overlay-coordinates',
  'content-disposition',
];

/**
 * Pide `upstreamPath` (relativo, ej. `/analysis/xyz/overlay/dem.png`) al
 * servicio raster y arma la `Response` que el handler de la ruta devuelve tal
 * cual — o el `ProxyOutcome` de error con un status que el cliente puede
 * distinguir (§ handlers de ruta, más abajo).
 */
export async function proxyRasterGet(
  upstreamPath: string,
  query: URLSearchParams,
): Promise<ProxyOutcome> {
  const qs = query.toString();
  const url = `${rasterBaseUrl()}${upstreamPath}${qs === '' ? '' : `?${qs}`}`;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: 'GET',
      headers: { accept: 'image/png, application/json;q=0.9, image/tiff;q=0.9', ...rasterAuthHeaders() },
    });
  } catch {
    return { kind: 'error', status: 502, message: 'No se pudo contactar el servicio raster.' };
  }

  if (upstream.status === 404) {
    return {
      kind: 'error',
      status: 404,
      message: 'Esta corrida no produjo ese archivo (o el job expiró en el servicio raster).',
    };
  }
  if (upstream.status === 409) {
    return { kind: 'error', status: 409, message: 'El análisis todavía no terminó de generar esta capa.' };
  }
  if (upstream.status === 401 || upstream.status === 403) {
    // TERRITORIO_API_TOKEN mal configurado entre `web` y `api` — un bug de
    // despliegue, no algo que la sesión del usuario pueda arreglar. Nunca 401
    // acá: eso el cliente lo leería como "tu sesión venció".
    return {
      kind: 'error',
      status: 502,
      message: 'El servicio raster rechazó las credenciales internas (configuración del servidor).',
    };
  }
  if (!upstream.ok) {
    return { kind: 'error', status: 502, message: `El servicio raster respondió ${upstream.status}.` };
  }

  const headers = new Headers();
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  /*
    Inmutable y de larga vida: el job ya terminó de escribir este archivo y no
    vuelve a cambiar (§ mismo id, mismos query params → mismos bytes, siempre).
    `private`: pasó por un chequeo de dueño, así que ni un proxy ni una caché
    compartida lo debe guardar para servírselo a otro.
  */
  headers.set('cache-control', 'private, max-age=31536000, immutable');

  return { kind: 'ok', response: new Response(upstream.body, { status: 200, headers }) };
}

export function proxyErrorResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store, private' },
  });
}
