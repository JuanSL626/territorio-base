import type { KeyboardEvent } from 'react';

import { cn } from '~/lib/cn';

export type SegmentedOption<TId extends string> = {
  id: TId;
  label: string;
  hint?: string;
};

export type SegmentedControlProps<TId extends string> = {
  options: readonly SegmentedOption<TId>[];
  value: TId;
  onChange: (id: TId) => void;
  ariaLabel: string;
  className?: string;
};

/** Control segmentado de VISTAS (§2): 5 ítems, 32px de alto, etiqueta de 12px. */
export function SegmentedControl<TId extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: SegmentedControlProps<TId>) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const index = options.findIndex((option) => option.id === value);
    if (index < 0) return;
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const next = options[(index + delta + options.length) % options.length];
    if (next) {
      event.preventDefault();
      onChange(next.id);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={cn(
        'rounded-btn border-border-base bg-surface-2 inline-flex h-8 items-center gap-0.5 border p-0.5',
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            title={option.hint}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              onChange(option.id);
            }}
            className={cn(
              'text-12 h-7 rounded-[5px] px-2.5 font-medium whitespace-nowrap transition-colors',
              selected
                ? 'bg-surface text-fg shadow-[0_1px_2px_rgb(16_24_40/0.08)]'
                : 'text-fg-muted hover:text-fg',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
