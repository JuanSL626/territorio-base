import { cn } from '~/lib/cn';

export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('rounded-chip bg-surface-3 block animate-pulse', className)}
    />
  );
}

/** Esqueleto de tarjeta del estado "analizando" (§8). */
export function SkeletonLines({ lines = 3 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={index === lines - 1 ? 'h-3 w-2/3' : 'h-3 w-full'} />
      ))}
    </div>
  );
}
