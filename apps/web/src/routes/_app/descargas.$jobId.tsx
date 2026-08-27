import { createFileRoute, Link } from '@tanstack/react-router';

import { Badge, type BadgeTone } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { DownloadIcon, RetryIcon } from '~/components/ui/icons';
import { formatBytes } from '~/lib/format';

export const Route = createFileRoute('/_app/descargas/$jobId')({
  component: DescargasPage,
});

export type ArtifactStatus = 'pendiente' | 'generando' | 'listo' | 'error';

export type ExportArtifact = {
  id: string;
  label: string;
  status: ArtifactStatus;
  sizeBytes?: number;
  /** Razón en castellano: "STAC timeout", "Overpass no respondió". */
  reason?: string;
};

const TONE: Record<ArtifactStatus, BadgeTone> = {
  pendiente: 'neutral',
  generando: 'info',
  listo: 'success',
  error: 'danger',
};

/**
 * Estado del trabajo de exportación (§7.1). Cada artefacto falla POR SEPARADO:
 * un NDVI caído no invalida el resto del bundle, que sigue descargable.
 *
 * PLACEHOLDER de datos: la fase de features conecta el job real; la pantalla,
 * sus estados y el contrato ya están.
 */
function DescargasPage() {
  const { jobId } = Route.useParams();
  const artifacts: ExportArtifact[] = [];
  const ready = artifacts.filter((artifact) => artifact.status === 'listo');
  const total = artifacts.reduce((sum, artifact) => sum + (artifact.sizeBytes ?? 0), 0);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl p-6">
      <Link to="/" className="text-12 text-accent font-medium underline underline-offset-2">
        ← Volver al mapa
      </Link>

      <h1 className="text-18 text-fg mt-3 font-semibold">Exportación</h1>
      <p className="text-12 text-fg-muted mt-1">
        Trabajo <span className="tabular">{jobId}</span>. Podés cerrar esta pestaña: el trabajo
        sigue corriendo.
      </p>

      {artifacts.length === 0 ? (
        <p className="rounded-panel border-border-strong text-12 text-fg-muted mt-6 border border-dashed p-6">
          Este trabajo todavía no tiene artefactos. La fase de features conecta el job real.
        </p>
      ) : (
        <ul className="rounded-panel border-border-base bg-surface mt-4 flex flex-col border">
          {artifacts.map((artifact) => (
            <li
              key={artifact.id}
              className="border-border-base/60 flex items-center gap-3 border-b px-4 py-3 last:border-b-0"
            >
              <span className="min-w-0 flex-1">
                <span className="text-13 text-fg block">{artifact.label}</span>
                {artifact.reason != null ? (
                  <span className="text-11 text-fg-muted block">{artifact.reason}</span>
                ) : null}
              </span>
              <Badge tone={TONE[artifact.status]}>{artifact.status}</Badge>
              {artifact.status === 'error' ? (
                <Button size="sm" variant="secondary" leadingIcon={<RetryIcon size={13} />}>
                  Reintentar
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-center gap-3">
        <Button
          variant="primary"
          disabled={ready.length === 0}
          leadingIcon={<DownloadIcon size={14} />}
        >
          Descargar bundle {total > 0 ? `(${formatBytes(total)})` : ''}
        </Button>
        <p className="text-11 text-fg-muted">
          Se incluye <code>LEEME.txt</code> con fuentes, licencias y citas dentro del ZIP.
        </p>
      </div>
    </main>
  );
}
