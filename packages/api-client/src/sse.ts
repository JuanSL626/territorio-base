/**
 * Consumo tipado del progreso del análisis (`GET /analysis/{id}/events`).
 *
 * Por qué `fetch` a mano y no `EventSource`:
 *
 *   1. `EventSource` no deja poner headers, y el servicio puede exigir
 *      `Authorization: Bearer …` (`TERRITORIO_API_TOKEN`). Este stream lo
 *      consume el SSR, que es justo quien tiene el token.
 *   2. `EventSource` no existe en Node por defecto, y acá el consumidor
 *      principal es el orquestador del lado servidor.
 *   3. Su reconexión automática es opaca: no se puede deduplicar el replay.
 *
 * Sobre el replay: el servicio **reenvía todo el progreso ya ocurrido** cuando
 * un cliente se conecta (`main.py::stream_analysis_events`), para que quien
 * llega tarde no pierda pasos. Bueno para el primer connect, y una fuente de
 * duplicados en cada reconexión — así que este helper deduplica por `step`
 * monótono. Un consumidor nunca ve el paso 2 dos veces.
 *
 * Teardown: todo el bucle vive en un `try/finally` que cancela el reader y
 * aborta el `fetch`. Cerrar el `for await` (un `break`, un `return`, una
 * excepción río abajo) libera el socket; abortar el `AbortSignal` del llamador,
 * también.
 */
import { fail, type ApiFailure } from './result.ts';
import {
  ANALYSIS_STATUSES,
  progressEventSchema,
  type AnalysisStatus,
  type ProgressEvent,
} from './schemas.ts';

export type AnalysisProgress = ProgressEvent & { type: 'progress' };

export type AnalysisStreamEvent =
  /** Un paso del pipeline, con el string en español exacto del legacy. */
  | AnalysisProgress
  /** El job pasó a `running`. */
  | { type: 'status'; status: AnalysisStatus }
  /** Terminal: el job terminó (`ok` o `partial`). */
  | { type: 'done'; status: AnalysisStatus; error: string | null }
  /** Terminal: el job falló entero. `error` es el motivo en español. */
  | { type: 'failed'; status: AnalysisStatus; error: string | null }
  /**
   * Terminal: se perdió el **stream**, no el job. El análisis puede estar
   * corriendo perfectamente del otro lado; hay que caer a polling de
   * `GET /analysis/{id}`. No confundir con `failed`.
   */
  | { type: 'stream-error'; failure: ApiFailure };

export function isTerminalStreamEvent(event: AnalysisStreamEvent): boolean {
  return event.type === 'done' || event.type === 'failed' || event.type === 'stream-error';
}

export type SseFrame = { event: string; data: string };

/**
 * Parser incremental de `text/event-stream`.
 *
 * Sólo se usan `event:` y `data:` — el servicio no emite `id:` ni `retry:`.
 * Varias líneas `data:` en un frame se unen con `\n`, como manda la spec.
 */
export function createSseParser(): (chunk: string) => SseFrame[] {
  let buffer = '';

  return (chunk: string): SseFrame[] => {
    buffer += chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const frames: SseFrame[] = [];

    let separator = buffer.indexOf('\n\n');
    while (separator !== -1) {
      const block = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      separator = buffer.indexOf('\n\n');

      let event = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line === '' || line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        const rawValue = colon === -1 ? '' : line.slice(colon + 1);
        const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
      }

      if (data.length > 0) frames.push({ event, data: data.join('\n') });
    }

    return frames;
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function asAnalysisStatus(value: unknown): AnalysisStatus {
  const statuses: readonly string[] = ANALYSIS_STATUSES;
  return typeof value === 'string' && statuses.includes(value)
    ? (value as AnalysisStatus)
    : 'error';
}

function asErrorText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** `null` = frame ignorable (`ping`, o un `data` que no valida). */
export function decodeFrame(frame: SseFrame): AnalysisStreamEvent | null {
  const payload = parseJson(frame.data);
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;

  switch (frame.event) {
    case 'progress': {
      const parsed = progressEventSchema.safeParse(payload);
      return parsed.success ? { type: 'progress', ...parsed.data } : null;
    }
    case 'status':
      return { type: 'status', status: asAnalysisStatus(record.status) };
    case 'done':
      return {
        type: 'done',
        status: asAnalysisStatus(record.status),
        error: asErrorText(record.error),
      };
    case 'error':
      return {
        type: 'failed',
        status: asAnalysisStatus(record.status),
        error: asErrorText(record.error),
      };
    default:
      // `ping` (keepalive cada 15 s) y cualquier evento futuro desconocido.
      return null;
  }
}

export type SseFetch = (input: string, init: RequestInit) => Promise<Response>;

export type StreamAnalysisEventsOptions = {
  /** Base del servicio, sin barra final. */
  baseUrl: string;
  analysisId: string;
  /** `TERRITORIO_API_TOKEN`, si el servicio lo exige. */
  token?: string | undefined;
  /** Corta el stream y libera el socket. */
  signal?: AbortSignal | undefined;
  /** Reconexiones antes de rendirse. Default 5; `0` desactiva el reintento. */
  maxRetries?: number | undefined;
  /** Backoff en ms para el intento `attempt` (0-based). Default exponencial. */
  retryDelayMs?: ((attempt: number) => number) | undefined;
  /** Semillas de test. */
  fetchImpl?: SseFetch | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
};

const DEFAULT_MAX_RETRIES = 5;

function defaultBackoff(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 8_000);
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function abortFailure(): ApiFailure {
  return fail({ kind: 'cancelado', message: 'El seguimiento del análisis se canceló.' });
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

/**
 * Se lee en función, no inline: `signal.aborted` es `readonly boolean` y el
 * compilador lo estrecharía a `false` para todo el resto del bucle, que es
 * exactamente lo contrario de lo que hace un `AbortSignal`.
 */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/**
 * Una sola conexión. Devuelve los frames decodificados hasta que el stream se
 * corta; el reintento lo maneja `streamAnalysisEvents`.
 */
async function* connect(
  url: string,
  options: StreamAnalysisEventsOptions,
): AsyncGenerator<AnalysisStreamEvent> {
  const doFetch: SseFetch = options.fetchImpl ?? (async (input, init) => await fetch(input, init));

  const headers: Record<string, string> = { accept: 'text/event-stream' };
  if (options.token !== undefined && options.token !== '') {
    headers.authorization = `Bearer ${options.token}`;
  }

  const response = await doFetch(url, {
    method: 'GET',
    headers,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });

  if (!response.ok) {
    yield {
      type: 'stream-error',
      failure: fail({
        kind: response.status === 404 ? 'no-encontrado' : 'servicio',
        status: response.status,
        url,
        message:
          response.status === 404
            ? 'El análisis no existe o expiró.'
            : `El servicio de análisis respondió ${response.status} al abrir el stream de progreso.`,
      }),
    };
    return;
  }

  const body = response.body;
  if (body === null) {
    yield {
      type: 'stream-error',
      failure: fail({
        kind: 'contrato',
        url,
        message: 'El stream de progreso llegó sin cuerpo.',
      }),
    };
    return;
  }

  const reader: ReadableStreamDefaultReader<Uint8Array> = body.getReader();
  const decoder = new TextDecoder();
  const parse = createSseParser();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      for (const frame of parse(decoder.decode(value, { stream: true }))) {
        const event = decodeFrame(frame);
        if (event !== null) yield event;
      }
    }
  } finally {
    // Cerrar el `for await` río arriba tiene que soltar el socket, no dejarlo
    // colgado hasta el GC.
    await reader.cancel().catch(() => undefined);
  }
}

/**
 * Progreso del análisis como `AsyncIterable`, con reconexión y limpieza.
 *
 * ```ts
 * for await (const event of streamAnalysisEvents({ baseUrl, analysisId, signal })) {
 *   if (event.type === 'progress') setMessage(event.message);
 *   if (isTerminalStreamEvent(event)) break;
 * }
 * ```
 *
 * Termina siempre con exactamente un evento terminal: `done`, `failed` o
 * `stream-error`. Un `break` del consumidor cierra el socket por el `finally`
 * de `connect`.
 */
export async function* streamAnalysisEvents(
  options: StreamAnalysisEventsOptions,
): AsyncGenerator<AnalysisStreamEvent> {
  const url = `${options.baseUrl.replace(/\/+$/, '')}/analysis/${encodeURIComponent(options.analysisId)}/events`;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const backoff = options.retryDelayMs ?? defaultBackoff;
  const sleep = options.sleep ?? defaultSleep;

  /** Deduplicación del replay: el servicio reenvía el progreso en cada connect. */
  let lastStep = 0;
  let attempt = 0;

  for (;;) {
    if (isAborted(options.signal)) {
      yield { type: 'stream-error', failure: abortFailure() };
      return;
    }

    let sawTransportError = false;

    try {
      for await (const event of connect(url, options)) {
        if (event.type === 'progress') {
          if (event.step <= lastStep) continue;
          lastStep = event.step;
        }
        if (event.type === 'stream-error') {
          // Un 404 o un 5xx no se reintenta: reconectar no lo va a arreglar.
          yield event;
          return;
        }
        // Una conexión que entregó algo reinicia el presupuesto de reintentos.
        attempt = 0;
        yield event;
        if (isTerminalStreamEvent(event)) return;
      }
    } catch (error) {
      if (isAbort(error) || isAborted(options.signal)) {
        yield { type: 'stream-error', failure: abortFailure() };
        return;
      }
      sawTransportError = true;
      if (attempt >= maxRetries) {
        yield {
          type: 'stream-error',
          failure: fail({
            kind: 'red',
            url,
            cause: error,
            message: `Se perdió la conexión con el servicio de análisis tras ${attempt + 1} intento(s).`,
          }),
        };
        return;
      }
    }

    // El servidor cerró limpio sin evento terminal (proxy, timeout de idle):
    // también es motivo de reconexión, pero cuenta contra el mismo presupuesto.
    if (!sawTransportError && attempt >= maxRetries) {
      yield {
        type: 'stream-error',
        failure: fail({
          kind: 'red',
          url,
          message: 'El stream de progreso se cerró sin informar un resultado.',
        }),
      };
      return;
    }

    await sleep(backoff(attempt));
    attempt += 1;
  }
}
