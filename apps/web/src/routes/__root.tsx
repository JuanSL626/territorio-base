import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router';

import type { ReactNode } from 'react';
import type { RouterContext } from '~/router';

import { AppErrorBoundary } from '~/components/app-error-boundary';
import { NotFound } from '~/components/not-found';
import { ToastProvider } from '~/components/ui/toast';
import appCss from '~/styles.css?url';

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'color-scheme', content: 'light dark' },
      { title: 'Territorio Base' },
      {
        name: 'description',
        content:
          'Análisis territorial: topografía, vegetación, hidrología, áreas protegidas y contexto de riesgo de República Dominicana.',
      },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  errorComponent: AppErrorBoundary,
  notFoundComponent: NotFound,
  component: RootComponent,
  shellComponent: RootDocument,
});

function RootComponent() {
  return (
    <ToastProvider>
      <Outlet />
    </ToastProvider>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
