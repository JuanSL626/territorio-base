import { useId, useState, type ReactNode } from 'react';

import { cn } from '~/lib/cn';

export type TooltipProps = {
  content: string;
  children: (props: { 'aria-describedby': string | undefined }) => ReactNode;
  side?: 'top' | 'bottom' | 'left';
  className?: string;
};

/**
 * Tooltip que aparece con hover Y con foco de teclado. Nunca es el único
 * portador del nombre accesible: los controles del toolbar llevan `aria-label`
 * propio (§13, "nada de controles primarios sólo-icono").
 */
export function Tooltip({ content, children, side = 'left', className }: TooltipProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => {
        setVisible(true);
      }}
      onMouseLeave={() => {
        setVisible(false);
      }}
      onFocus={() => {
        setVisible(true);
      }}
      onBlur={() => {
        setVisible(false);
      }}
    >
      {children({ 'aria-describedby': visible ? id : undefined })}
      {visible ? (
        <span
          id={id}
          role="tooltip"
          className={cn(
            'rounded-chip bg-surface-inverse text-11 text-fg-inverse shadow-popover pointer-events-none absolute z-50 w-max max-w-56 px-2 py-1',
            side === 'left' ? 'top-1/2 right-full mr-2 -translate-y-1/2' : null,
            side === 'top' ? 'bottom-full left-1/2 mb-2 -translate-x-1/2' : null,
            side === 'bottom' ? 'top-full left-1/2 mt-2 -translate-x-1/2' : null,
            className,
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
