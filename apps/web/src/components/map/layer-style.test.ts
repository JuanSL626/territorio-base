import { describe, expect, it } from 'vitest';

import {
  colorExpression,
  highlightSpecs,
  sortKey,
  vectorLayerSpecs,
  type StyledLayer,
} from './layer-style';

import type { LayerDef } from '~/layers/types';

import { MEPYD_LAYERS } from '~/layers/mepyd';
import { getLayer } from '~/layers/registry';

/** Busca por rol y NARROWEA: el spec de una capa `line` no tiene `fill-opacity`. */
function pick<R extends StyledLayer['role']>(
  specs: StyledLayer[],
  role: R,
): Extract<StyledLayer, { role: R }> | undefined {
  return specs.find((spec): spec is Extract<StyledLayer, { role: R }> => spec.role === role);
}

function layer(id: string): LayerDef {
  const found = getLayer(id);
  if (found === undefined) throw new Error(`Capa inexistente en el registro: ${id}`);
  return found;
}

/* -------------------------------------------------------------------------- */
/* Regresión #4 — polígonos de amenaza apilados                                */
/* -------------------------------------------------------------------------- */

describe('regresión #4 — relleno bajo + borde fuerte', () => {
  const deslizamiento = layer('mepyd:amenazas/amenaza-de-deslizamiento');

  it('el relleno de un polígono MEPyD queda muy por debajo del 0,34 que hacía el blob', () => {
    const specs = vectorLayerSpecs(deslizamiento, 1);
    const fill = pick(specs, 'fill');
    expect(fill).toBeDefined();
    // 1 × fillFactor 0,12 del registro.
    expect(fill?.spec.paint?.['fill-opacity']).toBeCloseTo(0.12, 5);
    expect(Number(fill?.spec.paint?.['fill-opacity'])).toBeLessThan(0.2);
  });

  it('tres amenazas superpuestas al 0,12 siguen sumando menos que una sola al 0,34', () => {
    // Composición alfa: 1 - (1 - a)^3. Es la cuenta que hacía ilegible el mapa.
    const stacked = 1 - (1 - 0.12) ** 3;
    expect(stacked).toBeLessThan(1 - (1 - 0.34) ** 2);
  });

  it('el borde va en su PROPIA capa y es opaco aunque el relleno no lo sea', () => {
    const specs = vectorLayerSpecs(deslizamiento, 1);
    const outline = pick(specs, 'outline');
    expect(outline?.spec.type).toBe('line');
    expect(outline?.spec.paint?.['line-opacity']).toBe(1);
    expect(Number(outline?.spec.paint?.['line-width'])).toBeGreaterThanOrEqual(2.5);
  });

  it('la opacidad del usuario escala relleno y borde por separado', () => {
    const specs = vectorLayerSpecs(deslizamiento, 0.5);
    expect(pick(specs, 'fill')?.spec.paint?.['fill-opacity']).toBeCloseTo(0.06, 5);
    expect(pick(specs, 'outline')?.spec.paint?.['line-opacity']).toBe(0.5);
  });

  it('el AOI no dibuja relleno: es un límite, no una mancha', () => {
    const specs = vectorLayerSpecs(layer('aoi'), 1);
    expect(specs.some((spec) => spec.role === 'fill')).toBe(false);
    expect(specs.some((spec) => spec.role === 'outline')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Regresión #5 — puntos                                                       */
/* -------------------------------------------------------------------------- */

describe('regresión #5 — puntos como círculos, nunca pines', () => {
  const salud = layer('mepyd:infraestructuras-y-edificaciones/infraestructura-de-salud');

  it('emite una capa `circle`, no `symbol`', () => {
    const specs = vectorLayerSpecs(salud, 0.85);
    expect(specs).toHaveLength(1);
    expect(specs[0]?.spec.type).toBe('circle');
  });

  it('el color del círculo es el de LA CAPA, no un default', () => {
    const specs = vectorLayerSpecs(salud, 0.85);
    const color = pick(specs, 'point')?.spec.paint?.['circle-color'];
    expect(color).toBe(salud.legend.type === 'swatch' ? salud.legend.color : undefined);
    expect(typeof color).toBe('string');
  });

  it('el radio queda en el orden del `CircleMarker` r=4 del legacy', () => {
    const specs = vectorLayerSpecs(salud, 1);
    const radius = pick(specs, 'point')?.spec.paint?.['circle-radius'];
    // Expresión de interpolación por zoom; los valores están alrededor de 4.
    expect(JSON.stringify(radius)).toContain('4');
  });
});

/* -------------------------------------------------------------------------- */
/* Regresión #7 — un color por capa                                            */
/* -------------------------------------------------------------------------- */

describe('regresión #7 — color por capa, no por grupo', () => {
  it('ninguna capa MEPyD comparte color con otra de su MISMO subgrupo', () => {
    const bySubgroup = new Map<string, string[]>();
    for (const item of MEPYD_LAYERS) {
      const key = item.subgroup ?? '';
      const color = item.legend.type === 'swatch' ? item.legend.color : '';
      bySubgroup.set(key, [...(bySubgroup.get(key) ?? []), color]);
    }

    for (const [subgroup, colors] of bySubgroup) {
      expect(new Set(colors).size, `subgrupo «${subgroup}» repite color`).toBe(colors.length);
    }
  });

  it('la paleta se recicla ENTRE grupos (12 colores para 39 capas)', () => {
    const colors = new Set(
      MEPYD_LAYERS.map((item) => (item.legend.type === 'swatch' ? item.legend.color : '')),
    );
    expect(MEPYD_LAYERS.length).toBeGreaterThan(12);
    expect(colors.size).toBe(12);
  });
});

/* -------------------------------------------------------------------------- */
/* Color categórico                                                            */
/* -------------------------------------------------------------------------- */

describe('colorExpression', () => {
  it('hidrología pinta sus tres tipos con los hex EXACTOS del inventario §4', () => {
    const expression = colorExpression(layer('osm-hydro'));
    const serialized = JSON.stringify(expression);

    expect(serialized).toContain('"waterway","#1f78b4"');
    expect(serialized).toContain('"water_body","#08519c"');
    expect(serialized).toContain('"wetland","#41b6c4"');
    expect(serialized.startsWith('["match",["get","kind"]')).toBe(true);
  });

  it('una capa de color plano devuelve el literal del registro', () => {
    expect(colorExpression(layer('wdpa'))).toBe('#d95f02');
  });
});

/* -------------------------------------------------------------------------- */
/* Resaltado y orden                                                           */
/* -------------------------------------------------------------------------- */

describe('highlightSpecs', () => {
  it('filtra por el id sintético del feature, no por `feature-state`', () => {
    const specs = highlightSpecs(layer('wdpa'), 'wdpa-3');
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      expect(JSON.stringify(spec.spec.filter)).toBe('["==",["get","__tbid"],"wdpa-3"]');
    }
  });

  it('una capa raster no tiene qué resaltar', () => {
    expect(highlightSpecs(layer('dem'), 'x')).toEqual([]);
  });
});

describe('sortKey', () => {
  it('apila raster < relleno < borde < línea < punto < AOI', () => {
    expect(sortKey('raster', 0, false)).toBeLessThan(sortKey('fill', 0, false));
    expect(sortKey('fill', 0, false)).toBeLessThan(sortKey('outline', 0, false));
    expect(sortKey('outline', 0, false)).toBeLessThan(sortKey('line', 0, false));
    expect(sortKey('line', 0, false)).toBeLessThan(sortKey('point', 0, false));
    expect(sortKey('point', 9999, false)).toBeLessThan(sortKey('fill', 0, true));
  });

  it('dentro de una banda desempata el orden del registro', () => {
    expect(sortKey('fill', 1, false)).toBeLessThan(sortKey('fill', 2, false));
  });
});
