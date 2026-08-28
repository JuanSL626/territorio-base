import { useState, type ReactNode } from 'react';

import { IconButton } from './button';
import { CloseIcon } from './icons';

import { cn } from '~/lib/cn';

export type SheetSnap = 'medium' | 'tall';

export type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
};

/**
 * Bottom sheet NO modal (§9 y §12.17): manija visible Y ✕ explícito en la
 * misma fila — nunca sólo-swipe —, el mapa de fondo sigue siendo paneable, y
 * nunca se apila: una hoja reemplaza a la anterior, no abre una segunda.
 */
export function BottomSheet({ open, onClose, title, children, footer }: BottomSheetProps) {
  const [snap, setSnap] = useState<SheetSnap>('medium');

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label={title}
      className={cn(
        'rounded-t-panel border-border-base bg-surface shadow-sheet fixed inset-x-0 bottom-0 z-40 flex flex-col border-t',
        snap === 'medium' ? 'h-[45vh]' : 'h-[92vh]',
      )}
    >
      <div className="border-border-base flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <button
          type="button"
          aria-label={snap === 'medium' ? 'Expandir panel' : 'Contraer panel'}
          aria-expanded={snap === 'tall'}
          onClick={() => {
            setSnap((value) => (value === 'medium' ? 'tall' : 'medium'));
          }}
          className="flex h-9 flex-1 items-center justify-center"
        >
          <span aria-hidden="true" className="bg-border-strong h-1 w-10 rounded-full" />
        </button>
        <span className="text-13 text-fg font-semibold">{title}</span>
        <span className="flex-1" />
        <IconButton
          label="Cerrar"
          icon={<CloseIcon size={16} />}
          onClick={onClose}
          className="h-11 w-11"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

      {footer != null ? (
        <div className="border-border-base shrink-0 border-t p-3">{footer}</div>
      ) : null}
    </div>
  );
}

export type SideDrawerProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  side: 'left' | 'right';
  width: number;
  /** Entre 1024 y 1279 el scrim cubre sólo el ancho del panel: el mapa sigue vivo. */
  scrim?: 'none' | 'partial' | 'full';
  children: ReactNode;
};

export function SideDrawer({
  open,
  onClose,
  title,
  side,
  width,
  scrim = 'partial',
  children,
}: SideDrawerProps) {
  if (!open) return null;

  return (
    <>
      {scrim === 'full' ? (
        <button
          type="button"
          aria-label="Cerrar panel"
          onClick={onClose}
          className="bg-overlay fixed inset-0 z-30 cursor-default"
        />
      ) : null}
      <aside
        aria-label={title}
        style={{ width }}
        className={cn(
          'border-border-base bg-surface fixed top-[var(--spacing-topbar)] bottom-0 z-30 flex flex-col',
          side === 'left' ? 'left-0 border-r' : 'right-0 border-l',
        )}
      >
        {children}
      </aside>
    </>
  );
}
