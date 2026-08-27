import { describe, expect, it } from 'vitest';

import { MEPYD_LAYERS, MEPYD_SUBGROUPS, MEPYD_TABLE } from './mepyd';
import { LAYER_REGISTRY, GROUP_ORDER, getLayer, buildLayerTree } from './registry';
import { isVectorLayer, type ThemeId } from './types';
import { MAX_VISIBLE_DATA_LAYERS, VISTAS } from './vistas';

/*
  Los chequeos de CI del 02-design-brief.md §11. Existen para que la regla
  "agregar una capa es un cambio de datos, no de código" siga siendo cierta
  dentro de seis meses.
*/

describe('registro de capas', () => {
  it('no tiene ids duplicados', () => {
    const ids = LAYER_REGISTRY.map((layer) => layer.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('declara licencia y cita en toda capa', () => {
    for (const layer of LAYER_REGISTRY) {
      expect(layer.source.license, `${layer.id} sin licencia`).not.toBe('');
      expect(layer.source.citation, `${layer.id} sin cita`).not.toBe('');
      expect(layer.source.method, `${layer.id} sin frase de método`).not.toBe('');
    }
  });

  it('da a toda capa vectorial un popup con al menos un alias', () => {
    for (const layer of LAYER_REGISTRY) {
      if (!isVectorLayer(layer)) continue;
      expect(layer.popup, `${layer.id} sin PopupConfig`).toBeDefined();
      expect(layer.popup!.fields.length, `${layer.id} sin campos con alias`).toBeGreaterThan(0);
      for (const field of layer.popup!.fields) {
        expect(field.alias).not.toBe('');
      }
    }
  });

  it('mantiene la opacidad por defecto entre 0 y 1', () => {
    for (const layer of LAYER_REGISTRY) {
      expect(layer.defaultOpacity).toBeGreaterThanOrEqual(0);
      expect(layer.defaultOpacity).toBeLessThanOrEqual(1);
    }
  });

  it('usa sólo grupos declarados en GROUP_ORDER', () => {
    const known = new Set<string>(GROUP_ORDER);
    for (const layer of LAYER_REGISTRY) {
      expect(known.has(layer.group), `grupo desconocido: ${layer.group}`).toBe(true);
    }
  });

  it('respeta el tope de 4 capas de datos por vista', () => {
    const themes: ThemeId[] = VISTAS.map((vista) => vista.id);
    for (const theme of themes) {
      const dataLayers = LAYER_REGISTRY.filter(
        (layer) => layer.themes.includes(theme) && layer.alwaysOn !== true,
      );
      expect(dataLayers.length, `la vista ${theme} supera el tope`).toBeLessThanOrEqual(
        MAX_VISIBLE_DATA_LAYERS,
      );
    }
  });
});

describe('vistas', () => {
  it('referencia sólo capas existentes y coherentes con `themes`', () => {
    for (const vista of VISTAS) {
      for (const preset of vista.layers) {
        const layer = getLayer(preset.id);
        expect(layer, `${vista.id} referencia una capa inexistente: ${preset.id}`).toBeDefined();
        if (preset.on && layer!.alwaysOn !== true) {
          expect(
            layer!.themes.includes(vista.id),
            `${preset.id} se prende en ${vista.id} pero no declara ese tema`,
          ).toBe(true);
        }
        expect(preset.opacity).toBeGreaterThanOrEqual(0);
        expect(preset.opacity).toBeLessThanOrEqual(1);
      }
    }
  });

  it('prende como mucho 4 capas de datos por preset', () => {
    for (const vista of VISTAS) {
      const on = vista.layers.filter((preset) => {
        const layer = getLayer(preset.id);
        return preset.on && layer !== undefined && layer.alwaysOn !== true;
      });
      expect(on.length, `${vista.id} prende demasiadas capas`).toBeLessThanOrEqual(
        MAX_VISIBLE_DATA_LAYERS,
      );
    }
  });
});

describe('catálogo MEPyD', () => {
  it('conserva los 7 grupos del Explorador de Riesgo, en orden', () => {
    expect(MEPYD_SUBGROUPS).toEqual([
      'División Político-Administrativa',
      'Amenaza sísmica (por nivel censal 2010)',
      'Amenazas',
      'Agua',
      'Infraestructuras y edificaciones',
      'Vías',
      'Áreas protegidas (MEPyD)',
    ]);
  });

  it('genera una capa por fila de la tabla', () => {
    expect(MEPYD_LAYERS.length).toBe(MEPYD_TABLE.length);
    expect(MEPYD_LAYERS.length).toBe(39);
  });

  it('no repite color dentro de un mismo grupo (regresión #7)', () => {
    const bySubgroup = new Map<string, string[]>();
    for (const layer of MEPYD_LAYERS) {
      if (layer.legend.type !== 'swatch' || layer.subgroup === undefined) continue;
      const colors = bySubgroup.get(layer.subgroup) ?? [];
      colors.push(layer.legend.color);
      bySubgroup.set(layer.subgroup, colors);
    }
    for (const [subgroup, colors] of bySubgroup) {
      expect(new Set(colors).size, `colores repetidos en ${subgroup}`).toBe(colors.length);
    }
  });

  it('usa relleno bajo y borde fuerte en polígonos (regresión #4)', () => {
    for (const layer of MEPYD_LAYERS) {
      if (layer.kind !== 'vector-polygon' || layer.legend.type !== 'swatch') continue;
      expect(layer.legend.fillFactor).toBeLessThanOrEqual(0.15);
    }
  });

  it('marca todas las capas MEPyD como dependientes de RD', () => {
    for (const layer of MEPYD_LAYERS) {
      expect(layer.requiresRd).toBe(true);
    }
  });
});

describe('árbol del panel', () => {
  it('anida MEPyD en un segundo nivel y deja el resto plano', () => {
    const tree = buildLayerTree();
    const mepyd = tree.find((group) => group.name === 'Contexto RD (MEPyD)');
    expect(mepyd?.subgroups.length).toBe(7);
    expect(mepyd?.layers.length).toBe(0);

    const topo = tree.find((group) => group.name === 'Topografía');
    expect(topo?.subgroups.length).toBe(0);
    expect(topo?.layers.length).toBeGreaterThan(0);
  });
});
