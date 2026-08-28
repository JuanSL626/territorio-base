import type { SelectHTMLAttributes } from 'react';

import { cn } from '~/lib/cn';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, children, ...props }: SelectProps) {
  return (
    <select
      className={cn(
        'rounded-btn border-border-base bg-surface text-12 text-fg h-8 border px-2',
        'disabled:cursor-not-allowed disabled:opacity-55',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
