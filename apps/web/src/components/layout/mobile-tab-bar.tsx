import { ChartIcon, LayersIcon, MapIcon, ReportIcon } from '~/components/ui/icons';
import { cn } from '~/lib/cn';

export type MobileTab = 'capas' | 'analisis' | 'mapa' | 'reporte';

export type MobileTabBarProps = {
  value: MobileTab;
  onChange: (tab: MobileTab) => void;
  reportDisabled: boolean;
};

const ITEMS = [
  { id: 'capas', label: 'Capas' },
  { id: 'analisis', label: 'Análisis' },
  { id: 'mapa', label: 'Mapa' },
  { id: 'reporte', label: 'Reporte' },
] as const;

function TabIcon({ id }: { id: MobileTab }) {
  switch (id) {
    case 'capas':
      return <LayersIcon size={18} />;
    case 'analisis':
      return <ChartIcon size={18} />;
    case 'mapa':
      return <MapIcon size={18} />;
    case 'reporte':
      return <ReportIcon size={18} />;
  }
}

/** Barra inferior de 56px del layout móvil (§9). Objetivos táctiles ≥44px. */
export function MobileTabBar({ value, onChange, reportDisabled }: MobileTabBarProps) {
  return (
    <nav
      aria-label="Secciones"
      className="border-border-base bg-surface flex h-14 shrink-0 items-stretch border-t"
    >
      {ITEMS.map((item) => {
        const selected = item.id === value;
        const disabled = item.id === 'reporte' && reportDisabled;
        return (
          <button
            key={item.id}
            type="button"
            aria-current={selected ? 'page' : undefined}
            disabled={disabled}
            onClick={() => {
              onChange(item.id);
            }}
            className={cn(
              'text-11 flex flex-1 flex-col items-center justify-center gap-0.5 font-medium',
              selected ? 'text-accent' : 'text-fg-muted',
              disabled ? 'opacity-45' : null,
            )}
          >
            <TabIcon id={item.id} />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
