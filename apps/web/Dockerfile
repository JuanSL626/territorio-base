# syntax=docker/dockerfile:1.9
#
# apps/web — servidor SSR de Territorio Base (TanStack Start)
#
# SE CONSTRUYE DESDE LA RAÍZ DEL REPO, no desde apps/web:
#
#     docker build -f apps/web/Dockerfile -t territorio-web .
#
# (`compose.yaml` ya lo hace así: `context: .`, `dockerfile: apps/web/Dockerfile`.)
# El contexto tiene que ser la raíz porque una app de un workspace pnpm no es
# autocontenida: necesita el lockfile, los catálogos y el código de
# `packages/*`, todos fuera de `apps/web/`.
#
# Cómo se resuelven el workspace y los catálogos acá adentro:
#
# 1. `catalog:` es un puntero a `pnpm-workspace.yaml`. Sin ese archivo en la
#    imagen, cada `"react": "catalog:"` es irresoluble y `pnpm install`
#    muere con `ERR_PNPM_CATALOG_ENTRY_NOT_FOUND_FOR_SPEC`. Por eso se copia
#    siempre, y antes que el código.
#
# 2. `--frozen-lockfile` valida el lockfile contra **todos** los importers
#    declarados en `packages:` (apps/*, packages/*, services/*); si falta un
#    solo `package.json` de un miembro, pnpm aborta. Por eso se copian los
#    manifiestos de todos los paquetes —incluido `services/api`, que es
#    Python y no declara deps npm— aunque esta imagen sólo construya
#    `apps/web`.
#
# 3. Los manifiestos se copian en una capa propia, antes del código fuente
#    (COPY explícito, no `COPY . .`): tocar un `.tsx` no debe invalidar la
#    capa de `pnpm install`, que es la cara.
#
# 4. `.npmrc` también se copia (`engine-strict`, `save-exact`, link del
#    workspace): sin él pnpm resolvería distinto adentro que afuera.
#
# 5. `--filter @territorio/web...` (con los tres puntos) = "web y todo
#    aquello de lo que depende". Sin los puntos, los `packages/*` quedan sin
#    instalar y el build falla al resolver `@territorio/geo`.

ARG NODE_VERSION=24.19.0

# Etapa 0 — base común: Node + pnpm por corepack
#
# Debian (bookworm-slim), no Alpine: ya no hay una razón puntual para eso
# (era `better-sqlite3`, prebuilds contra glibc, retirado con la migración a
# Supabase/`postgres-js`), pero cambiar de base es una decisión aparte que
# afecta a toda la imagen, así que se deja por ahora. La versión coincide
# con `.nvmrc` a propósito: un solo Node en todo el repo.
FROM node:${NODE_VERSION}-bookworm-slim AS base

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    # Corepack pregunta por consola la primera vez que baja un pnpm; en un
    # build no interactivo eso es un cuelgue, no una pregunta.
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NODE_NO_WARNINGS=1

WORKDIR /app

# `corepack prepare` lee `packageManager` del package.json raíz, así que pnpm
# queda clavado en el mismo que usa el equipo.
#
# Si el corepack de la imagen es viejo, `prepare` puede fallar con
# `Cannot find matching keyid` (problema de firmas de corepack, no del repo);
# se destraba actualizando corepack antes de `enable`, por eso se hace acá
# incondicionalmente.
COPY package.json ./
RUN npm install --global --no-fund --no-audit corepack@latest \
    && corepack enable \
    && corepack prepare --activate \
    && pnpm --version

# Etapa 1 — manifiestos: la capa cacheable
FROM base AS manifests

COPY pnpm-workspace.yaml pnpm-lock.yaml .npmrc .nvmrc ./
COPY apps/web/package.json                 apps/web/
COPY packages/api-client/package.json      packages/api-client/
COPY packages/db/package.json              packages/db/
COPY packages/eslint-config/package.json   packages/eslint-config/
COPY packages/geo/package.json             packages/geo/
COPY packages/tsconfig/package.json        packages/tsconfig/
COPY packages/ui/package.json              packages/ui/
COPY services/api/package.json             services/api/

# Etapa 2 — dependencias de build (dev incluidas)
FROM manifests AS deps

# El store de pnpm va a un cache mount de BuildKit: se reusa entre builds sin
# quedar dentro de ninguna capa.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @territorio/web...

# Etapa 3 — build
#
# `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` SÍ van por `ARG` acá,
# a diferencia de todo lo demás (API_URL, DATABASE_URL,
# SUPABASE_SERVICE_ROLE_KEY, TERRITORIO_API_TOKEN, que son de runtime y van
# por entorno del contenedor). Vite reemplaza `import.meta.env.VITE_*` de
# forma ESTÁTICA durante `vite build` — si no están seteadas EN ESTE PASO el
# bundle del browser queda con `undefined` horneado adentro, y ningún `ENV`
# posterior en "Etapa 5" lo arregla. `compose.yaml` las pasa como
# `build.args` desde el `.env` de despliegue. Consecuencia práctica: cambiar
# el proyecto de Supabase implica reconstruir la imagen, no solo reiniciar
# el contenedor — son las únicas dos variables de este Dockerfile con esa
# propiedad.
FROM deps AS build

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ENV NODE_ENV=production \
    VITE_SUPABASE_URL=${VITE_SUPABASE_URL} \
    VITE_SUPABASE_PUBLISHABLE_KEY=${VITE_SUPABASE_PUBLISHABLE_KEY}

COPY packages/ packages/
COPY apps/web/ apps/web/

RUN pnpm --filter @territorio/web build

# Etapa 4 — dependencias de runtime (sin dev)
#
# Instalación aparte, desde los manifiestos y nada más: así el árbol de
# producción no arrastra vite, eslint, vitest, drizzle-kit ni tsgo, y no
# depende de si el build ensució su propio node_modules.
#
# Hace falta un node_modules real —no alcanza con `dist/`— porque el bundle
# SSR deja externalizados: react, react-dom, @tanstack/react-router,
# @tanstack/react-query, archiver y zod.
FROM manifests AS prod-deps

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @territorio/web...

# Etapa 5 — runtime
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    NODE_NO_WARNINGS=1

WORKDIR /app/apps/web

# Usuario: no-root, mismo uid/gid que `services/api` (10001) por consistencia
# entre las dos imágenes del repo, aunque ya no comparten volumen (`web` no
# monta `territorio-data`; solo `api` lo necesita, ver `compose.yaml`) — un
# uid fijo y conocido sigue siendo mejor que el que trae la imagen base. (La
# imagen `node` ya trae un usuario `node` en uid 1000; no se usa, para no
# heredar lo que sea que esa imagen decida en el futuro.)
RUN groupadd --system --gid 10001 territorio \
    && useradd --system --uid 10001 --gid territorio --create-home territorio

# El árbol se copia con las MISMAS rutas relativas que tiene el repo: el
# node_modules de pnpm son symlinks relativos
# (`apps/web/node_modules/react` → `../../../node_modules/.pnpm/react@…`).
# Aplanar o mover el árbol los deja colgando y Node falla en el primer import.
COPY --from=prod-deps --chown=territorio:territorio /app/node_modules            /app/node_modules
COPY --from=prod-deps --chown=territorio:territorio /app/apps/web/node_modules   /app/apps/web/node_modules
COPY --from=prod-deps --chown=territorio:territorio /app/packages                /app/packages
COPY --from=prod-deps --chown=territorio:territorio /app/package.json /app/pnpm-workspace.yaml /app/

COPY --from=build --chown=territorio:territorio /app/apps/web/dist         /app/apps/web/dist
COPY --chown=territorio:territorio apps/web/package.json apps/web/server.mjs /app/apps/web/

# Las migraciones de Postgres viven en `supabase/migrations/` en la raíz del
# repo, aplicadas por el CLI de Supabase — no por esta imagen, que no copia
# ningún directorio de `packages/db` para eso.
#
# Nada de este servicio necesita root: no abre puertos privilegiados.
USER territorio

EXPOSE 3000

# Sin curl en la imagen: el propio Node hace el chequeo. `/login` es la única
# ruta pública que ejecuta el pipeline SSR completo (`/` redirige con 307, que
# `res.ok` daría por fallido).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `node server.mjs` directo, sin pnpm ni npm en el medio: el proceso Node es
# el PID 1 y recibe el SIGTERM de `docker stop` sin intermediarios (server.mjs
# lo maneja y cierra ordenado). Un wrapper `pnpm start` se lo tragaría.
CMD ["node", "server.mjs"]
