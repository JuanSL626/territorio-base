import type { LegendClass } from '~/layers/types';

import { formatPercent } from '~/lib/format';

/**
 * Los TRES gráficos que tenía el legacy: clases de pendiente, densidad NDVI y
 * distribución WorldCover. Un solo componente, porque los tres son la misma
 * figura: barras horizontales de porcentajes con las etiquetas exactas del
 * motor y los colores exactos del registro.
 *
 * Accesibilidad, como campo de autoría y no como parche (§6.4): la barra es
 * decoración (`aria-hidden`), la etiqueta y el valor son texto real en el
 * DOM, así que el gráfico se lee entero sin verlo. Cada figura lleva su
 * `textEquivalent` — la misma frase que se anuncia en el `figcaption`, que
 * la tarjeta muestra como nota al pie de 12px, y que se reusa tal cual en el
 * Markdown/PDF exportado. Una sola frase, tres destinos: por eso la escribe
 * `narrative.ts` y no el componente, y por eso la pinta la TARJETA y no el
 * gráfico — si la pintaran los dos, saldría duplicada bajo cada barra.
 *
 * Las barras se escalan a 100 %, no al máximo de la serie: un 8 % tiene que
 * verse como un 8 %, aunque sea el mayor de su gráfico.
 */

export type DistributionRow = {
  label: string;
  pct: number;
  color: string;
};

export function rowsFromClasses(
  values: Record<string, number> | null | undefined,
  classes: readonly LegendClass[],
  options: { sparse: boolean },
): DistributionRow[] {
  if (values == null) return [];
  const colorOf = new Map(classes.map((item) => [item.label, item.color]));
  const rows: DistributionRow[] = [];

  for (const [label, pct] of Object.entries(values)) {
    if (!Number.isFinite(pct)) continue;
    // WorldCover es DISPERSO: las clases ausentes no llegan, y las que llegan
    // en 0 tampoco se dibujan (TC-33).
    if (options.sparse && pct <= 0) continue;
    rows.push({ label, pct, color: colorOf.get(label) ?? 'var(--border-strong)' });
  }

  return rows;
}

export type DistributionChartProps = {
  rows: readonly DistributionRow[];
  textEquivalent: string;
  emptyText: string;
};

export function DistributionChart({ rows, textEquivalent, emptyText }: DistributionChartProps) {
  if (rows.length === 0) {
    return <p className="text-12 text-fg-muted">{emptyText}</p>;
  }

  return (
    <figure className="m-0">
      <figcaption className="sr-only">{textEquivalent}</figcaption>

      <ul className="flex flex-col">
        {rows.map((row) => (
          <li key={row.label} className="flex h-7 items-center gap-2">
            <span
              aria-hidden="true"
              className="border-border-base h-3.5 w-3.5 shrink-0 rounded-[2px] border"
              style={{ backgroundColor: row.color }}
            />
            <span className="relative min-w-0 flex-1">
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 rounded-[2px]"
                style={{
                  width: `${String(Math.max(0, Math.min(100, row.pct)))}%`,
                  backgroundColor: row.color,
                  opacity: 0.35,
                }}
              />
              <span className="text-12 text-fg relative block truncate py-1 pl-1">{row.label}</span>
            </span>
            <span className="tabular text-12 text-fg w-16 shrink-0 text-right font-medium">
              {formatPercent(row.pct)}
            </span>
          </li>
        ))}
      </ul>

    </figure>
  );
}

export type StatRow = { label: string; value: string };

export function StatList({ stats }: { stats: readonly StatRow[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
      {stats.map((stat) => (
        <div key={stat.label} className="flex items-baseline justify-between gap-2">
          <dt className="text-12 text-fg-muted truncate">{stat.label}</dt>
          <dd className="tabular text-13 text-fg shrink-0 font-semibold">{stat.value}</dd>
        </div>
      ))}
    </dl>
  );
}
