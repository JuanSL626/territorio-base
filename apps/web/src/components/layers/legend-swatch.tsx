import type { LegendSpec } from '~/layers/types';

export function LegendSwatch({ legend }: { legend: LegendSpec }) {
  switch (legend.type) {
    case 'ramp':
      return (
        <span
          aria-hidden="true"
          className="border-border-base block h-2 w-6 shrink-0 rounded-[2px] border"
          style={{ backgroundImage: `linear-gradient(to right, ${legend.colors.join(', ')})` }}
        />
      );

    case 'classes': {
      const colors = legend.classes.slice(0, 4).map((item) => item.color);
      return (
        <span
          aria-hidden="true"
          className="border-border-base flex h-3.5 w-3.5 shrink-0 flex-wrap overflow-hidden rounded-[2px] border"
        >
          {colors.map((color, index) => (
            <span
              key={`${color}-${String(index)}`}
              className="block h-1/2 w-1/2"
              style={{ backgroundColor: color }}
            />
          ))}
        </span>
      );
    }

    case 'swatch':
      return (
        <span
          aria-hidden="true"
          className="block h-3.5 w-3.5 shrink-0 rounded-[2px] border-2"
          style={{
            borderColor: legend.color,
            backgroundColor: legend.color,
            opacity: legend.fillFactor === 0 ? 0.35 : 1,
          }}
        />
      );
  }
}

export function LegendDetail({ legend }: { legend: LegendSpec }) {
  switch (legend.type) {
    case 'ramp':
      return (
        <div className="flex flex-col gap-1">
          <span
            aria-hidden="true"
            className="block h-2 w-full rounded-[2px]"
            style={{ backgroundImage: `linear-gradient(to right, ${legend.colors.join(', ')})` }}
          />
          <span className="text-11 text-fg-muted flex justify-between">
            <span>
              {legend.domain === 'dynamic' || legend.domain === 'p98'
                ? 'mín. del AOI'
                : `${String(legend.domain.min)} ${legend.unit}`}
            </span>
            <span>
              {legend.domain === 'dynamic'
                ? 'máx. del AOI'
                : legend.domain === 'p98'
                  ? 'percentil 98'
                  : `${String(legend.domain.max)} ${legend.unit}`}
            </span>
          </span>
        </div>
      );

    case 'classes':
      return (
        <ul className="flex flex-col gap-1">
          {legend.classes.map((item) => (
            <li key={item.label} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="border-border-base block h-3 w-3 shrink-0 rounded-[2px] border"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-11 text-fg-muted">{item.label}</span>
            </li>
          ))}
        </ul>
      );

    case 'swatch':
      return (
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="block h-3 w-3 shrink-0 rounded-[2px] border-2"
            style={{ borderColor: legend.color, backgroundColor: legend.color }}
          />
          <span className="text-11 text-fg-muted">{legend.label}</span>
        </div>
      );
  }
}
