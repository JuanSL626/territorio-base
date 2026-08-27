/*
  Qué leyenda le corresponde a una capa VISIBLE, dado lo que el AOI tiene de
  verdad adentro. Módulo PURO.

  Dos reglas del inventario §4 que sólo se pueden cumplir en tiempo de
  ejecución, y por eso viven acá y no en el registro:

    · **Sólo clases presentes.** La leyenda de WorldCover es DISPERSA: el motor
      omite las clases con 0 % (`worldcover_landcover_pct`), y la leyenda tiene
      que omitirlas también. Lo mismo hidrología: se listan sólo los tipos
      (`waterway` / `water_body` / `wetland`) que el AOI realmente trajo.
    · **Rampas con los extremos reales.** `dem` usa el mínimo y el máximo del
      AOI y `slope` el percentil 98 (recorta outliers). Esos números los
      calcula el servicio y llegan en el sidecar del overlay (`vmin`/`vmax`),
      no en el registro.

  Cuando todavía no se sabe nada (`undefined`), se muestra la leyenda completa:
  una leyenda de más es un detalle, una leyenda vacía sobre un mapa pintado es
  un bug visible.
*/

import type { LayerDef, LegendClass } from '~/layers/types';

import { formatNumber } from '~/lib/format';

export type LayerLegendData = {
  /**
   * Etiquetas de clase presentes en el AOI. `undefined` = todavía no se sabe.
   * Un array VACÍO sí significa "el AOI no tiene ninguna": la capa no aporta
   * leyenda y se omite (§12.12, no renderizar categorías vacías).
   */
  presentLabels?: readonly string[];
  /** Extremos reales de la rampa, del sidecar del overlay. */
  domain?: { min: number; max: number };
};

export type LegendPresence = Readonly<Record<string, LayerLegendData>>;

export type ResolvedLegend =
  | { kind: 'classes'; classes: LegendClass[] }
  | { kind: 'ramp'; colors: string[]; minLabel: string; maxLabel: string }
  | { kind: 'swatch'; color: string; label: string };

function rampLabel(value: number, unit: string, decimals: number): string {
  const number = formatNumber(value, decimals);
  return unit.length === 0 ? number : `${number} ${unit}`;
}

/** `null` = esta capa no aporta nada a la leyenda y no se dibuja su bloque. */
export function resolveLegend(
  layer: LayerDef,
  data: LayerLegendData | undefined,
): ResolvedLegend | null {
  const legend = layer.legend;

  switch (legend.type) {
    case 'classes': {
      const present = data?.presentLabels;
      const classes =
        legend.sparse && present !== undefined
          ? legend.classes.filter((item) => present.includes(item.label))
          : legend.classes;
      return classes.length === 0 ? null : { kind: 'classes', classes };
    }

    case 'ramp': {
      const domain =
        data?.domain ??
        (legend.domain === 'dynamic' || legend.domain === 'p98' ? undefined : legend.domain);

      if (domain === undefined) {
        // Sin extremos todavía: se dibuja la rampa con rótulos honestos en vez
        // de inventar números (la inconsistencia de `vmax` del inventario §9
        // nació justo de rotular con un número distinto del que se pintó).
        return {
          kind: 'ramp',
          colors: legend.colors,
          minLabel: 'mín.',
          maxLabel: legend.domain === 'p98' ? 'percentil 98' : 'máx.',
        };
      }

      return {
        kind: 'ramp',
        colors: legend.colors,
        minLabel: rampLabel(domain.min, legend.unit, legend.decimals),
        maxLabel: rampLabel(domain.max, legend.unit, legend.decimals),
      };
    }

    case 'swatch':
      // El límite del AOI y las ~35 capas MEPyD: el panel de capas ES su clave
      // (inventario §4, "sin leyenda propia"). Se muestran igual acá porque el
      // §5 de la tarea pide leyenda de TODA capa visible, pero como una sola
      // línea, no como un bloque de clases.
      return { kind: 'swatch', color: legend.color, label: legend.label };
  }
}

/** Equivalente de texto de la leyenda, para lectores de pantalla y el PDF. */
export function describeResolvedLegend(resolved: ResolvedLegend): string {
  switch (resolved.kind) {
    case 'classes':
      return resolved.classes.map((item) => item.label).join(', ');
    case 'ramp':
      return `Rampa continua de ${resolved.minLabel} a ${resolved.maxLabel}.`;
    case 'swatch':
      return resolved.label;
  }
}
