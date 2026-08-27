import { useId, type KeyboardEvent, type ReactNode } from 'react';

import { cn } from '~/lib/cn';

export type TabItem<TId extends string> = {
  id: TId;
  label: string;
  badge?: ReactNode;
};

export type TabsProps<TId extends string> = {
  items: readonly TabItem<TId>[];
  value: TId;
  onChange: (id: TId) => void;
  ariaLabel: string;
  /** 44px = las pestañas del panel izquierdo; 36px = las del inspector. */
  size?: 'panel' | 'inspector';
  className?: string;
};

export function Tabs<TId extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  size = 'panel',
  className,
}: TabsProps<TId>) {
  const baseId = useId();

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const index = items.findIndex((item) => item.id === value);
    if (index < 0) return;
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const next = items[(index + delta + items.length) % items.length];
    if (next) {
      event.preventDefault();
      onChange(next.id);
    }
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={cn(
        'border-border-base flex shrink-0 border-b',
        size === 'panel' ? 'h-11' : 'h-9',
        className,
      )}
    >
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`${baseId}-${item.id}-tab`}
            aria-selected={selected}
            aria-controls={`${baseId}-${item.id}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              onChange(item.id);
            }}
            className={cn(
              'relative flex flex-1 items-center justify-center gap-1.5 px-3 font-semibold transition-colors',
              size === 'panel' ? 'text-12 tracking-wide uppercase' : 'text-12',
              selected ? 'text-fg' : 'text-fg-muted hover:text-fg',
            )}
          >
            {item.label}
            {item.badge}
            <span
              aria-hidden="true"
              className={cn(
                'absolute inset-x-0 bottom-[-1px] h-0.5',
                selected ? 'bg-accent' : 'bg-transparent',
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  children,
  className,
  labelledBy,
}: {
  children: ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  return (
    <div role="tabpanel" aria-labelledby={labelledBy} tabIndex={0} className={className}>
      {children}
    </div>
  );
}
