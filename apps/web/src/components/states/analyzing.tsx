import { Button } from '~/components/ui/button';
import { AlertIcon, CheckIcon, SpinnerIcon } from '~/components/ui/icons';
import { Skeleton } from '~/components/ui/skeleton';
import { cn } from '~/lib/cn';
import { formatElapsed } from '~/lib/format';

export type AnalysisStepState = 'pending' | 'running' | 'done' | 'error';

export type AnalysisStep = {
  label: string;
  state: AnalysisStepState;
};

export type AnalysisThemeProgress = {
  id: string;
  label: string;
  steps: AnalysisStep[];
};

export type AnalyzingStateProps = {
  themes: AnalysisThemeProgress[];
  elapsedMs: number;
  onCancel: () => void;
};

function StepGlyph({ state }: { state: AnalysisStepState }) {
  switch (state) {
    case 'running':
      return (
        <span className="text-accent">
          <SpinnerIcon size={12} />
        </span>
      );
    case 'done':
      return (
        <span className="text-success">
          <CheckIcon size={12} />
        </span>
      );
    case 'error':
      return (
        <span className="text-danger">
          <AlertIcon size={12} />
        </span>
      );
    case 'pending':
      return (
        <span aria-hidden="true" className="bg-border-strong block h-1.5 w-1.5 rounded-full" />
      );
  }
}

/**
 * Estado "analizando" (§8): una tarjeta esqueleto por tema, cada una con su
 * línea de pasos DETERMINADA. Las tarjetas resuelven independientes — una
 * escena Sentinel-2 lenta nunca bloquea el render de topografía (regresión #3).
 */
export function AnalyzingState({ themes, elapsedMs, onCancel }: AnalyzingStateProps) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-15 text-fg font-semibold">Analizando la zona</h2>
        <span className="tabular text-12 text-fg-muted" aria-label="Tiempo transcurrido">
          {formatElapsed(elapsedMs)}
        </span>
      </div>

      {themes.map((theme) => {
        const done = theme.steps.every((step) => step.state === 'done');
        return (
          <article
            key={theme.id}
            className="rounded-panel border-border-base bg-surface border p-4"
            aria-busy={!done}
          >
            <h3 className="text-13 text-fg font-semibold">{theme.label}</h3>
            <ol className="mt-2 flex flex-col gap-1.5">
              {theme.steps.map((step, index) => (
                <li key={`${theme.id}-${String(index)}`} className="flex items-center gap-2">
                  <span className="flex h-3 w-3 items-center justify-center">
                    <StepGlyph state={step.state} />
                  </span>
                  <span
                    className={cn(
                      'text-12',
                      step.state === 'pending' ? 'text-fg-subtle' : 'text-fg-muted',
                      step.state === 'error' ? 'text-danger' : null,
                    )}
                  >
                    {step.label}
                  </span>
                </li>
              ))}
            </ol>
            {!done ? (
              <div className="mt-3 flex flex-col gap-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            ) : null}
          </article>
        );
      })}

      <Button variant="secondary" onClick={onCancel} className="self-start">
        Cancelar análisis
      </Button>
    </div>
  );
}
