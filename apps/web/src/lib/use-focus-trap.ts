import { useEffect, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Trampa de foco para diálogos modales. Devuelve el foco al elemento que
 * abrió el diálogo al desmontar: sin esto, cerrar con Escape deja el foco en
 * el `<body>` y el teclado pierde el hilo.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape: () => void,
): void {
  useEffect(() => {
    if (!active) return undefined;

    const container = ref.current;
    const previouslyFocused = document.activeElement;

    const focusables = () =>
      [...(container?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(
        (element) => element.offsetParent !== null || element === document.activeElement,
      );

    const first = focusables()[0];
    if (first) first.focus();
    else container?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onEscape();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = focusables();
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (!firstItem || !lastItem) return;

      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [active, onEscape, ref]);
}
