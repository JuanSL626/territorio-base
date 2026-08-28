import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';

import { IconButton } from './button';
import { AlertIcon, CheckIcon, CloseIcon, InfoIcon } from './icons';

import { cn } from '~/lib/cn';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export type Toast = {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
};

type ToastContextValue = {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id'>) => string;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const value = use(ToastContext);
  if (!value) throw new Error('useToast tiene que usarse dentro de <ToastProvider>.');
  return value;
}

const TONE_ICON: Record<ToastTone, ReactNode> = {
  info: <InfoIcon size={16} />,
  success: <CheckIcon size={16} />,
  warning: <AlertIcon size={16} />,
  error: <AlertIcon size={16} />,
};

const TONE_CLASS: Record<ToastTone, string> = {
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-danger',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((toast: Omit<Toast, 'id'>) => {
    counter.current += 1;
    const id = `toast-${String(counter.current)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    return id;
  }, []);

  const value = useMemo(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);

  return (
    <ToastContext value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext>
  );
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      role="region"
      aria-label="Notificaciones"
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-32px)] flex-col gap-2"
    >
      {toasts.map((toast) => (
        <output
          key={toast.id}
          aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
          className="rounded-panel border-border-base bg-surface shadow-popover pointer-events-auto flex items-start gap-2 border p-3"
        >
          <span className={cn('mt-0.5 shrink-0', TONE_CLASS[toast.tone])}>
            {TONE_ICON[toast.tone]}
          </span>
          <span className="min-w-0 flex-1">
            <span className="text-13 text-fg block font-semibold">{toast.title}</span>
            {toast.description != null ? (
              <span className="text-12 text-fg-muted mt-0.5 block">{toast.description}</span>
            ) : null}
            {toast.action ? (
              <button
                type="button"
                onClick={toast.action.onClick}
                className="text-12 text-accent mt-1.5 font-semibold underline underline-offset-2"
              >
                {toast.action.label}
              </button>
            ) : null}
          </span>
          <IconButton
            label="Descartar notificación"
            icon={<CloseIcon size={14} />}
            onClick={() => {
              onDismiss(toast.id);
            }}
          />
        </output>
      ))}
    </div>
  );
}
