/**
 * Las CONCLUSIONES del reporte, derivadas de los números reales.
 *
 * Este módulo es puro y sin JSX a propósito: las mismas frases tienen que salir
 * idénticas en la pantalla, en la vista de impresión y (cuando exista) en el
 * Markdown exportado, y tienen que poder probarse sin montar React.
 *
 * Dos reglas gobiernan todo lo que se escribe acá:
 * 1. `available: false` nunca se lee como "no hay". Es la regresión #3 del
 *    inventario: "no se pudo consultar" y "consulté y no hay nada" son dos
 *    hechos distintos, con dos colores y dos textos distintos (UC-13..20,
 *    TC-07..14). Las cuatro ramas de hidrología y de áreas protegidas se
 *    derivan acá, una sola vez, con los strings EXACTOS del legacy.
 * 2. El análisis es DESCRIPTIVO: describe y contextualiza lo que muestran
 *    los datos; no recomienda, no autoriza, no prohíbe y no afirma qué
 *    régimen legal aplica. Un solape con la WDPA se enuncia como un hecho a
 *    verificar contra la delimitación oficial, nunca como una prohibición.
 *
 * El registro de la audiencia es el de alguien que sabe leer un plano pero no
 * necesariamente un SIG: nada de "NDVI p90" sin decir qué significa.
 */
import type { CoastalPreset, TopographyResult, VegetationResult } from '@territorio/api-client';
import type { HydrologySummary, ProtectedAreasSummary } from '@territorio/geo';

import { type CoastalRun, type TerritorioAnalysisSummary, SOURCE_DOWN_MESSAGES  } from '~/lib/analysis-contract';
import { formatHectares, formatNumber, formatPercent } from '~/lib/format';

/** El tono decide el color del bloque; es el mismo vocabulario de los banners. */
export type ConclusionTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export type Conclusion = {
  id: string;
  tone: ConclusionTone;
  text: string;
};

/**
 * Las cuatro ramas mutuamente excluyentes que tienen hidrología y áreas
 * protegidas (UC-13..20). El orden de decisión importa: `no-consultado` gana
 * SIEMPRE, porque sin respuesta del servicio ninguna de las otras tres es
 * afirmable.
 */
export type BranchState = 'no-consultado' | 'intersecta' | 'cerca' | 'sin-elementos';

export function branchOf(input: {
  available: boolean;
  intersects: boolean;
  found: number;
}): BranchState {
  if (!input.available) return 'no-consultado';
  if (input.intersects) return 'intersecta';
  return input.found > 0 ? 'cerca' : 'sin-elementos';
}

/** Distancia en METROS, sin saltar a km: preserva el string exacto del legacy. */
function meters(value: number): string {
  return `${formatNumber(value, 0)} m`;
}

function nonEmpty(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function dominantEntry(
  record: Record<string, number> | null | undefined,
): { label: string; pct: number } | null {
  if (record == null) return null;
  let best: { label: string; pct: number } | null = null;
  for (const [label, pct] of Object.entries(record)) {
    if (!Number.isFinite(pct)) continue;
    if (best === null || pct > best.pct) best = { label, pct };
  }
  return best;
}

function sumOf(record: Record<string, number> | null | undefined, labels: string[]): number {
  if (record == null) return 0;
  return labels.reduce((total, label) => total + (record[label] ?? 0), 0);
}

/*
  Banners de 4 estados — STRINGS EXACTOS DEL LEGACY. Los cuatro textos de cada
  fuente son citas literales del inventario §8 (TC-07..TC-14). No se
  reescriben, no se "mejoran" y no se traducen otra vez: son el criterio de
  aceptación de esos casos de prueba.
*/

export const HYDROLOGY_BANNER = {
  'no-consultado': SOURCE_DOWN_MESSAGES.hidrologia,
  intersecta: '⚠️ Hay un curso/cuerpo de agua de OSM que intersecta el polígono.',
  'sin-elementos': 'No se encontró hidrología mapeada en OSM cerca del polígono.',
} as const;

export function hydrologyNearbyText(found: number, distanceM: number): string {
  return `No hay intersección, pero hay ${formatNumber(found, 0)} elemento(s) de hidrología a ${meters(
    distanceM,
  )}.`;
}

export const PROTECTED_BANNER = {
  'no-consultado': SOURCE_DOWN_MESSAGES['areas-protegidas'],
  intersecta: '⚠️ El polígono SÍ intersecta un área de la WDPA:',
  'sin-elementos': 'No se encontraron áreas protegidas (WDPA) cerca del polígono.',
} as const;

export function protectedNearbyText(found: number, distanceM: number): string {
  return `No hay intersección, pero hay ${formatNumber(found, 0)} área(s) WDPA a ${meters(
    distanceM,
  )} del polígono.`;
}

export type BannerCopy = { state: BranchState; tone: ConclusionTone; headline: string };

export function hydrologyBanner(summary: HydrologySummary): BannerCopy {
  const state = branchOf({
    available: summary.available,
    intersects: summary.intersects_aoi,
    found: summary.features_found,
  });

  switch (state) {
    case 'no-consultado':
      return { state, tone: 'danger', headline: HYDROLOGY_BANNER['no-consultado'] };
    case 'intersecta':
      return { state, tone: 'warning', headline: HYDROLOGY_BANNER.intersecta };
    case 'cerca':
      return {
        state,
        tone: 'info',
        headline: hydrologyNearbyText(summary.features_found, summary.nearest_distance_m ?? 0),
      };
    case 'sin-elementos':
      return { state, tone: 'success', headline: HYDROLOGY_BANNER['sin-elementos'] };
  }
}

export function protectedBanner(summary: ProtectedAreasSummary): BannerCopy {
  const state = branchOf({
    available: summary.available,
    intersects: summary.intersects_aoi,
    found: summary.areas_found,
  });

  switch (state) {
    case 'no-consultado':
      return { state, tone: 'danger', headline: PROTECTED_BANNER['no-consultado'] };
    case 'intersecta':
      return { state, tone: 'warning', headline: PROTECTED_BANNER.intersecta };
    case 'cerca':
      return {
        state,
        tone: 'info',
        headline: protectedNearbyText(summary.areas_found, summary.nearest_distance_m ?? 0),
      };
    case 'sin-elementos':
      return { state, tone: 'success', headline: PROTECTED_BANNER['sin-elementos'] };
  }
}

export const SLOPE_LABELS = {
  plano: 'Plano (0-5%)',
  suave: 'Suave (5-15%)',
  moderado: 'Moderado (15-30%)',
  fuerte: 'Fuerte (>30%)',
} as const;

export function topographyConclusions(topography: TopographyResult): Conclusion[] {
  if (!topography.available || topography.summary == null) {
    return [
      {
        id: 'topografia-sin-datos',
        tone: 'danger',
        text:
          nonEmpty(topography.error) ??
          'No se pudo calcular la topografía: el servicio de elevación no respondió. Esto no dice nada sobre el relieve del terreno, sólo que no se pudo medir en esta corrida.',
      },
    ];
  }

  const summary = topography.summary;
  const classes = summary.slope_class_pct;
  const gentle = sumOf(classes, [SLOPE_LABELS.plano, SLOPE_LABELS.suave]);
  const steep = classes[SLOPE_LABELS.fuerte] ?? 0;
  const dominant = dominantEntry(classes);

  const out: Conclusion[] = [
    {
      id: 'topografia-relieve',
      tone: 'neutral',
      text: `El terreno va de ${formatNumber(summary.elevation_min_m, 0)} a ${formatNumber(
        summary.elevation_max_m,
        0,
      )} metros sobre el nivel del mar: un desnivel de ${formatNumber(
        summary.elevation_range_m,
        0,
      )} m dentro del polígono, con una altura promedio de ${formatNumber(
        summary.elevation_mean_m,
        0,
      )} m.`,
    },
  ];

  if (steep >= 30) {
    out.push({
      id: 'topografia-pendiente',
      tone: 'warning',
      text: `${formatPercent(steep)} del polígono tiene pendientes mayores al 30 %. En esa parte del terreno cualquier obra implica movimiento de tierra, los accesos son más caros y la erosión superficial es un problema esperable.`,
    });
  } else if (gentle >= 70) {
    out.push({
      id: 'topografia-pendiente',
      tone: 'success',
      text: `${formatPercent(gentle)} del polígono tiene pendientes por debajo del 15 %, es decir, terreno llano o de pendiente suave. La topografía no es acá el factor que condiciona dónde se puede construir.`,
    });
  } else if (dominant !== null) {
    out.push({
      id: 'topografia-pendiente',
      tone: 'neutral',
      text: `La clase de pendiente predominante es «${dominant.label}», con ${formatPercent(
        dominant.pct,
      )} del área. El terreno es mixto: hay sectores llanos y sectores empinados dentro del mismo polígono.`,
    });
  }

  out.push({
    id: 'topografia-media',
    tone: 'neutral',
    text: `La pendiente media es de ${formatPercent(
      summary.slope_mean_pct,
    )} y el máximo puntual llega a ${formatPercent(
      summary.slope_max_pct,
    )}. La pendiente está expresada en PORCENTAJE (metros que sube por cada 100 metros que avanza), no en grados.`,
  });

  return out;
}

export const NDVI_LABELS = {
  sinVegetacion: 'Sin vegetación / suelo desnudo o agua',
  dispersa: 'Vegetación dispersa / matorral bajo',
  densa: 'Vegetación densa / bosque secundario',
  muyDensa: 'Vegetación muy densa / dosel maduro',
} as const;

export function vegetationConclusions(vegetation: VegetationResult): Conclusion[] {
  const out: Conclusion[] = [];
  const summary = vegetation.summary;

  if (!vegetation.ndvi_available) {
    out.push({
      id: 'vegetacion-ndvi-sin-datos',
      tone: 'danger',
      text:
        nonEmpty(vegetation.ndvi_error) ??
        'No se pudo calcular el NDVI: no hubo escenas Sentinel-2 utilizables (menos de 30 % de nubes) en los últimos 180 días. No significa que no haya vegetación: significa que no se pudo medir.',
    });
  } else if (summary != null) {
    const density = summary.ndvi_density_class_pct;
    const dominant = dominantEntry(density);
    const canopy = sumOf(density, [NDVI_LABELS.densa, NDVI_LABELS.muyDensa]);
    const bare = density?.[NDVI_LABELS.sinVegetacion] ?? 0;

    if (dominant !== null) {
      out.push({
        id: 'vegetacion-dominante',
        tone: 'neutral',
        text: `La clase de vegetación predominante es «${dominant.label}», con ${formatPercent(
          dominant.pct,
        )} del polígono. La clasificación sale del NDVI, un índice que compara la luz roja e infrarroja que refleja el suelo: cuanto más alto, más hoja verde activa.`,
      });
    }

    if (canopy >= 60) {
      out.push({
        id: 'vegetacion-dosel',
        tone: 'success',
        text: `${formatPercent(
          canopy,
        )} del polígono tiene vegetación densa o muy densa. Es un dosel continuo: intervenirlo implica remover cobertura arbórea existente, no ocupar terreno abierto.`,
      });
    } else if (bare >= 50) {
      out.push({
        id: 'vegetacion-dosel',
        tone: 'neutral',
        text: `${formatPercent(
          bare,
        )} del polígono aparece sin vegetación: suelo desnudo, superficie construida o agua. Es un terreno mayormente abierto en la fecha de las imágenes usadas.`,
      });
    }

    const ndviMean = summary.ndvi_mean;
    const ndviMedian = summary.ndvi_median;
    if (ndviMean != null && ndviMedian != null) {
      out.push({
        id: 'vegetacion-ndvi',
        tone: 'neutral',
        text: `El NDVI mediano del polígono es ${formatNumber(
          ndviMedian,
          2,
        )} y el promedio ${formatNumber(
          ndviMean,
          2,
        )} (la escala va de -1 a 1). Es la mediana de las 6 escenas menos nubladas de los últimos 180 días, no una foto de un día puntual.`,
      });
    }
  }

  if (!vegetation.worldcover_available) {
    out.push({
      id: 'vegetacion-worldcover-sin-datos',
      tone: 'danger',
      text:
        nonEmpty(vegetation.worldcover_error) ??
        'No se pudo consultar la cobertura de suelo (ESA WorldCover) en esta corrida.',
    });
  } else if (summary != null) {
    const tree = summary.worldcover_tree_cover_pct;
    const cover = dominantEntry(summary.worldcover_landcover_pct);

    if (cover !== null) {
      out.push({
        id: 'vegetacion-cobertura',
        tone: 'neutral',
        text: `Según ESA WorldCover 2021, la cobertura de suelo dominante es «${
          cover.label
        }» (${formatPercent(cover.pct)} del polígono).`,
      });
    }
    if (tree != null) {
      out.push({
        id: 'vegetacion-arborea',
        tone: tree >= 50 ? 'success' : 'neutral',
        text: `La cobertura arbórea ocupa ${formatPercent(
          tree,
        )} del polígono. Es la clase «Bosque / cobertura arbórea» de WorldCover, medida a 10 m en 2021, así que puede no reflejar cambios posteriores.`,
      });
    }
  }

  return out;
}

export function hydrologyConclusions(summary: HydrologySummary): Conclusion[] {
  const banner = hydrologyBanner(summary);
  const out: Conclusion[] = [];

  switch (banner.state) {
    case 'no-consultado':
      out.push({
        id: 'hidrologia-caida',
        tone: 'danger',
        text: 'La consulta a OpenStreetMap (Overpass) no respondió, así que este reporte no puede decir si hay o no cursos de agua cerca del polígono. Es una falta de dato, no una ausencia de agua: el resto del análisis sí se completó.',
      });
      break;

    case 'intersecta': {
      const nearest = summary.features.at(0);
      const named = nonEmpty(nearest?.name ?? null);
      out.push({
        id: 'hidrologia-intersecta',
        tone: 'warning',
        text: `Al menos un curso o cuerpo de agua mapeado en OpenStreetMap cruza el polígono${
          named === null ? '' : ` (el más cercano es «${named}»)`
        }. En total se encontraron ${formatNumber(
          summary.features_found,
          0,
        )} elementos de agua dentro de los 500 m alrededor del área de estudio.`,
      });
      out.push({
        id: 'hidrologia-intersecta-nota',
        tone: 'neutral',
        text: 'Este reporte describe lo que está mapeado en OSM; no determina la franja de protección de ribera ni sustituye un levantamiento hidrológico.',
      });
      break;
    }

    case 'cerca':
      out.push({
        id: 'hidrologia-cerca',
        tone: 'info',
        text: `Ningún elemento de agua cruza el polígono, pero el más cercano está a ${meters(
          summary.nearest_distance_m ?? 0,
        )} del borde. Se encontraron ${formatNumber(
          summary.features_found,
          0,
        )} elementos dentro de los 500 m consultados.`,
      });
      break;

    case 'sin-elementos':
      out.push({
        id: 'hidrologia-vacio',
        tone: 'success',
        text: 'Overpass respondió correctamente y no hay hidrología mapeada en OpenStreetMap dentro de los 500 m alrededor del polígono.',
      });
      break;
  }

  if (banner.state !== 'no-consultado') {
    out.push({
      id: 'hidrologia-caveat',
      tone: 'neutral',
      text: 'OpenStreetMap es colaborativo y su completitud varía por zona: que un cauce no aparezca en el mapa no prueba que no exista en el terreno. Para un proyecto que lo amerite, cruzar con INDRHI o Medio Ambiente.',
    });
  }

  return out;
}

export function protectedConclusions(
  summary: ProtectedAreasSummary,
  areaHa: number,
): Conclusion[] {
  const banner = protectedBanner(summary);
  const out: Conclusion[] = [];

  switch (banner.state) {
    case 'no-consultado':
      out.push({
        id: 'ap-caida',
        tone: 'danger',
        text: 'El servicio de la WDPA (UNEP-WCMC) no respondió, así que este reporte no puede afirmar ni descartar que el polígono toque un área protegida. Es una falta de dato, no una ausencia de áreas protegidas.',
      });
      break;

    case 'intersecta': {
      const overlapping = summary.areas.filter((area) => area.overlap_ha > 0);
      const names = overlapping
        .map((area) => nonEmpty(area.name) ?? 'área sin nombre en la base')
        .slice(0, 3);
      const pct =
        summary.overlap_pct_of_aoi > 0
          ? summary.overlap_pct_of_aoi
          : areaHa > 0
            ? (summary.overlap_ha / areaHa) * 100
            : 0;

      out.push({
        id: 'ap-intersecta',
        tone: 'warning',
        text: `El polígono se solapa con ${formatNumber(
          Math.max(overlapping.length, 1),
          0,
        )} área(s) protegida(s) registrada(s) en la WDPA${
          names.length === 0 ? '' : `: ${names.join(', ')}`
        }. El solape es de ${formatHectares(summary.overlap_ha)}, es decir ${formatPercent(
          pct,
        )} del área de estudio.`,
      });
      out.push({
        id: 'ap-intersecta-nota',
        tone: 'neutral',
        text: 'La WDPA es un inventario global compilado por UNEP-WCMC: sus límites son referenciales. Este reporte describe el solape con esa capa; no sustituye la delimitación oficial ni determina qué régimen legal aplica al terreno.',
      });
      break;
    }

    case 'cerca':
      out.push({
        id: 'ap-cerca',
        tone: 'info',
        text: `El polígono no toca ninguna área protegida de la WDPA, pero hay ${formatNumber(
          summary.areas_found,
          0,
        )} a ${meters(
          summary.nearest_distance_m ?? 0,
        )} del borde, dentro del kilómetro consultado alrededor del área de estudio.`,
      });
      break;

    case 'sin-elementos':
      out.push({
        id: 'ap-vacio',
        tone: 'success',
        text: 'La consulta a la WDPA se completó y no hay áreas protegidas registradas dentro del kilómetro alrededor del polígono.',
      });
      break;
  }

  return out;
}

export const MEPYD_HAZARD_GROUP = 'Amenazas';

export type MepydGroupTally = { group: string; layers: { label: string; count: number }[] };

export function tallyMepyd(summary: TerritorioAnalysisSummary['mepyd_rd']['summary']): MepydGroupTally[] {
  return Object.entries(summary).map(([group, layers]) => ({
    group,
    layers: Object.entries(layers).map(([label, entry]) => ({ label, count: entry.count })),
  }));
}

/**
 * `geometries_omitted` sólo existe en el análisis COMPLETO: el resumen no lleva
 * geometrías, así que tampoco lleva la bandera de que se descartaron. Se acepta
 * opcional para que las dos formas del resultado entren por la misma puerta.
 */
export function mepydConclusions(
  mepyd: TerritorioAnalysisSummary['mepyd_rd'] & { geometries_omitted?: boolean },
): Conclusion[] {
  if (!mepyd.in_rd) {
    return [
      {
        id: 'mepyd-fuera',
        tone: 'neutral',
        text: 'Contexto RD no aplica: el AOI está fuera de República Dominicana.',
      },
    ];
  }

  const tally = tallyMepyd(mepyd.summary);
  const layersWithData = tally.flatMap((entry) => entry.layers);
  const totalFeatures = layersWithData.reduce((sum, layer) => sum + layer.count, 0);
  const out: Conclusion[] = [];

  if (layersWithData.length === 0) {
    out.push({
      id: 'mepyd-vacio',
      tone: mepyd.failures.length > 0 ? 'danger' : 'success',
      text:
        mepyd.failures.length > 0
          ? 'Ninguna capa del MEPyD devolvió datos y varias no respondieron: este bloque no describe el contexto de riesgo del polígono, sólo la falta de respuesta de los servicios.'
          : 'Sin resultados (servicios sin respuesta o sin elementos cerca del AOI).',
    });
  } else {
    out.push({
      id: 'mepyd-resumen',
      tone: 'neutral',
      text: `${formatNumber(layersWithData.length, 0)} capa(s) del Explorador de Riesgo del MEPyD devolvieron elementos dentro de los 500 m alrededor del polígono, con ${formatNumber(
        totalFeatures,
        0,
      )} elementos en total, repartidos en ${formatNumber(tally.length, 0)} grupo(s) temáticos.`,
    });

    const hazards = tally.find((entry) => entry.group === MEPYD_HAZARD_GROUP);
    if (hazards !== undefined && hazards.layers.length > 0) {
      out.push({
        id: 'mepyd-amenazas',
        tone: 'warning',
        text: `En el grupo «${MEPYD_HAZARD_GROUP}» el polígono cae dentro del alcance de: ${hazards.layers
          .map((layer) => layer.label)
          .join(', ')}. Son capas de zonificación a escala nacional: indican que el área figura en esa cartografía, no el nivel de riesgo de un lote en particular.`,
      });
    }
  }

  if (mepyd.failures.length > 0) {
    out.push({
      id: 'mepyd-fallas',
      tone: 'danger',
      text: `${formatNumber(
        mepyd.failures.length,
        0,
      )} capa(s) del MEPyD no respondieron y quedan fuera de este reporte: ${mepyd.failures
        .map((failure) => failure.label)
        .join(', ')}. El legacy las descartaba en silencio; acá se listan porque su ausencia no es un "no hay nada".`,
    });
  }

  if (mepyd.geometries_omitted === true) {
    out.push({
      id: 'mepyd-geometrias',
      tone: 'neutral',
      text: 'Las geometrías del MEPyD no se guardaron con el resultado por su tamaño: los conteos y atributos de abajo son completos, pero el mapa las vuelve a pedir al servicio.',
    });
  }

  return out;
}

/*
  El reporte Markdown del legacy NO incluía la inundación costera aunque el
  usuario la hubiera explorado: vivía sólo en `session_state["coastal_cache"]`
  (inventario §9, "rarezas adicionales"). Era un hueco de contenido real. Acá se
  incluye siempre que la corrida la tenga adjunta.
*/

export function coastalHeading(preset: CoastalPreset): string {
  return `Riesgo costero — ${preset}`;
}

export function coastalConclusions(coastal: CoastalRun): Conclusion[] {
  if (!coastal.available || coastal.summary == null) {
    return [
      {
        id: 'costera-caida',
        tone: 'danger',
        text:
          nonEmpty(coastal.error) ??
          'No se pudo consultar la inundación costera de WRI Aqueduct para este escenario.',
      },
    ];
  }

  const summary = coastal.summary;
  const resolution = summary.resolution_m_approx ?? 927;

  if (!summary.has_data) {
    return [
      {
        id: 'costera-sin-cobertura',
        tone: 'warning',
        text: 'No hay cobertura de datos de Aqueduct para esta zona.',
      },
      {
        id: 'costera-sin-cobertura-nota',
        tone: 'neutral',
        text: 'Aqueduct modela inundación costera: un polígono tierra adentro queda fuera de su dominio, y eso no dice nada sobre inundación fluvial o pluvial.',
      },
    ];
  }

  const pct = summary.pct_area_flooded ?? 0;

  if (pct <= 0) {
    return [
      {
        id: 'costera-sin-inundacion',
        tone: 'success',
        text: `Sin inundación proyectada en el AOI para «${coastal.preset}» (resolución ~${formatNumber(
          resolution,
          0,
        )} m).`,
      },
      {
        id: 'costera-sin-inundacion-nota',
        tone: 'neutral',
        text: 'A ~927 m por píxel, Aqueduct es una herramienta de tamizaje: sirve para descartar exposición evidente, no para afirmar que una parcela concreta no se inunda.',
      },
    ];
  }

  const maxDepth = summary.max_depth_m ?? 0;
  const meanDepth = summary.mean_depth_where_flooded_m;

  return [
    {
      id: 'costera-inundacion',
      tone: 'warning',
      text: `El escenario «${coastal.preset}» proyecta inundación sobre ${formatPercent(
        pct,
      )} del polígono, con una profundidad máxima de ${formatNumber(
        maxDepth,
        1,
      )} m${
        meanDepth == null ? '' : ` y ${formatNumber(meanDepth, 1)} m de profundidad media donde se inunda`
      } (resolución ~${formatNumber(resolution, 0)} m).`,
    },
    {
      id: 'costera-inundacion-nota',
      tone: 'neutral',
      text: 'Aqueduct v2 es un producto de tamizaje global a ~927 m con metodología de 2020 basada en escenarios RCP, con proyecciones hasta 2080. Describe exposición potencial a escala regional; no reemplaza un estudio hidrodinámico local.',
    },
  ];
}

export type ExecutiveLine = { id: string; label: string; value: string; note?: string };

/**
 * Las cinco/seis líneas de la portada: UN número por tema.
 *
 * Cuando una fuente no respondió, la línea dice "no se pudo consultar" — nunca
 * un guion mudo que se confunda con un cero.
 */
export function executiveSummary(analysis: TerritorioAnalysisSummary): ExecutiveLine[] {
  const lines: ExecutiveLine[] = [];

  const topography = analysis.topography.summary;
  lines.push({
    id: 'elevacion',
    label: 'Rango de elevación',
    value:
      analysis.topography.available && topography != null
        ? `${formatNumber(topography.elevation_min_m, 0)}–${formatNumber(
            topography.elevation_max_m,
            0,
          )} m`
        : 'No se pudo consultar',
    note:
      analysis.topography.available && topography != null
        ? `Pendiente media ${formatPercent(topography.slope_mean_pct)}`
        : 'Servicio de elevación sin respuesta',
  });

  const vegetation = analysis.vegetation.summary;
  const density = dominantEntry(vegetation?.ndvi_density_class_pct);
  lines.push({
    id: 'vegetacion',
    label: 'Clase de vegetación dominante',
    value:
      analysis.vegetation.ndvi_available && density !== null
        ? density.label
        : 'No se pudo consultar',
    note:
      analysis.vegetation.ndvi_available && density !== null
        ? `${formatPercent(density.pct)} del polígono`
        : 'Sin escenas Sentinel-2 utilizables en la ventana consultada',
  });

  const cover = dominantEntry(vegetation?.worldcover_landcover_pct);
  lines.push({
    id: 'cobertura',
    label: 'Cobertura de suelo dominante',
    value: analysis.vegetation.worldcover_available && cover !== null ? cover.label : 'No se pudo consultar',
    note:
      analysis.vegetation.worldcover_available && cover !== null
        ? `${formatPercent(cover.pct)} · cobertura arbórea ${
            vegetation?.worldcover_tree_cover_pct == null
              ? '—'
              : formatPercent(vegetation.worldcover_tree_cover_pct)
          }`
        : 'ESA WorldCover sin respuesta',
  });

  const hydrology = analysis.hydrology.summary;
  lines.push({
    id: 'hidrologia',
    label: 'Agua más cercana',
    value: !hydrology.available
      ? 'No se pudo consultar'
      : hydrology.intersects_aoi
        ? 'Intersecta el polígono'
        : hydrology.features_found > 0
          ? meters(hydrology.nearest_distance_m ?? 0)
          : 'Sin elementos en 500 m',
    note: hydrology.available
      ? `${formatNumber(hydrology.features_found, 0)} elemento(s) de OSM en 500 m`
      : 'Overpass sin respuesta',
  });

  const protectedAreas = analysis.protected_areas.summary;
  lines.push({
    id: 'areas-protegidas',
    label: 'Solape con área protegida',
    value: !protectedAreas.available
      ? 'No se pudo consultar'
      : protectedAreas.intersects_aoi
        ? formatPercent(protectedAreas.overlap_pct_of_aoi)
        : protectedAreas.areas_found > 0
          ? `0 % · la más cercana a ${meters(protectedAreas.nearest_distance_m ?? 0)}`
          : 'Sin áreas en 1 km',
    note: protectedAreas.available
      ? `${formatNumber(protectedAreas.areas_found, 0)} área(s) WDPA en 1 km`
      : 'WDPA sin respuesta',
  });

  if (analysis.coastal != null) {
    const coastal = analysis.coastal;
    lines.push({
      id: 'costera',
      label: 'Inundación costera proyectada',
      value:
        !coastal.available || coastal.summary == null
          ? 'No se pudo consultar'
          : !coastal.summary.has_data
            ? 'Fuera de la cobertura de Aqueduct'
            : formatPercent(coastal.summary.pct_area_flooded ?? 0),
      note: coastal.preset,
    });
  }

  return lines;
}

/**
 * La frase que reemplaza al gráfico para quien no lo ve.
 *
 * El brief la pide como CAMPO DE AUTORÍA normal, no como agregado de
 * accesibilidad: es a la vez el `sr-only`, la nota al pie de 12px y la línea
 * que va al Markdown/PDF exportado. Por eso se genera acá y no en el componente.
 */
export function chartTextEquivalent(
  title: string,
  rows: readonly { label: string; pct: number }[],
): string {
  if (rows.length === 0) return `${title}: sin clases con datos.`;
  const parts = rows.map((row) => `${row.label}, ${formatPercent(row.pct)}`);
  return `${title}: ${parts.join('; ')}.`;
}
