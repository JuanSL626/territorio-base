/**
 * Scrollytelling del §6.1: qué sección está "activa" mientras se scrollea.
 *
 * Por qué no hay una librería acá: el brief pide scrollama con `offset: 0.55`
 * y, explícitamente, que el mecanismo sea IntersectionObserver y no polling
 * de scroll. Scrollama es un envoltorio de ~2 kB sobre IntersectionObserver;
 * el envoltorio es este archivo. Se evita así sumar una dependencia al
 * `package.json` de otro workstream y, sobre todo, un listener de `scroll`
 * en el hilo principal, que es lo que hace que un sidecar largo se sienta
 * pegajoso en un teléfono.
 *
 * El mecanismo: una LÍNEA horizontal imaginaria al 55 % de la altura del
 * viewport. `rootMargin` recorta la raíz del observador a esa línea (0 px de
 * alto), así que sólo reporta la sección que la está cruzando. Es exactamente
 * el `offset` de scrollama, sin su bucle de resize.
 *
 * Por qué `data-step-id` y no una ref por sección: un `ref` callback por
 * sección obliga a mantener un cache de callbacks para no desobservar y
 * volver a observar todo en cada render, y ese cache se lee durante el
 * render. Marcar el elemento con un atributo y buscarlo desde el efecto deja
 * TODO el trabajo con el DOM fuera del render: el efecto consulta el
 * contenedor, observa lo que encuentra y lee el id del propio elemento.
 */
import { useEffect, useState, type RefObject } from 'react';

/** El `offset: 0.55` del brief: la línea de activación, en fracción de viewport. */
export const STEP_OFFSET = 0.55;

/** Atributo que marca un paso. `SectionShell` lo pone; el hook lo busca. */
export const STEP_ATTRIBUTE = 'data-step-id';

export function useScrollSteps(
  ids: readonly string[],
  containerRef: RefObject<HTMLElement | null>,
): string {
  const [crossing, setCrossing] = useState<string>('');
  const key = ids.join('|');

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return undefined;
    if (typeof IntersectionObserver === 'undefined') return undefined;

    const order = key === '' ? [] : key.split('|');
    const top = Math.round(STEP_OFFSET * 100);

    const instance = new IntersectionObserver(
      (entries) => {
        const hits: string[] = [];
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id =
            entry.target instanceof HTMLElement ? entry.target.dataset.stepId : undefined;
          if (id !== undefined) hits.push(id);
        }
        if (hits.length === 0) return;

        /*
          Si dos secciones cruzan la línea en el mismo callback (secciones muy
          cortas, o un salto de scroll), gana la ÚLTIMA en el orden del
          documento: es a la que el usuario está entrando, no la que deja.
        */
        let best = hits[0] ?? '';
        let bestIndex = -1;
        for (const id of hits) {
          const index = order.indexOf(id);
          if (index > bestIndex) {
            bestIndex = index;
            best = id;
          }
        }
        setCrossing(best);
      },
      { rootMargin: `-${String(top)}% 0px -${String(100 - top)}% 0px`, threshold: 0 },
    );

    for (const node of container.querySelectorAll<HTMLElement>(`[${STEP_ATTRIBUTE}]`)) {
      instance.observe(node);
    }

    return () => {
      instance.disconnect();
    };
  }, [key, containerRef]);

  // Derivado, no estado: si la lista de secciones cambió, el paso activo vuelve
  // al primero sin pasar por un `setState` dentro de un efecto.
  return ids.includes(crossing) ? crossing : (ids[0] ?? '');
}
