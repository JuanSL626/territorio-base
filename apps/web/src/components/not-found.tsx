import { Link } from '@tanstack/react-router';

/** 404 del router. */
export function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="rounded-panel border-border-base bg-surface w-full max-w-md border p-6 text-center">
        <h1 className="text-18 text-fg font-semibold">Esta página no existe</h1>
        <p className="text-13 text-fg-muted mt-1">
          Puede que el análisis se haya borrado o que el link esté mal copiado.
        </p>
        <Link
          to="/"
          className="rounded-btn bg-accent text-13 text-accent-fg mt-4 inline-flex h-8 items-center px-3 font-medium"
        >
          Volver al mapa
        </Link>
      </div>
    </div>
  );
}
