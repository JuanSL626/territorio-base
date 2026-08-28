import { describe, expect, it } from 'vitest';

import { analysisThemeProgress, stepStateOf } from './progress-model';

import type { LiveRunSnapshot } from '~/lib/analysis-runtime';

function snapshot(overrides: Partial<LiveRunSnapshot> = {}): LiveRunSnapshot {
  return {
    analysisId: 'a1',
    status: 'running',
    progress: [],
    elapsedMs: 1_000,
    sources: {
      raster: 'pending',
      hidrologia: 'pending',
      'areas-protegidas': 'pending',
      mepyd: 'pending',
    },
    error: null,
    finished: false,
    ...overrides,
  };
}

describe('stepStateOf', () => {
  it('trata `pending` como en curso mientras la corrida vive', () => {
    expect(stepStateOf('pending', false)).toBe('running');
  });

  it('trata `pending` como pendiente una vez terminada la corrida', () => {
    expect(stepStateOf('pending', true)).toBe('pending');
  });

  it('cierra `ok`, `empty` y `skipped` como pasos cumplidos', () => {
    expect(stepStateOf('ok', false)).toBe('done');
    expect(stepStateOf('empty', false)).toBe('done');
    expect(stepStateOf('skipped', false)).toBe('done');
  });

  it('propaga el error de la fuente', () => {
    expect(stepStateOf('error', false)).toBe('error');
  });

  it('trata una fuente desconocida igual que `pending`', () => {
    expect(stepStateOf(undefined, false)).toBe('running');
  });
});

describe('analysisThemeProgress', () => {
  it('sin snapshot devuelve las cuatro tarjetas, todas en curso', () => {
    const themes = analysisThemeProgress(null);
    expect(themes.map((theme) => theme.id)).toEqual([
      'raster',
      'hidrologia',
      'areas-protegidas',
      'mepyd',
    ]);
    expect(themes.every((theme) => theme.steps.every((step) => step.state === 'running'))).toBe(
      true,
    );
  });

  it('sin eventos del pipeline muestra un solo paso raster en curso', () => {
    const [raster] = analysisThemeProgress(snapshot());
    expect(raster?.steps).toHaveLength(1);
    expect(raster?.steps[0]?.state).toBe('running');
  });

  it('marca cumplidos todos los pasos raster menos el último', () => {
    const [raster] = analysisThemeProgress(
      snapshot({
        progress: [
          { step: 1, total: 4, message: 'Buscando escenas', at: '2026-01-01T00:00:00Z' },
          { step: 2, total: 4, message: 'Componiendo NDVI', at: '2026-01-01T00:00:10Z' },
        ],
      }),
    );
    expect(raster?.steps.map((step) => step.state)).toEqual(['done', 'running']);
    expect(raster?.steps.map((step) => step.label)).toEqual([
      'Buscando escenas',
      'Componiendo NDVI',
    ]);
  });

  it('pinta en rojo el último paso raster cuando la fuente falló', () => {
    const [raster] = analysisThemeProgress(
      snapshot({
        progress: [{ step: 1, total: 4, message: 'Buscando escenas', at: '2026-01-01T00:00:00Z' }],
        sources: {
          raster: 'error',
          hidrologia: 'ok',
          'areas-protegidas': 'ok',
          mepyd: 'ok',
        },
      }),
    );
    expect(raster?.steps[0]?.state).toBe('error');
  });

  it('resuelve cada fuente vectorial por separado', () => {
    const themes = analysisThemeProgress(
      snapshot({
        sources: {
          raster: 'pending',
          hidrologia: 'ok',
          'areas-protegidas': 'error',
          mepyd: 'pending',
        },
      }),
    );
    const byId = new Map(themes.map((theme) => [theme.id, theme.steps[0]?.state]));
    // Regresión #3: una escena Sentinel-2 lenta no bloquea a las demás.
    expect(byId.get('hidrologia')).toBe('done');
    expect(byId.get('areas-protegidas')).toBe('error');
    expect(byId.get('mepyd')).toBe('running');
    expect(byId.get('raster')).toBe('running');
  });
});
