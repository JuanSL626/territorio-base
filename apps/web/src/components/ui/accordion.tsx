import { useId, type ReactNode } from 'react';

import { ChevronDown, ChevronRight } from './icons';

import { cn } from '~/lib/cn';

export type AccordionSectionProps = {
  title: ReactNode;
  open: boolean;
  onToggle: () => void;
  /** 0 = grupo, 1 = subgrupo MEPyD (indenta 16px por nivel, §4.2). */
  level?: 0 | 1;
  trailing?: ReactNode;
  children: ReactNode;
};

export function AccordionSection({
  title,
  open,
  onToggle,
  level = 0,
  trailing,
  children,
}: AccordionSectionProps) {
  const id = useId();

  return (
    <section>
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-content`}
          onClick={onToggle}
          className={cn(
            'hover:bg-surface-3 flex h-11 w-full items-center gap-1.5 pr-3 text-left transition-colors',
            level === 0 ? 'pl-3' : 'pl-7',
          )}
        >
          <span className="text-fg-muted shrink-0">
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </span>
          <span className="text-13 text-fg min-w-0 flex-1 truncate font-semibold">{title}</span>
          {trailing}
        </button>
      </h3>
      <div id={`${id}-content`} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
