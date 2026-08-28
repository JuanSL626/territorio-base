import { describe, expect, it } from 'vitest';

import { describeResolvedLegend, resolveLegend } from './legend-model';

import type { LayerDef } from '~/layers/types';

import { getLayer } from '~/layers/registry';

function layer(id: string): LayerDef {
  const found = getLayer(id);
  if (found === undefined) throw new Error(`Capa inexistente: ${id}`);
  return found;
}

describe('WorldCover — leyenda DISPERSA (inventario §4)', () => {
  it('lista sólo las clases presentes en el AOI, con su hex oficial', () => {
    const resolved = resolveLegend(layer('worldcover'), {
      presentLabels: ['Bosque / cobertura arbórea', 'Área construida'],
    });

    expect(resolved?.kind).toBe('classes');
    if (resolved?.kind !== 'classes') return;
    expect(resolved.classes.map((item) => item.label)).toEqual([
      'Bosque / cobertura arbórea',
      'Área construida',
    ]);
    expect(resolved.classes.map((item) => item.color)).toEqual(['#006400', '#fa0000']);
  });

  it('sin ninguna clase presente, la capa NO aporta bloque de leyenda (§12.12)', () => {
    expect(resolveLegend(layer('worldcover'), { presentLabels: [] })).toBeNull();
  });

  it('si todavía no se sabe qué hay, muestra las 11 clases en vez de nada', () => {
    const resolved = resolveLegend(layer('worldcover'), undefined);
    expect(resolved?.kind === 'classes' ? resolved.classes.length : 0).toBe(11);
  });
});

describe('hidrología — sólo los tipos presentes', () => {
  it('un AOI con un solo curso de agua muestra una sola fila', () => {
    const resolved = resolveLegend(layer('osm-hydro'), { presentLabels: ['Curso de agua'] });
    expect(resolved?.kind === 'classes' ? resolved.classes : []).toEqual([
      { label: 'Curso de agua', color: '#1f78b4' },
    ]);
  });
});

describe('clases NO dispersas', () => {
  it('las 4 clases de pendiente se muestran siempre (suman ~100 %)', () => {
    const resolved = resolveLegend(layer('slope-classes'), { presentLabels: [] });
    expect(resolved?.kind === 'classes' ? resolved.classes.length : 0).toBe(4);
  });
});

describe('rampas', () => {
  it('el DEM usa el mínimo y el máximo REALES del AOI', () => {
    const resolved = resolveLegend(layer('dem'), { domain: { min: 12, max: 1840 } });
    expect(resolved).toMatchObject({ kind: 'ramp', minLabel: '12 m', maxLabel: '1 840 m' });
  });

  it('sin extremos todavía, rotula honestamente en vez de inventar números', () => {
    const dem = resolveLegend(layer('dem'), undefined);
    expect(dem).toMatchObject({ minLabel: 'mín.', maxLabel: 'máx.' });

    const slope = resolveLegend(layer('slope'), undefined);
    expect(slope).toMatchObject({ maxLabel: 'percentil 98' });
  });

  it('un dominio fijo del registro (NDVI -1..1) no necesita datos', () => {
    expect(resolveLegend(layer('ndvi'), undefined)).toMatchObject({
      minLabel: '-1,0',
      maxLabel: '1,0',
    });
  });
});

describe('equivalente de texto', () => {
  it('toda leyenda tiene una frase legible para lectores de pantalla', () => {
    const resolved = resolveLegend(layer('wdpa'), undefined);
    expect(resolved).not.toBeNull();
    if (resolved === null) return;
    expect(describeResolvedLegend(resolved)).toBe('Área protegida (WDPA)');
  });
});
