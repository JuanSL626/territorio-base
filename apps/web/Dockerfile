# syntax=docker/dockerfile:1.9
#
# ┌───────────────────────────────────────────────────────────────────────────┐
# │ apps/web — servidor SSR de Territorio Base (TanStack Start)               │
# └───────────────────────────────────────────────────────────────────────────┘
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
# ═══════════════════════════════════════════════════════════════════════════
# CÓMO SE RESUELVEN EL WORKSPACE Y LOS CATÁLOGOS ACÁ ADENTRO
# ═══════════════════════════════════════════════════════════════════════════
# Este es el punto donde normalmente se rompe, así que va explícito.
#
# 1. `catalog:` NO es una versión. Es un puntero a `pnpm-workspace.yaml`.
#    Sin ese archivo en la imagen, cada `"react": "catalog:"` es irresoluble
#    y `pnpm install` muere con `ERR_PNPM_CATALOG_ENTRY_NOT_FOUND_FOR_SPEC`.
#    Por eso `pnpm-workspace.yaml` se copia SIEMPRE, y antes que el código.
#
# 2. `--frozen-lockfile` valida el lockfile contra **todos** los importers
#    declarados en `packages:` (apps/*, packages/*, services/*). Si falta un
#    solo `package.json` de un miembro, pnpm aborta con
#    `Cannot install with "frozen-lockfile" because pnpm-lock.yaml is not up
#    to date with <manifest>`. Por eso se copian los manifiestos de TODOS los
#    paquetes —incluido `services/api`, que es Python y no declara deps npm—
#    aunque esta imagen sólo construya `apps/web`.
#
# 3. Los manifiestos se copian en una capa PROPIA, antes del código fuente.
#    Es la razón de que la lista de COPY sea explícita en vez de `COPY . .`:
#    tocar un `.tsx` no debe invalidar la capa de `pnpm install`, que es la
#    cara. Un `COPY . .` haría que cada edición reinstale 700 paquetes.
#
# 4. `.npmrc` también se copia: lleva `engine-strict=true`, `save-exact`, y la
#    configuración de link del workspace. Sin él, pnpm resolvería distinto
#    adentro que afuera — la clase de diferencia que aparece sólo en producción.
#
# 5. `--filter @territorio/web...` (con los tres puntos) = "web y todo aquello
#    de lo que depende". Sin los puntos, los `packages/*` quedan sin instalar y
#    el build falla al resolver `@territorio/geo`.

ARG NODE_VERSION=24.19.0

# ═══════════════════════════════════════════════════════════════════════════
# Etapa 0 — base común: Node + pnpm por corepack
# ═══════════════════════════════════════════════════════════════════════════
# Debian (bookworm-slim), NO Alpine: `better-sqlite3` publica prebuilds contra
# glibc. Con musl habría que compilarlo, y el mismo argumento (wheels/prebuilds
# manylinux) es el que fija la base de `services/api` — ver su Dockerfile.
# La versión coincide con `.nvmrc` a propósito: un solo Node en todo el repo.
FROM node:${NODE_VERSION}-bookworm-slim AS base

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    # Corepack pregunta por consola la primera vez que baja un pnpm; en un
    # build no interactivo eso es un cuelgue, no una pregunta.
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    # Node 24 avisa que corepack está deprecado; no hace falta en los logs.
    NODE_NO_WARNINGS=1

WORKDIR /app

# `corepack prepare` lee la versión de `packageManager` en el package.json de
# la raíz, así que pnpm queda clavado en el mismo que usa el equipo (11.23.0).
#
# NOTA operativa: si el corepack que trae la imagen es viejo, `prepare` puede
# fallar con `Cannot find matching keyid`. Es un problema de firmas de corepack,
# no del repo, y se destraba actualizando corepack (`npm i -g corepack@latest`)
# antes de `enable`. Se hace acá, incondicionalmente, porque es barato.
COPY package.json ./
RUN npm install --global --no-fund --no-audit corepack@latest \
    && corepack enable \
    && corepack prepare --activate \
    && pnpm --version

# ═══════════════════════════════════════════════════════════════════════════
# Etapa 1 — manifiestos: la capa cacheable
# ═══════════════════════════════════════════════════════════════════════════
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

# ═══════════════════════════════════════════════════════════════════════════
# Etapa 2 — dependencias de build (dev incluidas)
# ═══════════════════════════════════════════════════════════════════════════
FROM manifests AS deps

# `better-sqlite3` intenta bajar un prebuild; si para esta combinación de
# Node/plataforma no hubiera, cae a compilar con node-gyp y necesita
# python3 + g++ + make. Están sólo acá: la imagen final no los ve.
RUN apt-get update \
    && apt-get install --no-install-recommends -y build-essential python3 \
    && rm -rf /var/lib/apt/lists/*

# El store de pnpm va a un cache mount de BuildKit: se reusa entre builds sin
# quedar dentro de ninguna capa.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @territorio/web...

# ═══════════════════════════════════════════════════════════════════════════
# Etapa 3 — build
# ═══════════════════════════════════════════════════════════════════════════
FROM deps AS build

# `VITE_API_URL` es la única variable que se hornea en el bundle del BROWSER:
# es la base absoluta desde la que el cliente pide los PNG de overlay
# directamente al servicio raster (ver `src/components/map/raster-base.ts`).
# Al ser build-time, cambiarla exige reconstruir la imagen. Todo lo demás
# (API_URL, DATABASE_URL, BETTER_AUTH_*) es de runtime y va por entorno.
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL} \
    NODE_ENV=production

COPY packages/ packages/
COPY apps/web/ apps/web/

RUN pnpm --filter @territorio/web build

# ═══════════════════════════════════════════════════════════════════════════
# Etapa 4 — dependencias de runtime (sin dev)
# ═══════════════════════════════════════════════════════════════════════════
# Instalación aparte, desde los manifiestos y nada más: así el árbol de
# producción no arrastra vite, eslint, vitest, drizzle-kit ni tsgo, y no
# depende de si el build ensució su propio node_modules.
#
# Hace falta un node_modules real —no alcanza con `dist/`— porque el bundle SSR
# deja externalizados: react, react-dom, @tanstack/react-router,
# @tanstack/react-query, better-auth, better-sqlite3, archiver y zod.
FROM manifests AS prod-deps

RUN apt-get update \
    && apt-get install --no-install-recommends -y build-essential python3 \
    && rm -rf /var/lib/apt/lists/*

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @territorio/web...

# NO hace falta escenificar `better_sqlite3.node` en ningún lado. Hubo acá un
# `cp` del binding a `/app/apps/web/build/Release/`, con `bindings` en mente;
# quedó obsoleto cuando `vite.config.ts` puso `ssr: { external:
# ['better-sqlite3'] }`. Externalizado, el `require` lo resuelve Node desde
# `node_modules/.pnpm/better-sqlite3@…`, que ya trae su propio
# `build/Release/better_sqlite3.node` al lado — el mismo camino que en `dev` y
# el mismo que usan las migraciones. Si algún día se vuelve a inlinear, el
# síntoma es una app que levanta y en la que NADIE puede iniciar sesión, sin un
# error en los logs; la solución de fondo es no inlinearlo.

# ═══════════════════════════════════════════════════════════════════════════
# Etapa 5 — runtime
# ═══════════════════════════════════════════════════════════════════════════
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    NODE_NO_WARNINGS=1

WORKDIR /app/apps/web

# ─────────────────────────────────────────────────────────────────────────────
# Usuario: MISMO uid/gid que `services/api` (10001), a propósito.
#
# Los dos contenedores montan el MISMO volumen en /data — la app web escribe
# ahí el SQLite, el servicio raster escribe ahí los GeoTIFF, y la app web los
# lee de vuelta para armar el ZIP de descarga. Docker siembra el dueño de un
# volumen nuevo con el del primer contenedor que lo monta: si los uid no
# coincidieran, el segundo se encontraría /data de otro usuario y fallaría con
# EACCES en el primer análisis o en la primera migración.
#
# La imagen `node` ya trae un usuario `node` en uid 1000; no se usa.
# ─────────────────────────────────────────────────────────────────────────────
RUN groupadd --system --gid 10001 territorio \
    && useradd --system --uid 10001 --gid territorio --create-home territorio

# El árbol se copia con las MISMAS rutas relativas que tiene el repo. No es
# cosmético: el node_modules de pnpm son symlinks relativos
# (`apps/web/node_modules/react` → `../../../node_modules/.pnpm/react@…`).
# Aplanar o mover el árbol los deja colgando y Node falla en el primer import.
COPY --from=prod-deps --chown=territorio:territorio /app/node_modules            /app/node_modules
COPY --from=prod-deps --chown=territorio:territorio /app/apps/web/node_modules   /app/apps/web/node_modules
COPY --from=prod-deps --chown=territorio:territorio /app/packages                /app/packages
COPY --from=prod-deps --chown=territorio:territorio /app/package.json /app/pnpm-workspace.yaml /app/

COPY --from=build --chown=territorio:territorio /app/apps/web/dist         /app/apps/web/dist
COPY --chown=territorio:territorio apps/web/package.json apps/web/server.mjs /app/apps/web/

# Migraciones y seed. Son unos pocos KB de TypeScript y un .sql, y sin ellos un
# despliegue nuevo no tiene forma de crear el esquema ni el primer usuario:
# habría que abrir un contenedor con el repo entero para aplicar una migración.
#
# Corren con `node <archivo>.ts` directo — Node 24 hace type stripping nativo,
# que es exactamente lo que hacen los scripts `db:*` de `packages/db`. No se
# necesitan tsx, drizzle-kit ni ninguna dependencia de desarrollo.
#
# `better-sqlite3` se carga desde node_modules como un require normal, igual que
# en el servidor SSR (está externalizado del bundle): un solo mecanismo de
# resolución para los dos procesos.
COPY --chown=territorio:territorio packages/db/src      /app/packages/db/src
COPY --chown=territorio:territorio packages/db/scripts  /app/packages/db/scripts
COPY --chown=territorio:territorio packages/db/drizzle  /app/packages/db/drizzle

# `data/` es el volumen compartido con el servicio raster: ahí vive el SQLite.
# Se crea con dueño `territorio` para que las migraciones puedan escribirlo, y
# para sembrar el dueño correcto si este contenedor es el primero en montarlo.
RUN mkdir -p /data && chown territorio:territorio /data

# Nada de este servicio necesita root: no abre puertos privilegiados ni
# escribe fuera de /data.
USER territorio

EXPOSE 3000

# Sin curl en la imagen: el propio Node hace el chequeo. `/login` es la única
# ruta pública que ejecuta el pipeline SSR completo (`/` redirige a ella con
# 307, que `res.ok` daría por fallido).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `node server.mjs` directo, sin pnpm ni npm en el medio: el proceso Node es
# el PID 1 y recibe el SIGTERM de `docker stop` sin intermediarios (server.mjs
# lo maneja y cierra ordenado). Un wrapper `pnpm start` se lo tragaría.
CMD ["node", "server.mjs"]
