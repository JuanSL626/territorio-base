import { useCallback, useSyncExternalStore } from 'react';

/**
 * Media query SSR-segura. En el servidor devuelve siempre `false`, que es la
 * respuesta correcta: el layout de escritorio del §9 es el default y las
 * variantes móviles se activan tras la hidratación, no antes.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined') return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => {
        list.removeEventListener('change', onChange);
      };
    },
    [query],
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  }, [query]);

  const getServerSnapshot = useCallback(() => false, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Cortes exactos del 02-design-brief.md §9. */
export type Breakpoint = 'mobile' | 'tablet' | 'compact' | 'standard' | 'wide';

export function useBreakpoint(): Breakpoint {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const isTablet = useMediaQuery('(min-width: 768px) and (max-width: 1023px)');
  const isCompact = useMediaQuery('(min-width: 1024px) and (max-width: 1279px)');
  const isStandard = useMediaQuery('(min-width: 1280px) and (max-width: 1439px)');

  if (isMobile) return 'mobile';
  if (isTablet) return 'tablet';
  if (isCompact) return 'compact';
  if (isStandard) return 'standard';
  return 'wide';
}
