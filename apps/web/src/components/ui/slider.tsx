import { Button } from './button';

import type { ChangeEvent } from 'react';

import { cn } from '~/lib/cn';
import { formatOpacity } from '~/lib/format';

export type SliderProps = {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** En pantallas táctiles el arrastre sobre 4px es impreciso (§9). */
  withStepper?: boolean;
  format?: (value: number) => string;
  onChange: (value: number) => void;
};

export function Slider({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.05,
  disabled = false,
  withStepper = false,
  format = formatOpacity,
  onChange,
}: SliderProps) {
  const clamp = (next: number) => Math.min(max, Math.max(min, Number(next.toFixed(4))));

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(clamp(Number(event.target.value)));
  };

  return (
    <div className="flex h-8 items-center gap-2">
      {withStepper ? (
        <Button
          size="sm"
          variant="secondary"
          aria-label={`Bajar ${label}`}
          disabled={disabled || value <= min}
          onClick={() => {
            onChange(clamp(value - step));
          }}
          className="h-7 w-9 px-0"
        >
          −
        </Button>
      ) : null}

      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={handleChange}
        className={cn(
          'bg-surface-3 accent-accent h-1 flex-1 cursor-pointer appearance-none rounded-full',
          disabled ? 'cursor-not-allowed opacity-55' : null,
        )}
      />

      {withStepper ? (
        <Button
          size="sm"
          variant="secondary"
          aria-label={`Subir ${label}`}
          disabled={disabled || value >= max}
          onClick={() => {
            onChange(clamp(value + step));
          }}
          className="h-7 w-9 px-0"
        >
          +
        </Button>
      ) : null}

      <span className="tabular text-11 text-fg-muted w-11 shrink-0 text-right">
        {format(value)}
      </span>
    </div>
  );
}
