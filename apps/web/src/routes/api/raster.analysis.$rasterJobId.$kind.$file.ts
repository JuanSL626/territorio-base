import { createFileRoute } from '@tanstack/react-router';

import { getAnalysisByRasterJobIdForUser, getDb } from '~/lib/db';
import {
  forwardableOverlayQuery,
  isValidLayerName,
  isValidRasterJobId,
  proxyErrorResponse,
  proxyRasterGet,
} from '~/lib/raster-proxy';
import { fetchSession } from '~/lib/session';

/**
 * `GET /api/raster/analysis/$rasterJobId/$kind/$file` — el proxy de los
 * overlays POR CAPA (todo salvo el costero, que vive en `raster.coastal.*`).
 *
 * Ver `~/lib/raster-proxy.ts` para el porqué de este archivo y para la regla
 * de seguridad central: `$rasterJobId` sólo se usa para ENCONTRAR la fila
 * dueña (`getAnalysisByRasterJobIdForUser`, ownership real vía `user_id`); la
 * URL que se le pide al servicio raster la arma este handler con `$kind` y
 * `$file` YA VALIDADOS contra una lista cerrada — nunca con un path tomado tal
 * cual de la URL entrante.
 *
 * `$file` es `{capa}.{extensión}` en un solo segmento (`dem.png`,
 * `ndvi_density.json`, `worldcover.tif`) — así arma la URL
 * `resolveOverlayUrl()` en `~/components/map/overlays.ts`, que sólo antepone
 * `base` a la ruta relativa que ya mandó el servicio raster; duplicar esa capa
 * de parseo en el cliente para partir capa y extensión no agregaba nada.
 */
const FILE_RE = /^([a-z][a-z0-9_]{0,63})\.(png|json|tif)$/;

export const Route = createFileRoute('/api/raster/analysis/$rasterJobId/$kind/$file')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const user = await fetchSession();
        if (user === null) {
          return proxyErrorResponse(401, 'Iniciá sesión para ver este overlay.');
        }

        if (!isValidRasterJobId(params.rasterJobId)) {
          return proxyErrorResponse(400, 'Id de análisis inválido.');
        }

        const owned = await getAnalysisByRasterJobIdForUser(getDb(), {
          rasterJobId: params.rasterJobId,
          userId: user.id,
        });
        // No existe O no es de este usuario: mismo 404 para las dos — un id
        // adivinado no puede distinguir "no existe" de "es de otro".
        if (owned === undefined) {
          return proxyErrorResponse(404, 'Ese análisis no existe.');
        }

        const kind = params.kind;
        if (kind !== 'overlay' && kind !== 'raster') {
          return proxyErrorResponse(400, 'Tipo de recurso inválido.');
        }

        const match = FILE_RE.exec(params.file);
        if (match === null) {
          return proxyErrorResponse(400, 'Nombre de archivo inválido.');
        }
        const [, layer, ext] = match;
        if (layer === undefined || ext === undefined || !isValidLayerName(layer)) {
          return proxyErrorResponse(400, 'Nombre de capa inválido.');
        }
        const extOk = kind === 'overlay' ? ext === 'png' || ext === 'json' : ext === 'tif';
        if (!extOk) {
          return proxyErrorResponse(400, 'Extensión inválida para este tipo de recurso.');
        }

        const upstreamPath = `/analysis/${encodeURIComponent(params.rasterJobId)}/${kind}/${layer}.${ext}`;
        const query = forwardableOverlayQuery(new URL(request.url).searchParams);
        const outcome = await proxyRasterGet(upstreamPath, query);
        return outcome.kind === 'ok'
          ? outcome.response
          : proxyErrorResponse(outcome.status, outcome.message);
      },
    },
  },
});
