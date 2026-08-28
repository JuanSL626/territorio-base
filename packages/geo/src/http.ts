/**
 * Cliente HTTP mínimo para las tres fuentes vectoriales.
 *
 * Existe por una sola razón: `fetch` tiene **un** timeout (o ninguno) y el
 * legacy usaba `requests(timeout=(5, 30))` — 5 s para conectar, 30 s para
 * leer. Esa asimetría es deliberada (regresión #2 del inventario): contra un
 * mirror caído o bloqueado hay que fallar rápido para pasar al siguiente, pero
 * una consulta Overpass que ya está respondiendo puede tardar decenas de
 * segundos legítimamente. Un timeout único de 30 s haría esperar 150 s antes
 * de rendirse con los 5 mirrors; uno de 5 s abortaría consultas válidas.
 *
 * `AbortController` se rearma cuando llegan los headers: el primer temporizador
 * es el de conexión, el segundo el de lectura del cuerpo.
 */

/** `fetch` inyectable — los tests no tocan la red. */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<Response>;

export type Timeouts = {
  /** Máximo hasta recibir los headers de respuesta. */
  connectMs: number;
  /** Máximo, a partir de los headers, para terminar de leer el cuerpo. */
  readMs: number;
};

export const DEFAULT_TIMEOUTS: Timeouts = { connectMs: 5_000, readMs: 30_000 };

export const USER_AGENT = 'territorio-base/0.1 (analisis territorial preliminar)';

export class HttpError extends Error {
  override readonly name = 'HttpError';
  readonly status: number;
  readonly url: string;

  constructor(url: string, status: number, statusText: string) {
    super(`HTTP ${status} ${statusText} — ${url}`);
    this.status = status;
    this.url = url;
  }
}

export class TimeoutError extends Error {
  override readonly name = 'TimeoutError';
  readonly phase: 'connect' | 'read';

  constructor(url: string, phase: 'connect' | 'read', ms: number) {
    super(`Timeout de ${phase} (${ms} ms) — ${url}`);
    this.phase = phase;
  }
}

export type RequestOptions = {
  timeouts?: Timeouts;
  headers?: Record<string, string>;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
};

/**
 * POST `application/x-www-form-urlencoded` con timeouts separados de conexión
 * y lectura. Devuelve el cuerpo como texto; lanza `HttpError` si el status no
 * es 2xx.
 */
export async function postForm(
  url: string,
  params: Record<string, string>,
  options: RequestOptions = {},
): Promise<string> {
  const timeouts = options.timeouts ?? DEFAULT_TIMEOUTS;
  const doFetch: FetchLike = options.fetchImpl ?? (async (input, init) => await fetch(input, init));

  const controller = new AbortController();
  const abortOuter = (): void => {
    controller.abort(new Error('Cancelado por el llamador.'));
  };
  options.signal?.addEventListener('abort', abortOuter, { once: true });

  let phase: 'connect' | 'read' = 'connect';
  let timer: ReturnType<typeof setTimeout> = setTimeout(() => {
    controller.abort(new TimeoutError(url, 'connect', timeouts.connectMs));
  }, timeouts.connectMs);

  try {
    const response = await doFetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'user-agent': USER_AGENT,
        ...options.headers,
      },
      body: new URLSearchParams(params).toString(),
      signal: controller.signal,
    });

    clearTimeout(timer);
    phase = 'read';
    timer = setTimeout(() => {
      controller.abort(new TimeoutError(url, 'read', timeouts.readMs));
    }, timeouts.readMs);

    if (!response.ok) throw new HttpError(url, response.status, response.statusText);
    return await response.text();
  } catch (error) {
    if (error instanceof HttpError || error instanceof TimeoutError) throw error;
    if (controller.signal.aborted) {
      const reason: unknown = controller.signal.reason;
      if (reason instanceof TimeoutError) throw reason;
      throw new TimeoutError(
        url,
        phase,
        phase === 'connect' ? timeouts.connectMs : timeouts.readMs,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abortOuter);
  }
}

/** Igual que `postForm`, pero parsea la respuesta como JSON. */
export async function postFormJson(
  url: string,
  params: Record<string, string>,
  options: RequestOptions = {},
): Promise<unknown> {
  const text = await postForm(url, params, options);
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new Error(`Respuesta no-JSON de ${url}: ${text.slice(0, 200)}`, { cause });
  }
}
