/**
 * Prueba de RENDER, no de lógica: que los strings exactos del legacy lleguen
 * de verdad al DOM.
 *
 * `narrative.test.ts` prueba que la función devuelva el texto correcto. Esta
 * prueba cubre el tramo que falta y donde históricamente se pierde la
 * distinción: que la sección efectivamente lo PINTE, en la rama correcta, y que
 * el mapa estático no explote con geometrías reales. Se renderiza a markup
 * estático (sin DOM) porque lo que se verifica es el HTML resultante.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { buildSections, type ReportSection  } from './report-model';
import {
  AreasProtegidasSection,
  ContextoRdSection,
  HidrologiaSection,
  PortadaSection,
  TopografiaSection,
  VegetacionSection,
} from './sections';
import { StaticMap } from './static-map';

import type { AreaGeometry } from '@territorio/geo';
import type { TerritorioAnalysisSummary } from '~/lib/analysis-contract';

const AOI: AreaGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [-69.6, 18.4],
      [-69.5, 18.4],
      [-69.5, 18.5],
      [-69.6, 18.5],
      [-69.6, 18.4],
    ],
  ],
};

function base(): TerritorioAnalysisSummary {
  return {
    id: 'a1',
    raster_job_id: 'j1',
    status: 'ok',
    created_at: '2026-01-01T00:00:00.000Z',
    finished_at: '2026-01-01T00:02:00.000Z',
    params: { ndvi_resolution_m: 10, lookback_days: 180, max_cloud_cover: 30 },
    aoi: { area_ha: 128.4, bbox: [-69.6, 18.4, -69.5, 18.5], utm_epsg: 32619, vertex_count: 5 },
    topography: {
      available: true,
      error: null,
      summary: {
        elevation_min_m: 10,
        elevation_max_m: 110,
        elevation_mean_m: 50,
        elevation_range_m: 100,
        slope_mean_pct: 9.7,
        slope_max_pct: 46.2,
        slope_class_pct: {
          'Plano (0-5%)': 42.1,
          'Suave (5-15%)': 31.4,
          'Moderado (15-30%)': 18,
          'Fuerte (>30%)': 8.5,
        },
      },
    },
    vegetation: {
      available: true,
      error: null,
      ndvi_available: true,
      ndvi_error: null,
      worldcover_available: true,
      worldcover_error: null,
      summary: {
        ndvi_mean: 0.55,
        ndvi_median: 0.58,
        ndvi_p90: 0.75,
        ndvi_density_class_pct: {
          'Sin vegetación / suelo desnudo o agua': 0.6,
          'Vegetación dispersa / matorral bajo': 2.2,
          'Vegetación densa / bosque secundario': 12.4,
          'Vegetación muy densa / dosel maduro': 84.8,
        },
        worldcover_tree_cover_pct: 71.2,
        worldcover_landcover_pct: { 'Bosque / cobertura arbórea': 71.2, Pastizal: 28.8 },
      },
    },
    hydrology: {
      summary: {
        available: true,
        features_found: 0,
        intersects_aoi: false,
        nearest_distance_m: null,
        features: [],
      },
    },
    protected_areas: {
      summary: {
        available: true,
        areas_found: 0,
        intersects_aoi: false,
        overlap_ha: 0,
        overlap_pct_of_aoi: 0,
        nearest_distance_m: null,
        areas: [],
      },
    },
    mepyd_rd: { in_rd: false, summary: {}, failures: [] },
    provenance: {},
    layers: [],
    sources: [],
    coastal: null,
  };
}

function sectionOf(analysis: TerritorioAnalysisSummary, id: ReportSection['id']): ReportSection {
  const section = buildSections(analysis, { fly: false }).find((entry) => entry.id === id);
  if (section === undefined) throw new Error(`sección ausente: ${id}`);
  return section;
}

const NOOP = (): void => undefined;

function render(analysis: TerritorioAnalysisSummary, id: ReportSection['id']): string {
  const section = sectionOf(analysis, id);
  const props = { analysis, section, print: false, onShowOnMap: NOOP };

  switch (id) {
    case 'portada':
      return renderToStaticMarkup(<PortadaSection {...props} />);
    case 'topografia':
      return renderToStaticMarkup(<TopografiaSection {...props} />);
    case 'vegetacion':
      return renderToStaticMarkup(<VegetacionSection {...props} />);
    case 'hidrologia':
      return renderToStaticMarkup(<HidrologiaSection {...props} />);
    case 'areas-protegidas':
      return renderToStaticMarkup(<AreasProtegidasSection {...props} />);
    case 'contexto-rd':
      return renderToStaticMarkup(<ContextoRdSection {...props} />);
    default:
      throw new Error(`sin renderizador para ${id}`);
  }
}

describe('secciones del reporte', () => {
  it('la portada muestra la identidad del AOI y una línea por tema', () => {
    const html = render(base(), 'portada');
    expect(html).toContain('128,4 ha');
    expect(html).toContain('EPSG:32619');
    expect(html).toContain('Resumen ejecutivo');
  });

  it('topografía pinta las cuatro etiquetas exactas de clase de pendiente', () => {
    const html = render(base(), 'topografia');
    for (const label of [
      'Plano (0-5%)',
      'Suave (5-15%)',
      'Moderado (15-30%)',
      'Fuerte (&gt;30%)',
    ]) {
      expect(html).toContain(label);
    }
  });

  it('vegetación no lista las clases WorldCover ausentes (TC-33)', () => {
    const html = render(base(), 'vegetacion');
    expect(html).toContain('Bosque / cobertura arbórea');
    expect(html).toContain('Pastizal');
    expect(html).not.toContain('Manglar');
    expect(html).not.toContain('Nieve/hielo');
  });

  it('hidrología caída: el texto exacto de TC-11, y NO el de "no hay" (TC-14)', () => {
    const analysis = base();
    analysis.hydrology.summary.available = false;
    const html = render(analysis, 'hidrologia');
    expect(html).toContain('No se pudo consultar hidrología (Overpass API)');
    expect(html).not.toContain('No se encontró hidrología mapeada en OSM');
  });

  it('hidrología vacía: el texto exacto de TC-14 y la tabla dice «Sin elementos.»', () => {
    const html = render(base(), 'hidrologia');
    expect(html).toContain('No se encontró hidrología mapeada en OSM cerca del polígono.');
    expect(html).toContain('Sin elementos.');
  });

  it('WDPA que intersecta: aviso explícito con nombre y solape (TC-08)', () => {
    const analysis = base();
    analysis.protected_areas.summary = {
      available: true,
      areas_found: 1,
      intersects_aoi: true,
      overlap_ha: 12.5,
      overlap_pct_of_aoi: 9.7,
      nearest_distance_m: 0,
      areas: [
        {
          name: 'Parque Nacional Sibarí',
          desig: 'Parque Nacional',
          iucn_cat: 'II',
          status: 'Designated',
          distance_m: 0,
          overlap_ha: 12.5,
        },
      ],
    };
    const html = render(analysis, 'areas-protegidas');
    expect(html).toContain('El polígono SÍ intersecta un área de la WDPA:');
    expect(html).toContain('Parque Nacional Sibarí');
    expect(html).toContain('12,5 ha');
    // La categoría UICN cruda nunca llega a la pantalla (§5.2).
    expect(html).toContain('II · Parque nacional');
  });

  it('WDPA caída: no dice que no hay áreas protegidas (TC-07)', () => {
    const analysis = base();
    analysis.protected_areas.summary.available = false;
    const html = render(analysis, 'areas-protegidas');
    expect(html).toContain('No se pudo consultar áreas protegidas (WDPA)');
    expect(html).not.toContain('No se encontraron áreas protegidas (WDPA) cerca');
    expect(html).not.toContain('Sin áreas encontradas.');
  });

  it('MEPyD: encabezado «{etiqueta} ({conteo})» y columnas dinámicas (TC-37)', () => {
    const analysis = base();
    analysis.mepyd_rd = {
      in_rd: true,
      summary: {
        Amenazas: {
          'Área propensa a inundación': {
            count: 2,
            features: [
              { OBJECTID: 1, NOMBRE: 'Zona A', NIVEL: 'Alto' },
              { OBJECTID: 2, NOMBRE: 'Zona B', OTRO_CAMPO: null },
            ],
          },
        },
      },
      failures: [],
    };
    const html = render(analysis, 'contexto-rd');
    expect(html).toContain('Área propensa a inundación (2)');
    expect(html).toContain('OBJECTID');
    expect(html).toContain('OTRO_CAMPO');
    expect(html).toContain('Zona B');
  });
});

describe('mapa estático', () => {
  it('dibuja el AOI, la escala y el norte sin depender de WebGL', () => {
    const analysis = base();
    const section = sectionOf(analysis, 'portada');
    const html = renderToStaticMarkup(
      <StaticMap
        state={section.map}
        geometries={{ aoi: AOI, hydrology: [], protectedAreas: [], mepyd: [] }}
        title="Área de estudio"
      />,
    );
    expect(html).toContain('<svg');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Área de estudio"');
    // Un `path` cerrado por cada anillo del AOI.
    expect(html).toContain('Z"');
    // Norte y barra de escala.
    expect(html).toContain('>N</text>');
    expect(html).toMatch(/>\d+ (m|km)<\/text>/);
  });

  it('la latitud crece hacia arriba: el vértice norte tiene menor Y (regresión #1)', () => {
    const analysis = base();
    const section = sectionOf(analysis, 'portada');
    const html = renderToStaticMarkup(
      <StaticMap
        state={section.map}
        geometries={{ aoi: AOI, hydrology: [], protectedAreas: [], mepyd: [] }}
        title="Orientación"
      />,
    );

    const match = /d="M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)/.exec(
      html,
    );
    expect(match).not.toBeNull();
    if (match === null) return;

    // El anillo va (sur-oeste, sur-este, norte-este, norte-oeste): los dos
    // primeros vértices son el borde SUR y deben quedar MÁS ABAJO en el SVG.
    const southY = Number(match[2]);
    const northY = Number(match[6]);
    expect(southY).toBeGreaterThan(northY);
  });
});
