import { createFileRoute } from '@tanstack/react-router';

import { proxyErrorResponse, proxyRasterGet } from '~/lib/raster-proxy';
import { fetchSession } from '~/lib/session';

const CACHE_KEY_RE = /^[0-9a-f]{32}$/;

/** Proxy autenticado: el token interno del servicio raster nunca llega al navegador. */
export const Route = createFileRoute('/api/raster/landsat/$cacheKey/$file')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const user = await fetchSession();
        if (user === null) return proxyErrorResponse(401, 'Iniciá sesión para ver este resultado.');
        if (!CACHE_KEY_RE.test(params.cacheKey)) {
          return proxyErrorResponse(400, 'Clave de caché Landsat inválida.');
        }
        if (params.file !== 'preview.png' && params.file !== 'ndvi.tif') {
          return proxyErrorResponse(400, 'Nombre de archivo inválido.');
        }

        const upstreamPath = `/remote-sensing/pilot/landsat/${params.cacheKey}/${params.file}`;
        const outcome = await proxyRasterGet(upstreamPath, new URLSearchParams());
        return outcome.kind === 'ok'
          ? outcome.response
          : proxyErrorResponse(outcome.status, outcome.message);
      },
    },
  },
});
