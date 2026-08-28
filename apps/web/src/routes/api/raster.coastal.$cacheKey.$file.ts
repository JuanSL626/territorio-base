import { createFileRoute } from '@tanstack/react-router';

import { getAnalysisByCoastalCacheKeyForUser, getDb } from '~/lib/db';
import {
  forwardableOverlayQuery,
  isValidCoastalCacheKey,
  proxyErrorResponse,
  proxyRasterGet,
} from '~/lib/raster-proxy';
import { fetchSession } from '~/lib/session';

/**
 * `GET /api/raster/coastal/$cacheKey/$file` — el equivalente costero de
 * `raster.analysis.*`. Ver `~/lib/raster-proxy.ts` para el diseño general y
 * su comentario sobre `getAnalysisByCoastalCacheKeyForUser` para por qué
 * "dueño" acá significa "tu análisis pidió este escenario", no "esta clave es
 * secreta" (la clave es `sha256(AOI + preset)`: content-addressed, la
 * comparten dos análisis con la misma AOI+preset, incluso de usuarios
 * distintos — y aun así ninguno de los dos ve nada que su propio análisis no
 * haya pedido).
 *
 * Sólo `overlay.png` / `overlay.json`: el GeoTIFF costero (`raster.tif`) no
 * lo linkea ninguna pantalla hoy (`sections.tsx` busca la capa `coastal`
 * dentro de `analysis.layers`, que nunca la incluye — vive aparte, en
 * `analysis.coastal`), así que no hay para qué abrir esa ruta.
 */
export const Route = createFileRoute('/api/raster/coastal/$cacheKey/$file')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const user = await fetchSession();
        if (user === null) {
          return proxyErrorResponse(401, 'Iniciá sesión para ver este overlay.');
        }

        if (!isValidCoastalCacheKey(params.cacheKey)) {
          return proxyErrorResponse(400, 'Clave de caché costera inválida.');
        }

        const owned = await getAnalysisByCoastalCacheKeyForUser(getDb(), {
          cacheKey: params.cacheKey,
          userId: user.id,
        });
        if (owned === undefined) {
          return proxyErrorResponse(404, 'Ese escenario costero no existe.');
        }

        if (params.file !== 'overlay.png' && params.file !== 'overlay.json') {
          return proxyErrorResponse(400, 'Nombre de archivo inválido.');
        }

        const upstreamPath = `/coastal/${encodeURIComponent(params.cacheKey)}/${params.file}`;
        const query = forwardableOverlayQuery(new URL(request.url).searchParams);
        const outcome = await proxyRasterGet(upstreamPath, query);
        return outcome.kind === 'ok'
          ? outcome.response
          : proxyErrorResponse(outcome.status, outcome.message);
      },
    },
  },
});
