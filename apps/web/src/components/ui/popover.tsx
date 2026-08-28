import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { cn } from '~/lib/cn';

export type PopoverProps = {
  trigger: (props: {
    'aria-expanded': boolean;
    'aria-controls': string;
    'aria-haspopup': 'dialog';
    onClick: () => void;
  }) => ReactNode;
  title: string;
  children: ReactNode;
  width?: number;
  align?: 'left' | 'right';
  className?: string;
};

/**
 * Popover, NO modal (§4.3). Cierra con Escape o click afuera, devuelve el foco
 * al disparador, y no atrapa el foco: el usuario puede seguir tabulando.
 */
export function Popover({
  trigger,
  title,
  children,
  width = 300,
  align = 'right',
  className,
}: PopoverProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event: MouseEvent) => {
      const node = containerRef.current;
      if (node && event.target instanceof Node && !node.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-flex">
      {trigger({
        'aria-expanded': open,
        'aria-controls': id,
        'aria-haspopup': 'dialog',
        onClick: () => {
          setOpen((value) => !value);
        },
      })}

      {open ? (
        <div
          id={id}
          role="dialog"
          aria-label={title}
          style={{ width }}
          className={cn(
            'rounded-panel border-border-base bg-surface shadow-popover absolute top-full z-40 mt-1 border p-3',
            align === 'right' ? 'right-0' : 'left-0',
            className,
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
