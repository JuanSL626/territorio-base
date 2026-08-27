/**
 * El stream de progreso tiene tres comportamientos que valen un test cada uno:
 * el parser de frames, la deduplicación del replay tras reconectar, y el
 * teardown (que el socket se suelte cuando el consumidor corta).
 */
import { describe, expect, it } from 'vitest';

import {
  createSseParser,
  decodeFrame,
  streamAnalysisEvents,
  type AnalysisStreamEvent,
  type SseFetch,
} from '../sse.ts';

const STEP_DEM = 'Descargando DEM (Copernicus GLO-30)…';
const STEP_NDVI = 'Descargando Sentinel-2 y calculando NDVI…';
const STEP_DONE = 'Análisis completo';

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function progress(step: number, message: string): string {
  return frame('progress', { step, total: 4, message, at: '2026-01-01T00:00:00Z' });
}

/** Responde un `text/event-stream` con los chunks dados, en orden. */
function sseResponse(chunks: readonly string[], onCancel: () => void): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
    cancel() {
      onCancel();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function collect(
  stream: AsyncGenerator<AnalysisStreamEvent>,
): Promise<AnalysisStreamEvent[]> {
  const events: AnalysisStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('createSseParser', () => {
  it('junta frames partidos entre chunks', () => {
    const parse = createSseParser();
    expect(parse('event: progress\ndata: {"a"')).toEqual([]);
    expect(parse(':1}\n\n')).toEqual([{ event: 'progress', data: '{"a":1}' }]);
  });

  it('acepta CRLF y varias líneas data en un frame', () => {
    const parse = createSseParser();
    expect(parse('event: x\r\ndata: uno\r\ndata: dos\r\n\r\n')).toEqual([
      { event: 'x', data: 'uno\ndos' },
    ]);
  });

  it('ignora los comentarios de keepalive', () => {
    const parse = createSseParser();
    expect(parse(': keepalive\n\nevent: ping\ndata: {}\n\n')).toEqual([
      { event: 'ping', data: '{}' },
    ]);
  });
});

describe('decodeFrame', () => {
  it('traduce cada evento del servicio a su variante tipada', () => {
    expect(
      decodeFrame({
        event: 'progress',
        data: JSON.stringify({ step: 1, total: 4, message: STEP_DEM, at: 'ahora' }),
      }),
    ).toEqual({ type: 'progress', step: 1, total: 4, message: STEP_DEM, at: 'ahora' });

    expect(decodeFrame({ event: 'status', data: '{"status":"running"}' })).toEqual({
      type: 'status',
      status: 'running',
    });

    expect(decodeFrame({ event: 'done', data: '{"status":"partial","error":null}' })).toEqual({
      type: 'done',
      status: 'partial',
      error: null,
    });

    // `error` del servidor = el JOB falló, y se llama `failed` para no
    // confundirlo con `stream-error`, que es perder la conexión.
    expect(decodeFrame({ event: 'error', data: '{"status":"error","error":"boom"}' })).toEqual({
      type: 'failed',
      status: 'error',
      error: 'boom',
    });
  });

  it('descarta los keepalive y los frames ilegibles', () => {
    expect(decodeFrame({ event: 'ping', data: '{}' })).toBeNull();
    expect(decodeFrame({ event: 'progress', data: 'no-json' })).toBeNull();
    expect(decodeFrame({ event: 'progress', data: '{"step":"uno"}' })).toBeNull();
  });
});

describe('streamAnalysisEvents', () => {
  const base = { baseUrl: 'http://api.test', analysisId: 'job-1' };
  const noSleep = async (): Promise<void> => {
    await Promise.resolve();
  };

  it('emite el progreso en orden y termina en `done`', async () => {
    const fetchImpl: SseFetch = async () =>
      await Promise.resolve(
        sseResponse(
          [
            frame('status', { status: 'running' }),
            progress(1, STEP_DEM),
            progress(2, STEP_NDVI),
            frame('ping', {}),
            progress(4, STEP_DONE),
            frame('done', { status: 'ok', error: null }),
          ],
          () => undefined,
        ),
      );

    const events = await collect(streamAnalysisEvents({ ...base, fetchImpl, sleep: noSleep }));

    expect(events.map((event) => event.type)).toEqual([
      'status',
      'progress',
      'progress',
      'progress',
      'done',
    ]);
    expect(events.filter((e) => e.type === 'progress').map((e) => e.message)).toEqual([
      STEP_DEM,
      STEP_NDVI,
      STEP_DONE,
    ]);
  });

  it('deduplica el replay: reconectar no repite pasos ya vistos', async () => {
    let call = 0;
    const fetchImpl: SseFetch = async () => {
      call += 1;
      if (call === 1) {
        // Se corta después del paso 2.
        return await Promise.resolve(
          sseResponse([progress(1, STEP_DEM), progress(2, STEP_NDVI)], () => undefined),
        );
      }
      // Al reconectar el servicio REENVÍA todo el progreso previo.
      return await Promise.resolve(
        sseResponse(
          [
            progress(1, STEP_DEM),
            progress(2, STEP_NDVI),
            progress(4, STEP_DONE),
            frame('done', { status: 'ok', error: null }),
          ],
          () => undefined,
        ),
      );
    };

    const events = await collect(streamAnalysisEvents({ ...base, fetchImpl, sleep: noSleep }));
    const steps = events.filter((event) => event.type === 'progress').map((event) => event.step);

    expect(steps).toEqual([1, 2, 4]);
    expect(events.at(-1)?.type).toBe('done');
    expect(call).toBe(2);
  });

  it('agota los reintentos y sale con `stream-error`, sin lanzar', async () => {
    let calls = 0;
    const fetchImpl: SseFetch = async () => {
      calls += 1;
      return await Promise.reject(new Error('ECONNRESET'));
    };

    const events = await collect(
      streamAnalysisEvents({ ...base, fetchImpl, sleep: noSleep, maxRetries: 2 }),
    );

    expect(calls).toBe(3);
    expect(events).toHaveLength(1);
    const [only] = events;
    expect(only?.type).toBe('stream-error');
    if (only?.type !== 'stream-error') return;
    expect(only.failure.kind).toBe('red');
  });

  it('no reintenta un 404: reconectar no lo va a arreglar', async () => {
    let calls = 0;
    const fetchImpl: SseFetch = async () => {
      calls += 1;
      return await Promise.resolve(new Response('no', { status: 404 }));
    };

    const events = await collect(streamAnalysisEvents({ ...base, fetchImpl, sleep: noSleep }));

    expect(calls).toBe(1);
    const [only] = events;
    if (only?.type !== 'stream-error') throw new Error('esperaba stream-error');
    expect(only.failure.kind).toBe('no-encontrado');
  });

  it('cortar el consumidor cancela el body: el socket no queda colgado', async () => {
    let cancelled = false;
    const fetchImpl: SseFetch = async () =>
      await Promise.resolve(
        sseResponse([progress(1, STEP_DEM), progress(2, STEP_NDVI)], () => {
          cancelled = true;
        }),
      );

    for await (const event of streamAnalysisEvents({ ...base, fetchImpl, sleep: noSleep })) {
      if (event.type === 'progress') break;
    }

    expect(cancelled).toBe(true);
  });

  it('un signal ya abortado no abre conexión y sale como `cancelado`', async () => {
    let calls = 0;
    const fetchImpl: SseFetch = async () => {
      calls += 1;
      return await Promise.resolve(new Response(null, { status: 200 }));
    };

    const controller = new AbortController();
    controller.abort();

    const events = await collect(
      streamAnalysisEvents({ ...base, fetchImpl, sleep: noSleep, signal: controller.signal }),
    );

    expect(calls).toBe(0);
    const [only] = events;
    if (only?.type !== 'stream-error') throw new Error('esperaba stream-error');
    expect(only.failure.kind).toBe('cancelado');
  });
});
