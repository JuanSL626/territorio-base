import { createFileRoute } from '@tanstack/react-router';

import { openExportBundle } from '~/lib/export-runtime';
import { fetchSession } from '~/lib/session';

/**
 * `GET /descargas/$jobId/zip` — el ZIP, **transmitido**.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO ES UN HANDLER DE RUTA Y NO UNA SERVER FUNCTION
 * ─────────────────────────────────────────────────────────────────────────────
 * Una server function serializa su resultado a JSON y se invoca por RPC: no
 * puede devolver bytes binarios ni un `Content-Disposition`, y no se le puede
 * apuntar un `<a href>`. Una descarga necesita las dos cosas — una URL que el
 * navegador pueda navegar y una respuesta con cabeceras de archivo — así que es
 * un handler HTTP de verdad.
 *
 * El cuerpo es un stream: `archiver` lee cada archivo del directorio del job y
 * empuja bytes comprimidos a medida que los produce, con contrapresión. El ZIP
 * entero nunca existe en memoria ni en disco. Por eso tampoco hay
 * `Content-Length`: el tamaño final se conoce recién cuando terminó, y mentirlo
 * cortaría la descarga a la mitad. El navegador muestra una barra
 * indeterminada; la determinada estaba en `/descargas/$jobId`, que es donde el
 * usuario esperó de verdad.
 *
 * La autorización se resuelve ACÁ, no en el `beforeLoad` del layout: un handler
 * de servidor es un endpoint HTTP alcanzable sin pasar por el router, y
 * `openExportBundle` además compara el dueño del job contra la sesión. Un id
 * adivinado da 404, nunca el bundle de otra persona.
 */
export const Route = createFileRoute('/_app/descargas/$jobId/zip')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const user = await fetchSession();
        if (user === null) {
          return new Response('Iniciá sesión para descargar este bundle.', {
            status: 401,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
          });
        }

        const opened = openExportBundle(params.jobId, user.id);
        if (!opened.ok) {
          // `generando` es 409 (existe pero todavía no): es reintentable y el
          // cliente lo distingue del 404, que nunca va a mejorar.
          const status = opened.reason === 'generando' ? 409 : 404;
          return new Response(opened.message, {
            status,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
          });
        }

        return new Response(opened.bundle.body, {
          status: 200,
          headers: {
            'content-type': 'application/zip',
            'content-disposition': `attachment; filename="${opened.bundle.filename}"`,
            // El bundle es efímero y privado: no lo cachea nadie, ni el browser
            // ni un proxy intermedio.
            'cache-control': 'no-store, private',
          },
        });
      },
    },
  },
});
