import type { ReactNode } from 'react';

import { IconButton } from '~/components/ui/button';
import { ChartIcon, ChevronLeft, ChevronRight, LayersIcon } from '~/components/ui/icons';
import { Tabs } from '~/components/ui/tabs';
import { cn } from '~/lib/cn';

export type LeftPanelTab = 'capas' | 'analisis';

export type LeftPanelProps = {
  tab: LeftPanelTab;
  onTabChange: (tab: LeftPanelTab) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** Se colapsó solo por abrir el inspector en 1280-1439: se restaura al cerrarlo. */
  autoCollapsed: boolean;
  capas: ReactNode;
  analisis: ReactNode;
  className?: string;
};

const TABS = [
  { id: 'capas', label: 'Capas' },
  { id: 'analisis', label: 'Análisis' },
] as const;

/**
 * Panel izquierdo del §2: 360px fijos, dos pestañas en UN solo slot (el patrón
 * de GFW: el mapa sigue siendo el elemento más grande, no hay segundo sidebar).
 * Colapsa a un riel de iconos de 48px.
 */
export function LeftPanel({
  tab,
  onTabChange,
  collapsed,
  onCollapsedChange,
  autoCollapsed,
  capas,
  analisis,
  className,
}: LeftPanelProps) {
  if (collapsed) {
    return (
      <nav
        aria-label="Panel de capas colapsado"
        className={cn(
          'border-border-base bg-surface flex w-12 shrink-0 flex-col items-center gap-1 border-r py-2',
          className,
        )}
      >
        <IconButton
          label={autoCollapsed ? 'Expandir panel (se colapsó solo)' : 'Expandir panel'}
          icon={<ChevronRight size={16} />}
          onClick={() => {
            onCollapsedChange(false);
          }}
        />
        <IconButton
          label="Capas"
          icon={<LayersIcon size={16} />}
          onClick={() => {
            onCollapsedChange(false);
            onTabChange('capas');
          }}
        />
        <IconButton
          label="Análisis"
          icon={<ChartIcon size={16} />}
          onClick={() => {
            onCollapsedChange(false);
            onTabChange('analisis');
          }}
        />
      </nav>
    );
  }

  return (
    <aside
      aria-label="Panel de capas y análisis"
      className={cn(
        'border-border-base bg-surface relative flex w-90 shrink-0 flex-col border-r',
        className,
      )}
    >
      <div className="flex items-center">
        <Tabs items={TABS} value={tab} onChange={onTabChange} ariaLabel="Panel izquierdo" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col">{tab === 'capas' ? capas : analisis}</div>

      <button
        type="button"
        aria-label="Colapsar panel"
        title="Colapsar panel"
        onClick={() => {
          onCollapsedChange(true);
        }}
        className="rounded-r-btn border-border-base bg-surface text-fg-muted hover:text-fg absolute top-1/2 -right-3 z-10 flex h-8 w-6 -translate-y-1/2 items-center justify-center border border-l-0"
      >
        <ChevronLeft size={14} />
      </button>
    </aside>
  );
}
