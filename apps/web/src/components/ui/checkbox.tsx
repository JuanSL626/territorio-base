import { CheckIcon } from './icons';

import type { InputHTMLAttributes, ReactNode } from 'react';

import { cn } from '~/lib/cn';

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> & {
  label: ReactNode;
  /** Se pinta bajo la etiqueta; usado por el chip de razón de una capa apagada. */
  description?: ReactNode;
  labelClassName?: string;
};

/**
 * Checkbox nativo (accesible por teclado sin esfuerzo) con el cuadro real
 * ocultado visualmente y un cuadro pintado con `peer`.
 */
export function Checkbox({
  label,
  description,
  className,
  labelClassName,
  disabled,
  ...props
}: CheckboxProps) {
  return (
    <label
      className={cn(
        'group flex min-w-0 cursor-pointer items-start gap-2',
        disabled === true ? 'cursor-not-allowed opacity-55' : null,
        className,
      )}
    >
      <span className="relative mt-px flex h-4 w-4 shrink-0 items-center justify-center">
        <input
          type="checkbox"
          disabled={disabled}
          className="peer absolute inset-0 h-4 w-4 cursor-[inherit] opacity-0"
          {...props}
        />
        <span
          aria-hidden="true"
          className={cn(
            'rounded-chip border-border-strong bg-surface flex h-4 w-4 items-center justify-center border',
            'peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-fg',
            'peer-focus-visible:outline-ring peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2',
            'text-transparent transition-colors',
          )}
        >
          <CheckIcon size={12} />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('text-13 text-fg block truncate', labelClassName)}>{label}</span>
        {description != null ? (
          <span className="text-11 text-fg-muted mt-0.5 block">{description}</span>
        ) : null}
      </span>
    </label>
  );
}
