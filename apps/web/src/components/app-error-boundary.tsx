import { Link, type ErrorComponentProps } from '@tanstack/react-router';

import { Button } from '~/components/ui/button';
import { AlertIcon } from '~/components/ui/icons';

/** Error de ruta. Muestra un mensaje en castellano, jamás un stacktrace crudo. */
export function AppErrorBoundary({ error, reset }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : 'Error desconocido.';

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="rounded-panel border-border-base bg-surface w-full max-w-md border p-6">
        <span className="text-danger">
          <AlertIcon size={20} />
        </span>
        <h1 className="text-18 text-fg mt-2 font-semibold">Algo se rompió</h1>
        <p className="text-13 text-fg-muted mt-1">
          No pudimos cargar esta pantalla. El detalle técnico es: {message}
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="primary" onClick={reset}>
            Reintentar
          </Button>
          <Link
            to="/"
            className="rounded-btn border-border-base text-13 text-fg inline-flex h-8 items-center border px-3 font-medium"
          >
            Volver al mapa
          </Link>
        </div>
      </div>
    </div>
  );
}
