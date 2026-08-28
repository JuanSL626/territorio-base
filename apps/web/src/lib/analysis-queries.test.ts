/**
 * `pollWhileNotReady` — la red de seguridad que hace que el resultado de un
 * análisis llegue a la pantalla sin depender de `useAnalysisProgress` (que
 * sólo funciona mientras la corrida vive en memoria de ESTE proceso).
 *
 * Bug real (reproducido a mano con Puppeteer contra `pnpm dev` y contra el
 * build de producción): dos fallos transitorios seguidos de `fetchAnalysis`
 * (un blip de red, el server reiniciando a mitad de un poll — `retry: 1` del
 * `QueryClient` global agota su único reintento) dejaban `query.state.data`
 * sin definir PARA SIEMPRE, porque nunca hubo un fetch exitoso. Antes,
 * `pollWhileNotReady(undefined)` devolvía `false` — la interpretaba como "ya
 * sé que no hay nada que esperar" en vez de "todavía no sé nada" — y el chip
 * del topbar se quedaba en «AOI: calculando…» y las 39+ filas de capa en
 * `disabled` de forma indefinida, aunque el análisis ya hubiera terminado del
 * lado del motor (confirmado en SQLite). Sólo un F5 lo arreglaba, porque un
 * `QueryClient` nuevo no carga ese `undefined` envenenado.
 */
import { describe, expect, it } from 'vitest';

import { pollWhileNotReady, RESULT_POLL_MS } from './analysis-queries';

import type { AnalysisRefusal } from './analysis-server';

const noListo: AnalysisRefusal = {
  ok: false,
  reason: 'no-listo',
  message: 'El análisis todavía está corriendo.',
};

const noEncontrado: AnalysisRefusal = {
  ok: false,
  reason: 'no-encontrado',
  message: 'No existe ese análisis, o no es tuyo.',
};

describe('pollWhileNotReady', () => {
  it('sigue insistiendo mientras no hay ningún resultado todavía (primera carga, o tras un fallo transitorio)', () => {
    // Éste es el caso que rompía: un `fetchAnalysis` que tiró (dos veces,
    // agotando el `retry: 1` global) deja `query.state.data` en `undefined`
    // exactamente igual que la primera carga, sin ninguna forma de
    // distinguirlos desde acá — así que los dos tienen que seguir insistiendo.
    expect(pollWhileNotReady(undefined)).toBe(RESULT_POLL_MS);
  });

  it('sigue insistiendo mientras el análisis está corriendo (no-listo)', () => {
    expect(pollWhileNotReady(noListo)).toBe(RESULT_POLL_MS);
  });

  it('para de insistir apenas el análisis está listo', () => {
    expect(pollWhileNotReady({ ok: true })).toBe(false);
  });

  it('para de insistir ante un rechazo terminal (no-listo es el único transitorio)', () => {
    expect(pollWhileNotReady(noEncontrado)).toBe(false);
  });
});
