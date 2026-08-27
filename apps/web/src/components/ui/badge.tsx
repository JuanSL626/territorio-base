import type { ReactNode } from 'react';

import { cn } from '~/lib/cn';

export type BadgeTone = 'accent' | 'neutral' | 'danger' | 'warning' | 'success' | 'info';

const TONES: Record<BadgeTone, string> = {
  accent: 'bg-accent text-accent-fg',
  neutral: 'bg-surface-3 text-fg-muted',
  danger: 'bg-danger-soft text-danger',
  warning: 'bg-warning-soft text-warning',
  success: 'bg-success-soft text-success',
  info: 'bg-info-soft text-info',
};

/** Pastilla de conteo del §4.2: 18px, sólo se dibuja si hay algo que contar. */
export function CountBadge({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null;
  return (
    <span
      className="tabular bg-accent text-11 text-accent-fg inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 font-medium"
      aria-label={`${String(count)} ${label}`}
    >
      {count}
    </span>
  );
}

export function Badge({
  tone = 'neutral',
  icon,
  children,
  className,
}: {
  tone?: BadgeTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'rounded-chip text-11 inline-flex items-center gap-1 px-1.5 py-0.5 font-medium',
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
