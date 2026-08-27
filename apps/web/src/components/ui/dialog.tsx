import { useCallback, useRef, type ReactNode } from 'react';

import { IconButton } from './button';
import { CloseIcon } from './icons';

import { cn } from '~/lib/cn';
import { useFocusTrap } from '~/lib/use-focus-trap';

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** El modal de exportación mide ~520px (§7.2). */
  width?: number;
  footer?: ReactNode;
  children: ReactNode;
};

export function Dialog({
  open,
  onClose,
  title,
  description,
  width = 520,
  footer,
  children,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const handleEscape = useCallback(() => {
    onClose();
  }, [onClose]);

  useFocusTrap(panelRef, open, handleEscape);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cerrar"
        tabIndex={-1}
        onClick={onClose}
        className="bg-overlay absolute inset-0 cursor-default"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{ width }}
        className="rounded-panel border-border-base bg-surface shadow-popover relative flex max-h-[88vh] w-full max-w-full flex-col border"
      >
        <header className="border-border-base flex items-start gap-3 border-b p-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-15 text-fg font-semibold">{title}</h2>
            {description != null ? (
              <p className="text-12 text-fg-muted mt-0.5">{description}</p>
            ) : null}
          </div>
          <IconButton label="Cerrar" icon={<CloseIcon size={16} />} onClick={onClose} />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>

        {footer != null ? (
          <footer className={cn('border-border-base flex items-center gap-2 border-t p-4')}>
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
