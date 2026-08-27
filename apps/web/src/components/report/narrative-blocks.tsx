import type { BannerCopy, Conclusion, ConclusionTone } from './narrative';
import type { ReactNode } from 'react';

import { AlertIcon, CheckIcon, InfoIcon } from '~/components/ui/icons';
import { cn } from '~/lib/cn';

/**
 * Cómo se ven las conclusiones y los banners de 4 estados.
 *
 * El tono NO es decorativo: es la diferencia entre "consulté y no hay nada"
 * (verde) y "no se pudo consultar" (rojo). Colapsar los dos en el mismo gris es
 * literalmente la regresión #3 del inventario, y por eso el color sale de
 * `narrative.ts`, que es donde se decide la rama, y no de quien escribe el JSX.
 *
 * `neutral` se dibuja como PROSA, sin caja: si todo fuera una caja de color, el
 * color dejaría de significar algo.
 */

const TONE_BLOCK: Record<Exclude<ConclusionTone, 'neutral'>, string> = {
  info: 'border-l-info bg-info-soft/40',
  success: 'border-l-success bg-success-soft/40',
  warning: 'border-l-warning bg-warning-soft/40',
  danger: 'border-l-danger bg-danger-soft/40',
};

const TONE_TEXT: Record<Exclude<ConclusionTone, 'neutral'>, string> = {
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

function ToneIcon({ tone }: { tone: Exclude<ConclusionTone, 'neutral'> }) {
  switch (tone) {
    case 'success':
      return <CheckIcon size={15} />;
    case 'info':
      return <InfoIcon size={15} />;
    case 'warning':
    case 'danger':
      return <AlertIcon size={15} />;
  }
}

export function ConclusionBlock({ conclusion }: { conclusion: Conclusion }) {
  if (conclusion.tone === 'neutral') {
    return <p className="text-13 text-fg-muted print-card">{conclusion.text}</p>;
  }

  return (
    <div
      className={cn(
        'rounded-panel print-card flex gap-2 border border-l-2 p-3',
        'border-border-base',
        TONE_BLOCK[conclusion.tone],
      )}
    >
      <span className={cn('mt-0.5 shrink-0', TONE_TEXT[conclusion.tone])} aria-hidden="true">
        <ToneIcon tone={conclusion.tone} />
      </span>
      <p className="text-13 text-fg min-w-0">{conclusion.text}</p>
    </div>
  );
}

/** Las conclusiones de una sección, en el orden en que las devuelve el modelo. */
export function Conclusions({ items }: { items: readonly Conclusion[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => (
        <ConclusionBlock key={item.id} conclusion={item} />
      ))}
    </div>
  );
}

export type StatusBannerProps = {
  banner: BannerCopy;
  /** Detalle bajo el titular: nombre + designación + solape, etc. */
  children?: ReactNode;
};

/**
 * El banner de 4 estados de hidrología / áreas protegidas.
 *
 * `role="status"` y no `role="alert"`: el resultado ya está en la página cuando
 * se lee, no interrumpe nada. El titular es un string EXACTO del legacy y no se
 * reescribe acá bajo ninguna circunstancia (TC-07..TC-14).
 */
export function StatusBanner({ banner, children }: StatusBannerProps) {
  const tone = banner.tone === 'neutral' ? 'info' : banner.tone;

  return (
    <div
      role="status"
      className={cn(
        'rounded-panel print-card border-border-base border border-l-2 p-3',
        TONE_BLOCK[tone],
      )}
    >
      <div className="flex gap-2">
        <span className={cn('mt-0.5 shrink-0', TONE_TEXT[tone])} aria-hidden="true">
          <ToneIcon tone={tone} />
        </span>
        <p className="text-13 text-fg min-w-0 font-medium">{banner.headline}</p>
      </div>
      {children == null ? null : <div className="mt-2 pl-6">{children}</div>}
    </div>
  );
}

/**
 * Acción de mapa embebida en la prosa (§6.3): un `<button>` con aspecto de
 * enlace acentuado. El `aria-label` describe LA VISTA RESULTANTE, no el verbo,
 * porque quien lo escucha necesita saber a dónde va a ir el mapa.
 */
export function MapAction({
  label,
  describedView,
  active,
  onToggle,
}: {
  label: string;
  describedView: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      aria-label={describedView}
      className={cn(
        'no-print text-13 rounded-chip px-0.5 font-medium underline underline-offset-2',
        active ? 'text-accent bg-accent-soft' : 'text-accent hover:bg-accent-soft',
      )}
    >
      {label}
    </button>
  );
}
