import { describe, expect, it } from 'vitest';

import {
  buildCandidates,
  buildInspectorFeature,
  formatFieldValue,
  type FeatureHit,
} from './inspector-model';

import { MEPYD_IDS } from '~/layers/mepyd';

const AOI = { areaHa: 128.4, utmEpsg: 32619 };

function build(hit: FeatureHit, count = 1) {
  return buildInspectorFeature({ hit, aoi: AOI, layerFeatureCount: count });
}

describe('hidrología OSM — alias y visibilidad opt-in (§5.2)', () => {
  const hit: FeatureHit = {
    layerId: 'osm-hydro',
    featureId: 'osm-24193',
    properties: {
      osm_id: 24193,
      kind: 'waterway',
      name: 'Río Yaque del Norte',
      distance_m: 0,
      // Ruido crudo de OSM que NO puede llegar a la pantalla.
      waterway: 'stream',
      'tiger:cfcc': 'A41',
    },
  };

  it('titula con el nombre y subtitula con el tipo LEGIBLE, no con `waterway=stream`', () => {
    const feature = build(hit, 47);
    expect(feature?.title).toBe('Río Yaque del Norte');
    expect(feature?.subtitle).toBe('Curso de agua · OSM 24193');
  });

  it('muestra sólo los campos con alias, más los derivados', () => {
    const aliases = build(hit)?.fields.map((field) => field.alias);
    expect(aliases).toEqual(['Nombre', 'Tipo', 'Distancia al AOI']);
  });

  it('no filtra ningún atributo crudo del servicio', () => {
    const values = build(hit)?.fields.map((field) => field.value) ?? [];
    expect(values.join(' ')).not.toContain('stream');
    expect(values.join(' ')).not.toContain('tiger');
  });

  it('traduce `kind` con el mapa de etiquetas del registro', () => {
    const tipo = build(hit)?.fields.find((field) => field.alias === 'Tipo');
    expect(tipo?.value).toBe('Curso de agua');
  });

  it('distancia 0 se dice "0 m (intersecta)", no "0 m"', () => {
    const distancia = build(hit)?.fields.find((field) => field.alias === 'Distancia al AOI');
    expect(distancia?.value).toBe('0 m (intersecta)');
  });

  it('un curso sin nombre cae al texto explícito, no a "undefined"', () => {
    const feature = build({ ...hit, properties: { ...hit.properties, name: null } });
    expect(feature?.title).toBe('Sin nombre');
  });

  it('lleva el conteo de la capa para el link a la vista de tabla', () => {
    expect(build(hit, 47)?.layerFeatureCount).toBe(47);
  });
});

describe('WDPA — la categoría UICN se expande (§5.2)', () => {
  const feature = build({
    layerId: 'wdpa',
    featureId: 'wdpa-0',
    properties: {
      name: 'Sibarí',
      desig: 'Reserva Científica',
      desig_eng: 'Scientific Reserve',
      iucn_cat: 'II',
      status: 'Designated',
      mang_auth: 'Ministerio de Medio Ambiente',
      distance_m: 0,
      overlap_ha: 32.1,
    },
  });

  it('nunca muestra el código crudo `II`', () => {
    const uicn = feature?.fields.find((field) => field.alias === 'Categoría UICN');
    expect(uicn?.value).toBe('II · Parque nacional');
  });

  it('no muestra `desig_eng` ni `mang_auth` (se traen, no se exhiben)', () => {
    const aliases = feature?.fields.map((field) => field.alias) ?? [];
    expect(aliases).not.toContain('desig_eng');
    expect(aliases).not.toContain('mang_auth');
  });

  it('calcula el solape como % del AOI', () => {
    const pct = feature?.fields.find((field) => field.alias === 'Solape (% del AOI)');
    expect(pct?.value).toBe('25,0\u202f%');
  });
});

describe('MEPyD — esquema dinámico (`outFields="*"`, inventario §6)', () => {
  const layerId = MEPYD_IDS.riosArroyos;

  it('usa el heurístico de display MUN_NOM|NOMBRE|nombre|name para el título', () => {
    expect(
      build({ layerId, featureId: 'a', properties: { NOMBRE: 'Arroyo Hondo', OBJECTID: 1 } })
        ?.title,
    ).toBe('Arroyo Hondo');
    expect(
      build({ layerId, featureId: 'b', properties: { MUN_NOM: 'Santiago', nombre: 'x' } })?.title,
    ).toBe('Santiago');
  });

  it('sin ninguno de esos campos, cae a la ETIQUETA DE LA CAPA', () => {
    const feature = build({ layerId, featureId: 'c', properties: { OBJECTID: 7 } });
    expect(feature?.title).toBe('Ríos y arroyos');
  });

  it('renderiza TODAS las columnas que devolvió el servicio, sin inventar alias', () => {
    const feature = build({
      layerId,
      featureId: 'd',
      properties: { NOMBRE: 'Yaque', OBJECTID: 7, LONGITUD_KM: 12.5, ESTADO: null },
    });
    const aliases = feature?.fields.map((field) => field.alias) ?? [];
    expect(aliases).toContain('OBJECTID');
    expect(aliases).toContain('LONGITUD_KM');
    expect(aliases).toContain('ESTADO');
  });

  it('un valor nulo se muestra como guion, no como fila fantasma', () => {
    const feature = build({ layerId, featureId: 'e', properties: { NOMBRE: 'x', ESTADO: null } });
    expect(feature?.fields.find((field) => field.alias === 'ESTADO')?.value).toBe('—');
  });

  it('nunca muestra la propiedad interna del id sintético', () => {
    const feature = build({
      layerId,
      featureId: 'f',
      properties: { NOMBRE: 'x', __tbid: 'no-mostrar' },
    });
    expect(feature?.fields.some((field) => field.alias === '__tbid')).toBe(false);
  });
});

describe('buildCandidates — un click que pega en varias capas (§5.1)', () => {
  it('agrupa por capa y cuenta, sin elegir ganador', () => {
    const candidates = buildCandidates([
      { layerId: 'osm-hydro', featureId: 'a', properties: {} },
      { layerId: 'wdpa', featureId: 'b', properties: {} },
      { layerId: 'wdpa', featureId: 'c', properties: {} },
    ]);

    expect(candidates).toEqual([
      { layerId: 'osm-hydro', layerLabel: 'Hidrología (OSM)', count: 1 },
      { layerId: 'wdpa', layerLabel: 'Áreas protegidas (WDPA)', count: 2 },
    ]);
  });

  it('descarta ids que no están en el registro', () => {
    expect(buildCandidates([{ layerId: 'inventada', featureId: 'x', properties: {} }])).toEqual([]);
  });
});

describe('formatFieldValue', () => {
  it('vacío, nulo y espacios en blanco son todos guion', () => {
    expect(formatFieldValue(null)).toBe('—');
    expect(formatFieldValue(undefined)).toBe('—');
    expect(formatFieldValue('   ')).toBe('—');
  });

  it('booleanos en castellano', () => {
    expect(formatFieldValue(true)).toBe('Sí');
    expect(formatFieldValue(false)).toBe('No');
  });

  it('números con coma decimal española', () => {
    expect(formatFieldValue(1240.5)).toBe('1\u202f240,50');
    expect(formatFieldValue(7)).toBe('7');
  });
});
