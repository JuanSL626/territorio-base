import { AoiSizeGuard } from './aoi-size-guard';

import type { ReactNode } from 'react';
import type { ThemeId } from '~/layers/types';
import type { AnalysisPhase } from '~/lib/analysis-queries';

import { AnalyzingState, type AnalysisThemeProgress } from '~/components/states/analyzing';
import { EmptyAoiState } from '~/components/states/empty-aoi';
import { NoDataCard } from '~/components/states/no-data';
import { getVista, VISTAS } from '~/layers/vistas';

/*
  La fase la decide `useAnalysisFlow` (el ciclo de vida vive en la capa de
  queries, no en el componente). Se re-exporta desde acá para que quien importa
  el panel no tenga que saber de dónde sale.
*/
export type { AnalysisPhase } from '~/lib/analysis-queries';

export type AnalysisCard = {
  id: string;
  /** Tema al que pertenece: gobierna el orden dentro de la vista activa. */
  theme: ThemeId;
  title: string;
  content: ReactNode;
  /** Falla aislada de un servicio: se dibuja como `no-data`, no como error global. */
  failure?: { reason: string; service?: string; onRetry?: () => void };
};

export type AnalysisPanelProps = {
  phase: AnalysisPhase;
  theme: ThemeId;
  areaHa: number | null;
  inRd: boolean;
  cards: readonly AnalysisCard[];
  progress: readonly AnalysisThemeProgress[];
  elapsedMs: number;
  errorMessage?: string | null;
  /**
   * AOI rechazado por tamaño (§7.4): el motor NO lo lanzó y espera una
   * decisión. Gana sobre `phase` porque no hay ni análisis corriendo ni
   * resultado — hay una pregunta abierta, y es lo único que corresponde
   * mostrar hasta que se responda.
   */
  sizeGuard?: { areaHa: number } | null;
  onDraw: () => void;
  onFiles: (files: FileList) => void;
  onCancel: () => void;
  onRetry?: () => void;
  onProceedLargeAoi: () => void;
  onDowngradeResolution: () => void;
  onSplitAoi: () => void;
};

/**
 * Pestaña ANÁLISIS. Cambiar de vista REORDENA las tarjetas (las del tema
 * activo primero) pero nunca esconde las otras (§3.4).
 */
export function AnalysisPanel({
  phase,
  theme,
  areaHa,
  inRd,
  cards,
  progress,
  elapsedMs,
  errorMessage = null,
  sizeGuard = null,
  onDraw,
  onFiles,
  onCancel,
  onRetry,
  onProceedLargeAoi,
  onDowngradeResolution,
  onSplitAoi,
}: AnalysisPanelProps) {
  if (sizeGuard !== null) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <AoiSizeGuard
          areaHa={sizeGuard.areaHa}
          onProceed={onProceedLargeAoi}
          onDowngradeResolution={onDowngradeResolution}
          onSplit={onSplitAoi}
        />
      </div>
    );
  }

  if (phase === 'sin-aoi') {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EmptyAoiState onDraw={onDraw} onFiles={onFiles} />
      </div>
    );
  }

  if (phase === 'analizando') {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        {areaHa !== null ? (
          <div className="px-4 pt-4">
            <AoiSizeGuard
              areaHa={areaHa}
              onProceed={onProceedLargeAoi}
              onDowngradeResolution={onDowngradeResolution}
              onSplit={onSplitAoi}
            />
          </div>
        ) : null}
        <AnalyzingState themes={[...progress]} elapsedMs={elapsedMs} onCancel={onCancel} />
      </div>
    );
  }

  /*
    Una corrida que falló NO puede quedarse girando en "analizando": el motor
    ya devolvió un motivo en español y esto lo muestra con su reintento. Sin
    esta rama, cancelar el análisis o perder el servicio raster dejaba el panel
    colgado para siempre.
  */
  if (phase === 'error') {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <NoDataCard
          title="No se pudo completar el análisis"
          reason={errorMessage ?? 'El análisis no terminó y no dejó un resultado legible.'}
          onRetry={onRetry}
          retryLabel="Volver a intentar"
        />
      </div>
    );
  }

  const themeRank = new Map<ThemeId, number>(VISTAS.map((vista, index) => [vista.id, index]));
  const rankOf = (cardTheme: ThemeId) =>
    cardTheme === theme ? -1 : (themeRank.get(cardTheme) ?? VISTAS.length);
  const ordered = [...cards].sort((a, b) => rankOf(a.theme) - rankOf(b.theme));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      {!inRd ? (
        /* §3 — la vista Riesgo RD se oculta entera; acá va la única explicación. */
        <p className="rounded-panel border-border-base bg-surface-2 text-12 text-fg-muted border p-3">
          Contexto RD no aplica: el AOI está fuera de República Dominicana.
        </p>
      ) : null}

      {ordered.length === 0 ? (
        <p className="text-12 text-fg-muted">
          Todavía no hay resultados para la vista {getVista(theme).label}.
        </p>
      ) : null}

      {ordered.map((card) =>
        card.failure ? (
          <NoDataCard
            key={card.id}
            title={card.title}
            reason={card.failure.reason}
            service={card.failure.service}
            onRetry={card.failure.onRetry}
          />
        ) : (
          <article key={card.id} className="rounded-panel border-border-base bg-surface border p-4">
            <h3 className="text-15 text-fg font-semibold">{card.title}</h3>
            <div className="mt-2">{card.content}</div>
          </article>
        ),
      )}
    </div>
  );
}
