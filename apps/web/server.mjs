/*
  `vite build` de TanStack Start (v1.168, sin Nitro) no emite un servidor que
  escuche: emite `dist/server/server.js` (export default `{ fetch(request):
  Promise<Response> }`, un handler Web Fetch) y `dist/client/` con los
  assets. Quien despliega pone el host — esto es ese host, contra Node 24 y
  cero dependencias (`Request`/`Response`/`Headers`/streams web son globales
  desde Node 18; `Readable.toWeb/fromWeb` cierra el puente con `node:http`).

  Se usa igual en Docker (`CMD ["node", "server.mjs"]`) y en local
  (`pnpm --filter @territorio/web start`), así que lo que corre en producción
  es lo mismo que se prueba en la laptop.

  Variables: PORT (3000), HOST (0.0.0.0).
*/
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// Misma variable `TB_DIST_DIR` que lee `apps/web/vite.config.ts`, para que
// build y start apunten siempre al mismo directorio. Default: `dist/`.
const DIST_DIR = resolve(here, process.env.TB_DIST_DIR ?? 'dist');
const CLIENT_DIR = join(DIST_DIR, 'client');
const SERVER_ENTRY = join(DIST_DIR, 'server', 'server.js');

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';

if (!existsSync(SERVER_ENTRY)) {
  throw new Error(
    `No existe ${SERVER_ENTRY}. Corré \`pnpm --filter @territorio/web build\` antes de \`start\`.`,
  );
}

const { default: handler } = await import(SERVER_ENTRY);

// Sólo las extensiones que Vite puede emitir en `dist/client`, no una tabla
// MIME completa. Cualquier otra cosa sale como octet-stream (default seguro:
// el browser la descarga en vez de ejecutarla).
const MIME = new Map(
  Object.entries({
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.txt': 'text/plain; charset=utf-8',
    '.webmanifest': 'application/manifest+json',
    '.wasm': 'application/wasm',
  }),
);

/*
  `normalize` colapsa `..` antes del join, así que `/assets/../../.env` no
  puede salirse de `dist/client`. La comprobación de prefijo es el segundo
  cinturón.
*/
function staticPathFor(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null; // %-encoding roto: no es un asset nuestro.
  }
  if (decoded.includes('\0')) return null;

  const candidate = join(CLIENT_DIR, normalize(decoded));
  if (candidate !== CLIENT_DIR && !candidate.startsWith(CLIENT_DIR + sep)) return null;

  try {
    return statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

/*
  Casi todo en dist/client lleva hash de contenido en el nombre
  (`index-BE7mPk5K.js`): inmutable por construcción. Excepción: los dos
  archivos del worker de MapLibre se emiten sin hash porque el nombre es
  parte del contrato con la URL que MapLibre arma en runtime (ver
  `vite.config.ts`) — cachearlos como `immutable` bajo un nombre estable
  rompería con cada `pnpm up maplibre-gl`. De ahí la distinción: hash ⇒
  inmutable, sin hash ⇒ revalidación obligada.
*/
const HASHED_NAME = /-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/;

function cacheControlFor(filePath) {
  return HASHED_NAME.test(filePath)
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=0, must-revalidate';
}

async function serveStatic(res, filePath) {
  const { size, mtime } = statSync(filePath);
  res.writeHead(200, {
    'content-type': MIME.get(extname(filePath)) ?? 'application/octet-stream',
    'content-length': String(size),
    'last-modified': mtime.toUTCString(),
    'cache-control': cacheControlFor(filePath),
  });
  await pipeline(createReadStream(filePath), res);
}

/*
  El origen sale de `X-Forwarded-Proto`/`X-Forwarded-Host` cuando hay un
  proxy delante (Caddy, nginx, Traefik). Better Auth compara ese origen
  contra `BETTER_AUTH_URL` para CSRF y para el flag `Secure` de la cookie: si
  acá se hardcodeara `http://`, detrás de TLS terminado el login fallaría con
  un error de origen, no de configuración.
*/
function toWebRequest(req) {
  const proto = firstHeader(req.headers['x-forwarded-proto']) ?? 'http';
  const host = firstHeader(req.headers['x-forwarded-host']) ?? req.headers.host ?? `localhost:${PORT}`;

  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(name, v);
    else headers.set(name, value);
  }

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(`${proto}://${host}${req.url}`, {
    method: req.method,
    headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    // Obligatorio en Node cuando el body es un stream que todavía no terminó.
    duplex: hasBody ? 'half' : undefined,
  });
}

function firstHeader(value) {
  if (value === undefined) return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.split(',')[0]?.trim() || undefined;
}

async function sendWebResponse(res, response, isHead) {
  const headers = Object.fromEntries(response.headers);
  /*
    `Set-Cookie` es la única cabecera que puede repetirse y que NO se puede
    juntar con comas: hacerlo rompe cualquier cookie con `Expires=…, DD Mon`.
    `getSetCookie()` devuelve la lista real y `writeHead` acepta un array.
  */
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) headers['set-cookie'] = cookies;

  res.writeHead(response.status, headers);

  if (isHead || response.body === null) {
    res.end();
    return;
  }
  await pipeline(Readable.fromWeb(response.body), res);
}

const server = createServer((req, res) => {
  void (async () => {
    try {
      // Los estáticos se sirven acá y no en el handler: el SSR no tiene por qué
      // ver una petición de `/assets/index-*.js`.
      if (req.method === 'GET' || req.method === 'HEAD') {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        const filePath = staticPathFor(pathname);
        if (filePath !== null) {
          if (req.method === 'HEAD') {
            const { size } = statSync(filePath);
            res.writeHead(200, {
              'content-type': MIME.get(extname(filePath)) ?? 'application/octet-stream',
              'content-length': String(size),
            });
            res.end();
            return;
          }
          await serveStatic(res, filePath);
          return;
        }
      }

      const response = await handler.fetch(toWebRequest(req));
      await sendWebResponse(res, response, req.method === 'HEAD');
    } catch (error) {
      console.error('[server] fallo sirviendo', req.method, req.url, error);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Internal Server Error');
    }
  })();
});

/*
  `docker stop` manda SIGTERM y espera 10 s antes del SIGKILL. Sin este handler
  Node muere en el acto y corta las respuestas SSR en vuelo a la mitad.
*/
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    // Red de seguridad: si una conexión keep-alive no cierra, no colgamos el
    // contenedor hasta el SIGKILL.
    setTimeout(() => process.exit(0), 8000).unref();
  });
}

server.listen(PORT, HOST, () => {
  process.stdout.write(`territorio-base web escuchando en http://${HOST}:${PORT}\n`);
});
