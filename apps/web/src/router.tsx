import {
  QueryClient,
  QueryClientProvider,
  dehydrate,
  hydrate,
  type DehydratedState,
} from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';

import { routeTree } from './routeTree.gen';

import type { ReactNode } from 'react';

import { AppErrorBoundary } from '~/components/app-error-boundary';
import { NotFound } from '~/components/not-found';

/**
 * Contexto del router. `queryClient` se crea UNA vez por request en el servidor
 * y una vez por pestaña en el cliente: nunca un singleton de módulo, o dos
 * usuarios distintos compartirían caché durante el SSR.
 */
export type RouterContext = {
  queryClient: QueryClient;
};

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // El análisis territorial es caro (minutos de STAC + Overpass): no
        // revalidar al enfocar la ventana y mantener el resultado caliente.
        staleTime: 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient } satisfies RouterContext,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: AppErrorBoundary,
    defaultNotFoundComponent: NotFound,
    scrollRestoration: true,
    // Hidratación SSR-segura de TanStack Query: el estado de la caché viaja
    // dentro del payload dehidratado del router, no en un <script> aparte.
    Wrap: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
    /*
      El estado de Query viaja como STRING dentro del payload dehidratado del
      router. `DehydratedState` incluye `mutationKey: readonly unknown[]`, que
      el validador de serialización del router rechaza por no ser
      demostrablemente serializable; y `dehydrate()` ya produce datos
      JSON-safe, así que el string es exacto y no pierde nada.
    */
    dehydrate: () => ({ queryState: JSON.stringify(dehydrate(queryClient)) }),
    hydrate: (dehydrated: { queryState: string }) => {
      const state = JSON.parse(dehydrated.queryState) as DehydratedState;
      hydrate(queryClient, state);
    },
  });

  return router;
}
